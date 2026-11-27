import { supabase } from '@/lib/supabase';
import { publicApiError } from '@/lib/public-api-error';
import { prepareActivityMedia, type ActivityMedia, type ActivityMediaBatch } from '@/lib/athlete-media';
import type { WorkoutDetails } from '@/lib/athlete-workout';
import type {
  AthleteActivity,
  AthleteActivityDraft,
  AthleteGoal,
  AthleteGoalDraft,
  AthleteHubData,
  AthleteSettings,
  GymSession,
  GymSessionDraft,
  PlannedWorkout,
  PlannedWorkoutDraft,
  Race,
  RecoveryScore,
} from '@/lib/athlete';

function fail(error: { message: string }): never {
  throw publicApiError(error, 'Could not complete the Athlete Hub request. Please try again.');
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function readActivity(row: Record<string, unknown>): AthleteActivity {
  return {
    id: String(row.id), kind: row.kind as AthleteActivity['kind'], activityDate: String(row.activity_date),
    durationSeconds: nullableNumber(row.duration_seconds), distanceMeters: nullableNumber(row.distance_meters),
    averageHeartRate: nullableNumber(row.average_heart_rate), calories: nullableNumber(row.calories),
    elevationMeters: nullableNumber(row.elevation_meters), cadence: nullableNumber(row.cadence), effort: nullableNumber(row.effort),
    notes: String(row.notes ?? ''), source: row.source as AthleteActivity['source'], createdAt: String(row.created_at),
  };
}

function readSettings(row: Record<string, unknown>): AthleteSettings {
  return {
    distanceUnit: row.distance_unit === 'mi' ? 'mi' : 'km',
    weightUnit: row.weight_unit === 'lb' ? 'lb' : 'kg',
    timezone: typeof row.timezone === 'string' ? row.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
  };
}

function activityMediaError(error: { message: string; code?: string }): never {
  if (error.code === 'PGRST202') throw new Error('Apply the Athlete Hub activity media SQL migration in Supabase, then try again.');
  fail(error);
}

export async function loadAthleteActivityPage(id: string, signal?: AbortSignal) {
  const request = supabase.rpc('athlete_get_activity_page', { p_activity_id: id });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) activityMediaError(error);
  const result = data as Record<string, unknown>;
  return {
    activity: readActivity(result.activity as Record<string, unknown>),
    settings: readSettings(result),
    details: result.details as WorkoutDetails | null,
    media: rows<ActivityMedia>(result.media),
  };
}

