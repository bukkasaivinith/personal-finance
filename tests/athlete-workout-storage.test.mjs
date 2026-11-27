import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('workout imports and daily recovery are private, durable and bound to the active session', async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE SCHEMA extensions;'
    + 'CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz DEFAULT now(),email_confirmed_at timestamptz DEFAULT now(),raw_user_meta_data jsonb DEFAULT \'{}\');'
    + 'CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),refreshed_at timestamptz,not_after timestamptz,user_agent text);'
    + 'CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting(\'request.jwt.claims\',true),\'\'),\'{}\')::jsonb $$;'
    + 'CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>\'sub\')::uuid $$;'
    + 'GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;'
  );
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const migration of (await readdir(directory)).filter((name) => name.endsWith('.sql') &&
    (name < '20261115160000' || name.startsWith('2026112323') || name.startsWith('20261127'))).sort()) {
    await db.exec(await readFile(new URL(migration, directory), 'utf8'));
  }
  const owner = randomUUID();
  const other = randomUUID();
  const ownerSession = randomUUID();
  const otherSession = randomUUID();
  const activeSession = randomUUID();
  await db.query('INSERT INTO auth.users(id,email) VALUES ($1,$2),($3,$4)', [owner, 'runner@example.test', other, 'guest@example.test']);
  await db.query("INSERT INTO auth.sessions(id,user_id,created_at) VALUES($1,$2,now()-interval '1 minute'),($3,$4,now()),($5,$2,now())", [ownerSession, owner, otherSession, other, activeSession]);
  const asUser = async (user, session, activate = true) => {
    await db.exec('RESET ROLE;');
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: session })]);
    await db.exec('SET ROLE authenticated;');
    if (activate) await db.exec('SELECT public.activate_current_single_device_session();');
  };
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const workout = { kind: 'run', activity_date: '2026-11-20', duration_seconds: 1200, distance_meters: 3000, source: 'samsung_health' };
  const details = { metrics: { steps: 4000 }, fingerprints: ['a'.repeat(64)], samples: [{ seconds: 1, heartRate: 150 }] };
  const saveWorkout = (id, input = details) => scalar('SELECT public.athlete_save_workout($1,$2,$3)', [id, JSON.stringify(workout), JSON.stringify(input)]);
  await asUser(owner, ownerSession);
  const id = await saveWorkout(null);
  assert.equal((await scalar('SELECT public.athlete_get_workout_details($1)', [id])).metrics.steps, 4000);
  await assert.rejects(saveWorkout(null), /already saved/);
  await assert.rejects(saveWorkout(null, { ...details, fingerprints: ['invalid'] }), /Invalid import fingerprint/);
  await saveWorkout(id, { metrics: { steps: null, maxHeartRate: 175 }, fingerprints: ['b'.repeat(64)] });
  const updated = await scalar('SELECT public.athlete_get_workout_details($1)', [id]);
  assert.deepEqual(updated.metrics, { maxHeartRate: 175 });
  assert.equal(updated.samples.length, 1);

  const image = { name: 'route.png', mime: 'image/png', data: 'iVBORw0KGgo=' };
  const workoutFile = { name: 'workout.gpx', mime: 'application/octet-stream', data: 'PGdweC8+' };
  const upload = (id, batch, files) => scalar('SELECT public.athlete_add_activity_media($1,$2,$3)', [id, batch, JSON.stringify(files)]);
  const activityPage = (id) => scalar('SELECT public.athlete_get_activity_page($1)', [id]);
  const mediaContent = (id) => scalar('SELECT public.athlete_get_activity_media($1)', [id]);
  const saveWithMedia = (batch, files) => scalar('SELECT public.athlete_save_activity_with_media(NULL,$1,NULL,$2,$3)',
    [JSON.stringify(workout), batch, JSON.stringify(files)]);
  const combineActivities = (keepId, otherId) => scalar('SELECT public.athlete_combine_activities($1,$2)', [keepId, otherId]);
  const invalidFile = { ...image, mime: 'audio/webm' };
  await assert.rejects(saveWithMedia(randomUUID(), [invalidFile]), /check constraint/);
  await assert.rejects(saveWithMedia(randomUUID(), [{ ...workoutFile, name: 'unsafe.exe' }]), /check constraint/);
  await assert.rejects(saveWithMedia(randomUUID(), [workoutFile, workoutFile]), /one workout file/);
  assert.equal((await scalar('SELECT public.athlete_get_dashboard()')).activities.length, 1);
  const batch = randomUUID();
  const imported = await saveWithMedia(batch, [image, workoutFile]);
  assert.equal(await saveWithMedia(batch, [image, workoutFile]), imported);
  const savedFiles = (await activityPage(imported)).media;
  assert.equal(savedFiles.length, 2);
  assert.equal(await mediaContent(savedFiles[1].id), workoutFile.data);

  const group = randomUUID();
  await upload(id, group, [image, { ...image, name: 'heart-rate.png' }]);
  await upload(id, group, [image, { ...image, name: 'heart-rate.png' }]);
  await assert.rejects(upload(id, randomUUID(), [image, invalidFile]), /check constraint/);
  const page = await activityPage(id);
  assert.equal(page.activity.id, id);
  assert.equal(page.activity.user_id, undefined);
  assert.equal(page.details.metrics.maxHeartRate, 175);
  assert.deepEqual(page.media.map(({ name, batch_id }) => [name, batch_id]), [['route.png', group], ['heart-rate.png', group]]);
  assert.equal(page.media[0].content, undefined);
  assert.equal(await mediaContent(page.media[0].id), image.data);

  const screenshotFingerprint = 'c'.repeat(64);
  await scalar('SELECT public.athlete_save_workout($1,$2,$3)', [imported,
    JSON.stringify({ ...workout, activity_date: '2026-11-19', calories: 200, notes: 'Screenshot summary' }),
    JSON.stringify({ metrics: { steps: 4200 }, source: 'Samsung Health', fingerprints: [screenshotFingerprint] })]);
  await upload(imported, group, [{ ...image, name: 'summary.png' }]);
  const screenshotGroup = (await activityPage(imported)).media;
  await assert.rejects(combineActivities(id, id), /two different activities/);
  const unrelatedTrack = await saveWorkout(null, { metrics: {}, samples: [{ seconds: 1, heartRate: 90 }] });
  await assert.rejects(combineActivities(id, unrelatedTrack), /different workout timelines/);
  assert.equal((await activityPage(unrelatedTrack)).details.samples[0].heartRate, 90);
  await assert.rejects(combineActivities(id, randomUUID()), /unavailable/);
  assert.equal(await combineActivities(id, imported), id);
  await assert.rejects(activityPage(imported), /unavailable/);
  const combined = await activityPage(id);
  assert.equal(combined.activity.activity_date, workout.activity_date);
  assert.equal(combined.activity.calories, 200);
  assert.equal(combined.activity.notes, 'Screenshot summary');
  assert.equal(combined.details.metrics.steps, 4200);
  assert.deepEqual(combined.details.samples, details.samples);
  assert.equal(combined.media.length, 5);
  assert.equal(new Set(combined.media.map(({ batch_id }) => batch_id)).size, 3);
  assert.equal(await mediaContent(screenshotGroup[0].id), image.data);
  assert.equal(await mediaContent(savedFiles[1].id), workoutFile.data);
  await assert.rejects(saveWorkout(null, { metrics: {}, fingerprints: [screenshotFingerprint] }), /already saved/);
  await saveWorkout(id, { metrics: {}, fingerprints: [screenshotFingerprint] });

  const recovery = { recovery_date: '2026-11-20', source: 'whoop', score: 0, metrics: { hrv: 55, strain: 12.5 } };
  const saveRecovery = (input) => scalar('SELECT public.athlete_save_recovery($1)', [JSON.stringify(input)]);
  const recoveryId = await saveRecovery(recovery);
  assert.equal(await saveRecovery({ ...recovery, score: 68 }), recoveryId);
  await assert.rejects(saveRecovery({ ...recovery, metrics: { strain: 99 } }), /outside its supported range/);
  assert.equal((await scalar('SELECT public.athlete_get_dashboard()')).recovery_scores[0].metrics.hrv, 55);
  await asUser(other, otherSession);
  assert.equal(await scalar('SELECT public.athlete_get_dashboard()').then((data) => data.recovery_scores.length), 0);
  await assert.rejects(scalar('SELECT public.athlete_get_workout_details($1)', [id]), /unavailable/);
  await assert.rejects(activityPage(id), /unavailable/);
  await assert.rejects(mediaContent(page.media[0].id), /unavailable/);
  await assert.rejects(mediaContent(savedFiles[1].id), /unavailable/);
  await assert.rejects(upload(id, randomUUID(), [image]), /unavailable/);
  await assert.rejects(combineActivities(id, unrelatedTrack), /unavailable/);
  await assert.rejects(saveWorkout(id), /unavailable/);
  await assert.rejects(db.query('SELECT public.athlete_delete_recovery($1)', [recoveryId]), /unavailable/);
  assert.notEqual(await saveWorkout(null), id);
  await asUser(owner, activeSession);
  await asUser(owner, ownerSession, false);
  await assert.rejects(scalar('SELECT public.athlete_get_workout_details($1)', [id]), /session/i);
  await assert.rejects(mediaContent(page.media[0].id), /session/i);
  await asUser(owner, activeSession, false);
  await db.query('SELECT public.athlete_delete_activity($1)', [id]);
  await db.query('SELECT public.athlete_delete_recovery($1)', [recoveryId]);
  await assert.rejects(scalar('SELECT public.athlete_get_workout_details($1)', [id]), /unavailable/);
  await assert.rejects(mediaContent(page.media[0].id), /unavailable/);
  assert.notEqual(await saveWorkout(null), id);
});
