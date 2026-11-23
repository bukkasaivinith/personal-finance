ALTER TABLE athlete.recovery_scores DROP CONSTRAINT recovery_scores_score_check;
ALTER TABLE athlete.recovery_scores ADD CONSTRAINT recovery_scores_score_check CHECK (score BETWEEN 0 AND 100);
ALTER TABLE athlete.recovery_scores ADD COLUMN metrics jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metrics) = 'object');

CREATE TABLE athlete.recovery_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_id uuid NOT NULL REFERENCES athlete.recovery_scores(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  previous_record jsonb NOT NULL
);
ALTER TABLE athlete.recovery_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON athlete.recovery_history FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.athlete_save_recovery(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := public.athlete_require_user();
  result_id uuid;
  v_date date := COALESCE(NULLIF(p_payload ->> 'recovery_date', '')::date, current_date);
  v_score integer := NULLIF(p_payload ->> 'score', '')::integer;
  v_notes text := COALESCE(p_payload ->> 'notes', '');
  v_source text := COALESCE(NULLIF(btrim(p_payload ->> 'source'), ''), 'manual');
  supplied jsonb := p_payload -> 'metrics';
  field record;
  bounds jsonb := '{"hrv":[1,500],"restingHeartRate":[20,260],"sleepMinutes":[0,1440],"sleepPerformance":[0,100],"respiratoryRate":[1,100],"strain":[0,21],"energy":[1,10],"fatigue":[1,10],"soreness":[1,10],"sleepQuality":[1,10],"mood":[1,10],"wellness":[1,10],"discomfort":[1,10]}'::jsonb;
  previous athlete.recovery_scores%ROWTYPE;
BEGIN
  IF v_score IS NULL OR v_score NOT BETWEEN 0 AND 100 OR v_source NOT IN ('manual', 'whoop') OR char_length(v_notes) > 700 THEN
    RAISE EXCEPTION 'Check the recovery score details.';
  END IF;
  IF supplied IS NOT NULL THEN
    IF jsonb_typeof(supplied) <> 'object' OR octet_length(supplied::text) > 4096 THEN RAISE EXCEPTION 'Invalid recovery metrics.'; END IF;
    FOR field IN SELECT key, value FROM jsonb_each(supplied) LOOP
      IF NOT bounds ? field.key OR jsonb_typeof(field.value) <> 'number' THEN RAISE EXCEPTION 'Invalid recovery metric.'; END IF;
      IF field.value::numeric NOT BETWEEN (bounds -> field.key ->> 0)::numeric AND (bounds -> field.key ->> 1)::numeric THEN
        RAISE EXCEPTION 'Recovery metric is outside its supported range.';
      END IF;
    END LOOP;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(caller::text || v_date::text, 291583));
  SELECT * INTO previous FROM athlete.recovery_scores WHERE user_id = caller AND recovery_date = v_date FOR UPDATE;
  IF FOUND AND (previous.score, previous.notes, previous.source, previous.metrics) IS DISTINCT FROM
    (v_score, v_notes, v_source, COALESCE(supplied, previous.metrics)) THEN
    INSERT INTO athlete.recovery_history (recovery_id, previous_record)
      VALUES (previous.id, to_jsonb(previous) - 'user_id' - 'id' - 'created_at');
  END IF;
  INSERT INTO athlete.recovery_scores AS stored (user_id, recovery_date, score, notes, source, metrics)
  VALUES (caller, v_date, v_score, v_notes, v_source, COALESCE(supplied, previous.metrics, '{}'::jsonb))
  ON CONFLICT (user_id, recovery_date) DO UPDATE SET score = EXCLUDED.score, notes = EXCLUDED.notes,
    source = EXCLUDED.source, metrics = EXCLUDED.metrics, updated_at = now()
  RETURNING stored.id INTO result_id;
  RETURN result_id;
END;
$$;

CREATE FUNCTION public.athlete_delete_recovery(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := public.athlete_require_user();
BEGIN
  DELETE FROM athlete.recovery_scores WHERE id = p_id AND user_id = caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'That recovery entry is unavailable.'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.athlete_delete_recovery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_delete_recovery(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.athlete_get_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = athlete, public
AS $$
DECLARE caller uuid := public.athlete_require_user();
BEGIN
  RETURN jsonb_build_object(
    'settings', COALESCE((SELECT jsonb_build_object('distance_unit', distance_unit, 'weight_unit', weight_unit, 'timezone', timezone) FROM athlete.settings WHERE user_id = caller), jsonb_build_object('distance_unit', 'km', 'weight_unit', 'kg', 'timezone', 'Asia/Kolkata')),
    'activities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'activity_date', activity_date, 'duration_seconds', duration_seconds, 'distance_meters', distance_meters, 'average_heart_rate', average_heart_rate, 'calories', calories, 'elevation_meters', elevation_meters, 'cadence', cadence, 'effort', effort, 'notes', notes, 'source', source, 'created_at', created_at) ORDER BY activity_date DESC, created_at DESC) FROM athlete.activities WHERE user_id = caller), '[]'::jsonb),
    'planned_workouts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'title', title, 'workout_date', workout_date, 'kind', kind, 'target_distance_meters', target_distance_meters, 'notes', notes, 'status', status) ORDER BY workout_date ASC, created_at ASC) FROM athlete.planned_workouts WHERE user_id = caller), '[]'::jsonb),
    'recovery_scores', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'recovery_date', recovery_date, 'score', score, 'metrics', metrics, 'notes', notes, 'source', source) ORDER BY recovery_date DESC) FROM athlete.recovery_scores WHERE user_id = caller), '[]'::jsonb),
    'races', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'race_date', race_date, 'distance_meters', distance_meters, 'location', location, 'finish_seconds', finish_seconds, 'notes', notes) ORDER BY race_date ASC) FROM athlete.races WHERE user_id = caller), '[]'::jsonb),
    'gym_sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'session_date', session_date, 'title', title, 'duration_minutes', duration_minutes, 'exercises', exercises, 'notes', notes) ORDER BY session_date DESC) FROM athlete.gym_sessions WHERE user_id = caller), '[]'::jsonb),
    'goals', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'title', title, 'target_distance_meters', target_distance_meters, 'starts_on', starts_on, 'ends_on', ends_on, 'is_active', is_active) ORDER BY ends_on ASC) FROM athlete.goals WHERE user_id = caller), '[]'::jsonb)
  );
END;
$$;