export async function loadAthleteActivityMedia(id: string, mime: string, signal: AbortSignal): Promise<Blob> {
  const { data, error } = await supabase.rpc('athlete_get_activity_media', { p_media_id: id }).abortSignal(signal);
  if (error) activityMediaError(error);
  const bytes = Uint8Array.from(atob(String(data)), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export async function addAthleteActivityMedia(id: string, batch: ActivityMediaBatch) {
  const { error } = await supabase.rpc('athlete_add_activity_media', {
    p_activity_id: id, p_batch_id: batch.id, p_media: await prepareActivityMedia(batch.files),
  });
  if (error) activityMediaError(error);
}

export async function loadAthleteHubData(signal?: AbortSignal): Promise<AthleteHubData> {
  const request = supabase.rpc('athlete_get_dashboard');
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) fail(error);
  const result = (data ?? {}) as Record<string, unknown>;
  const settingsRow = (result.settings ?? {}) as Record<string, unknown>;
  const settings = readSettings(settingsRow);
  const activities = rows<Record<string, unknown>>(result.activities).map(readActivity);
  const plannedWorkouts = rows<Record<string, unknown>>(result.planned_workouts).map((row): PlannedWorkout => ({
    id: String(row.id), title: String(row.title), workoutDate: String(row.workout_date), kind: row.kind as PlannedWorkout['kind'],
    targetDistanceMeters: nullableNumber(row.target_distance_meters), notes: String(row.notes ?? ''), status: row.status as PlannedWorkout['status'],
  }));
  const recoveryScores = rows<Record<string, unknown>>(result.recovery_scores).map((row): RecoveryScore => ({
    id: String(row.id), recoveryDate: String(row.recovery_date), score: Number(row.score), notes: String(row.notes ?? ''), source: row.source as RecoveryScore['source'], metrics: (row.metrics ?? {}) as RecoveryScore['metrics'],
  }));
  const races = rows<Record<string, unknown>>(result.races).map((row): Race => ({
    id: String(row.id), name: String(row.name), raceDate: String(row.race_date), distanceMeters: nullableNumber(row.distance_meters),
    location: String(row.location ?? ''), finishSeconds: nullableNumber(row.finish_seconds), notes: String(row.notes ?? ''),
  }));
  const gymSessions = rows<Record<string, unknown>>(result.gym_sessions).map((row): GymSession => ({
    id: String(row.id), sessionDate: String(row.session_date), title: String(row.title), durationMinutes: nullableNumber(row.duration_minutes),
    exercises: rows<Record<string, unknown>>(row.exercises).map((exercise) => ({ exercise: String(exercise.exercise ?? ''), sets: Number(exercise.sets ?? 0), reps: Number(exercise.reps ?? 0), weight: nullableNumber(exercise.weight) })), notes: String(row.notes ?? ''),
  }));
  const goals = rows<Record<string, unknown>>(result.goals).map((row): AthleteGoal => ({
    id: String(row.id), title: String(row.title), targetDistanceMeters: Number(row.target_distance_meters), startsOn: String(row.starts_on), endsOn: String(row.ends_on), isActive: Boolean(row.is_active),
  }));
  return { settings, activities, plannedWorkouts, recoveryScores, races, gymSessions, goals };
}

export async function saveAthleteActivity(draft: AthleteActivityDraft, id?: string, details?: WorkoutDetails, batch?: ActivityMediaBatch): Promise<string> {
  const payload = {
    kind: draft.kind, activity_date: draft.activityDate, duration_seconds: draft.durationSeconds, distance_meters: draft.distanceMeters,
    average_heart_rate: draft.averageHeartRate, calories: draft.calories, elevation_meters: draft.elevationMeters,
    cadence: draft.cadence, effort: draft.effort, notes: draft.notes, source: draft.source,
  };
  const args = { p_activity_id: id ?? null, p_payload: payload };
  const { data, error } = batch?.files.length
    ? await supabase.rpc('athlete_save_activity_with_media', {
      ...args, p_details: details ?? null, p_batch_id: batch.id, p_media: await prepareActivityMedia(batch.files),
    })
    : details ? await supabase.rpc('athlete_save_workout', { ...args, p_details: details })
      : await supabase.rpc('athlete_save_activity', args);
  if (error) {
    if (batch?.files.length) activityMediaError(error);
    fail(error);
  }
  if (typeof data !== 'string' || !data || (id && data !== id)) {
    throw new Error('Could not confirm that the activity was saved.');
  }
  return data;
}

export async function loadWorkoutDetails(id: string): Promise<WorkoutDetails | null> {
  const { data, error } = await supabase.rpc('athlete_get_workout_details', { p_activity_id: id });
  if (error) fail(error);
  return data as WorkoutDetails | null;
}

export async function deleteAthleteActivity(id: string): Promise<void> {
  const { error } = await supabase.rpc('athlete_delete_activity', { p_activity_id: id });
  if (error) fail(error);
}

export async function combineAthleteActivities(keepId: string, otherId: string): Promise<void> {
  const { data, error } = await supabase.rpc('athlete_combine_activities', { p_keep_id: keepId, p_other_id: otherId });
  if (error) fail(error);
  if (data !== keepId) throw new Error('Could not confirm that the activities were combined.');
}

export async function saveAthleteSettings(settings: AthleteSettings): Promise<void> {
  const { error } = await supabase.rpc('athlete_save_settings', { p_distance_unit: settings.distanceUnit, p_weight_unit: settings.weightUnit, p_timezone: settings.timezone });
  if (error) fail(error);
}

export async function savePlannedWorkout(draft: PlannedWorkoutDraft, id?: string): Promise<string> {
  const { data, error } = await supabase.rpc('athlete_save_planned_workout', { p_workout_id: id ?? null, p_payload: {
    title: draft.title, workout_date: draft.workoutDate, kind: draft.kind, target_distance_meters: draft.targetDistanceMeters, notes: draft.notes,
  } });
  if (error) fail(error);
  return String(data);
}

export async function saveRecoveryScore(input: Omit<RecoveryScore, 'id'>): Promise<string> {
  const { data, error } = await supabase.rpc('athlete_save_recovery', { p_payload: {
    recovery_date: input.recoveryDate, score: input.score, notes: input.notes, source: input.source, metrics: input.metrics,
  } });
  if (error) fail(error);
  return String(data);
}

export async function deleteRecoveryScore(id: string): Promise<void> {
  const { error } = await supabase.rpc('athlete_delete_recovery', { p_id: id });
  if (error) fail(error);
}

export async function saveRace(input: Omit<Race, 'id'>, id?: string): Promise<string> {
  const { data, error } = await supabase.rpc('athlete_save_race', { p_race_id: id ?? null, p_payload: {
    name: input.name, race_date: input.raceDate, distance_meters: input.distanceMeters, location: input.location, finish_seconds: input.finishSeconds, notes: input.notes,
  } });
  if (error) fail(error);
  return String(data);
}

export async function saveGymSession(input: GymSessionDraft, id?: string): Promise<string> {
  const { data, error } = await supabase.rpc('athlete_save_gym_session', { p_session_id: id ?? null, p_payload: {
    session_date: input.sessionDate, title: input.title, duration_minutes: input.durationMinutes, exercises: input.exercises, notes: input.notes,
  } });
  if (error) fail(error);
  return String(data);
}

export async function saveAthleteGoal(input: AthleteGoalDraft, id?: string): Promise<string> {
  const { data, error } = await supabase.rpc('athlete_save_goal', { p_goal_id: id ?? null, p_payload: {
    title: input.title, target_distance_meters: input.targetDistanceMeters, starts_on: input.startsOn, ends_on: input.endsOn,
  } });
  if (error) fail(error);
  return String(data);
}

export async function deleteAthleteRecord(recordType: 'planned_workout' | 'race' | 'gym_session' | 'goal', id: string): Promise<void> {
  const { error } = await supabase.rpc('athlete_delete_record', { p_record_type: recordType, p_record_id: id });
  if (error) fail(error);
}

export async function deleteAllAthleteData(): Promise<void> {
  const { error } = await supabase.rpc('athlete_delete_all_data');
  if (error) fail(error);
}
