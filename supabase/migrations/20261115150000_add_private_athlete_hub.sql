/*
  Private Athlete Hub

  Health and training records live in a dedicated athlete schema and are never
  shared through finance workspaces or exposed to platform administration.
  Browser clients use the narrowly-scoped public RPC functions below; no
  direct grants are made on athlete tables.
*/

CREATE SCHEMA IF NOT EXISTS athlete;
REVOKE ALL ON SCHEMA athlete FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS athlete.settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  distance_unit text NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km', 'mi')),
  weight_unit text NOT NULL DEFAULT 'kg' CHECK (weight_unit IN ('kg', 'lb')),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS athlete.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('run', 'walk', 'cycle', 'treadmill', 'race')),
  activity_date date NOT NULL,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  distance_meters numeric(12, 2) CHECK (distance_meters IS NULL OR distance_meters >= 0),
  average_heart_rate integer CHECK (average_heart_rate IS NULL OR average_heart_rate BETWEEN 20 AND 260),
  calories integer CHECK (calories IS NULL OR calories >= 0),
  elevation_meters numeric(12, 2) CHECK (elevation_meters IS NULL OR elevation_meters >= 0),
  cadence integer CHECK (cadence IS NULL OR cadence BETWEEN 1 AND 400),
  effort integer CHECK (effort IS NULL OR effort BETWEEN 1 AND 10),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1500),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'voice', 'image', 'samsung_health', 'whoop')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_activities_user_date_idx ON athlete.activities (user_id, activity_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS athlete.planned_workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 100),
  workout_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('run', 'walk', 'cycle', 'treadmill', 'race')),
  target_distance_meters numeric(12, 2) CHECK (target_distance_meters IS NULL OR target_distance_meters >= 0),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_planned_workouts_user_date_idx ON athlete.planned_workouts (user_id, workout_date, status);

CREATE TABLE IF NOT EXISTS athlete.recovery_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recovery_date date NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 1 AND 100),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 700),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'whoop')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, recovery_date)
);

CREATE TABLE IF NOT EXISTS athlete.races (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  race_date date NOT NULL,
  distance_meters numeric(12, 2) CHECK (distance_meters IS NULL OR distance_meters >= 0),
  location text NOT NULL DEFAULT '' CHECK (char_length(location) <= 160),
  finish_seconds integer CHECK (finish_seconds IS NULL OR finish_seconds > 0),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_races_user_date_idx ON athlete.races (user_id, race_date DESC);

CREATE TABLE IF NOT EXISTS athlete.gym_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 100),
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  exercises jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(exercises) = 'array'),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS athlete.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 100),
  target_distance_meters numeric(12, 2) NOT NULL CHECK (target_distance_meters > 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE athlete.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete.planned_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete.recovery_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete.races ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete.gym_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete.goals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA athlete FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.athlete_require_user()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  PERFORM public.require_current_single_device_session();
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in to use Athlete Hub.'; END IF;
  RETURN caller;
END;
$$;

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
    'recovery_scores', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'recovery_date', recovery_date, 'score', score, 'notes', notes, 'source', source) ORDER BY recovery_date DESC) FROM athlete.recovery_scores WHERE user_id = caller), '[]'::jsonb),
    'races', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'race_date', race_date, 'distance_meters', distance_meters, 'location', location, 'finish_seconds', finish_seconds, 'notes', notes) ORDER BY race_date ASC) FROM athlete.races WHERE user_id = caller), '[]'::jsonb),
    'gym_sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'session_date', session_date, 'title', title, 'duration_minutes', duration_minutes, 'exercises', exercises, 'notes', notes) ORDER BY session_date DESC) FROM athlete.gym_sessions WHERE user_id = caller), '[]'::jsonb),
    'goals', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'title', title, 'target_distance_meters', target_distance_meters, 'starts_on', starts_on, 'ends_on', ends_on, 'is_active', is_active) ORDER BY ends_on ASC) FROM athlete.goals WHERE user_id = caller), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.athlete_save_settings(p_distance_unit text, p_weight_unit text, p_timezone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = athlete, public
AS $$
DECLARE caller uuid := public.athlete_require_user();
BEGIN
  IF p_distance_unit NOT IN ('km', 'mi') OR p_weight_unit NOT IN ('kg', 'lb') THEN RAISE EXCEPTION 'Choose supported units.'; END IF;
  IF p_timezone IS NULL OR char_length(btrim(p_timezone)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Choose a valid timezone.'; END IF;
  INSERT INTO athlete.settings (user_id, distance_unit, weight_unit, timezone) VALUES (caller, p_distance_unit, p_weight_unit, btrim(p_timezone))
  ON CONFLICT (user_id) DO UPDATE SET distance_unit = EXCLUDED.distance_unit, weight_unit = EXCLUDED.weight_unit, timezone = EXCLUDED.timezone, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.athlete_save_activity(p_activity_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = athlete, public
AS $$
DECLARE
  caller uuid := public.athlete_require_user();
  result_id uuid;
  v_kind text := COALESCE(NULLIF(btrim(p_payload ->> 'kind'), ''), 'run');
  v_date date := COALESCE(NULLIF(p_payload ->> 'activity_date', '')::date, current_date);
  v_source text := COALESCE(NULLIF(btrim(p_payload ->> 'source'), ''), 'manual');
  v_duration integer := NULLIF(p_payload ->> 'duration_seconds', '')::integer;
  v_distance numeric := NULLIF(p_payload ->> 'distance_meters', '')::numeric;
  v_hr integer := NULLIF(p_payload ->> 'average_heart_rate', '')::integer;
  v_calories integer := NULLIF(p_payload ->> 'calories', '')::integer;
  v_elevation numeric := NULLIF(p_payload ->> 'elevation_meters', '')::numeric;
  v_cadence integer := NULLIF(p_payload ->> 'cadence', '')::integer;
  v_effort integer := NULLIF(p_payload ->> 'effort', '')::integer;
  v_notes text := COALESCE(p_payload ->> 'notes', '');
BEGIN
  IF v_kind NOT IN ('run', 'walk', 'cycle', 'treadmill', 'race') THEN RAISE EXCEPTION 'Choose a valid activity type.'; END IF;
  IF v_source NOT IN ('manual', 'voice', 'image', 'samsung_health', 'whoop') THEN RAISE EXCEPTION 'Choose a valid activity source.'; END IF;
  IF v_duration IS NOT NULL AND v_duration <= 0 THEN RAISE EXCEPTION 'Duration must be greater than zero.'; END IF;
  IF v_distance IS NOT NULL AND v_distance < 0 THEN RAISE EXCEPTION 'Distance cannot be negative.'; END IF;
  IF v_hr IS NOT NULL AND v_hr NOT BETWEEN 20 AND 260 THEN RAISE EXCEPTION 'Heart rate must be between 20 and 260.'; END IF;
  IF v_calories IS NOT NULL AND v_calories < 0 THEN RAISE EXCEPTION 'Calories cannot be negative.'; END IF;
  IF v_elevation IS NOT NULL AND v_elevation < 0 THEN RAISE EXCEPTION 'Elevation cannot be negative.'; END IF;
  IF v_cadence IS NOT NULL AND v_cadence NOT BETWEEN 1 AND 400 THEN RAISE EXCEPTION 'Cadence must be between 1 and 400.'; END IF;
  IF v_effort IS NOT NULL AND v_effort NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Effort must be between 1 and 10.'; END IF;
  IF char_length(v_notes) > 1500 THEN RAISE EXCEPTION 'Notes are too long.'; END IF;
  IF p_activity_id IS NULL THEN
    INSERT INTO athlete.activities (user_id, kind, activity_date, duration_seconds, distance_meters, average_heart_rate, calories, elevation_meters, cadence, effort, notes, source)
    VALUES (caller, v_kind, v_date, v_duration, v_distance, v_hr, v_calories, v_elevation, v_cadence, v_effort, v_notes, v_source) RETURNING id INTO result_id;
  ELSE
    UPDATE athlete.activities SET kind = v_kind, activity_date = v_date, duration_seconds = v_duration, distance_meters = v_distance, average_heart_rate = v_hr, calories = v_calories, elevation_meters = v_elevation, cadence = v_cadence, effort = v_effort, notes = v_notes, source = v_source, updated_at = now() WHERE id = p_activity_id AND user_id = caller RETURNING id INTO result_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'That activity is unavailable.'; END IF;
  END IF;
  UPDATE athlete.planned_workouts SET status = 'completed', updated_at = now() WHERE user_id = caller AND workout_date = v_date AND kind = v_kind AND status = 'planned';
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.athlete_delete_activity(p_activity_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = athlete, public
AS $$
DECLARE caller uuid := public.athlete_require_user();
BEGIN
  DELETE FROM athlete.activities WHERE id = p_activity_id AND user_id = caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'That activity is unavailable.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.athlete_save_planned_workout(p_workout_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = athlete, public
AS $$
DECLARE
  caller uuid := public.athlete_require_user(); result_id uuid;
  v_title text := btrim(COALESCE(p_payload ->> 'title', ''));
  v_date date := NULLIF(p_payload ->> 'workout_date', '')::date;
  v_kind text := COALESCE(NULLIF(btrim(p_payload ->> 'kind'), ''), 'run');
  v_target numeric := NULLIF(p_payload ->> 'target_distance_meters', '')::numeric;
  v_notes text := COALESCE(p_payload ->> 'notes', '');
BEGIN
  IF char_length(v_title) NOT BETWEEN 1 AND 100 OR v_date IS NULL OR v_kind NOT IN ('run', 'walk', 'cycle', 'treadmill', 'race') OR (v_target IS NOT NULL AND v_target < 0) OR char_length(v_notes) > 1000 THEN RAISE EXCEPTION 'Check the planned workout details.'; END IF;
  IF p_workout_id IS NULL THEN INSERT INTO athlete.planned_workouts (user_id, title, workout_date, kind, target_distance_meters, notes) VALUES (caller, v_title, v_date, v_kind, v_target, v_notes) RETURNING id INTO result_id;
  ELSE UPDATE athlete.planned_workouts SET title = v_title, workout_date = v_date, kind = v_kind, target_distance_meters = v_target, notes = v_notes, updated_at = now() WHERE id = p_workout_id AND user_id = caller RETURNING id INTO result_id; IF NOT FOUND THEN RAISE EXCEPTION 'That planned workout is unavailable.'; END IF; END IF;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.athlete_save_recovery(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = athlete, public
AS $$
DECLARE
  caller uuid := public.athlete_require_user(); result_id uuid;
  v_date date := COALESCE(NULLIF(p_payload ->> 'recovery_date', '')::date, current_date);
  v_score integer := NULLIF(p_payload ->> 'score', '')::integer;
  v_notes text := COALESCE(p_payload ->> 'notes', '');
  v_source text := COALESCE(NULLIF(btrim(p_payload ->> 'source'), ''), 'manual');
BEGIN
  IF v_score IS NULL OR v_score NOT BETWEEN 1 AND 100 OR v_source NOT IN ('manual', 'whoop') OR char_length(v_notes) > 700 THEN RAISE EXCEPTION 'Check the recovery score details.'; END IF;
  INSERT INTO athlete.recovery_scores (user_id, recovery_date, score, notes, source) VALUES (caller, v_date, v_score, v_notes, v_source)
  ON CONFLICT (user_id, recovery_date) DO UPDATE SET score = EXCLUDED.score, notes = EXCLUDED.notes, source = EXCLUDED.source, updated_at = now()
  RETURNING id INTO result_id;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.athlete_save_race(p_race_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = athlete, public
AS $$
DECLARE
  caller uuid := public.athlete_require_user(); result_id uuid;
  v_name text := btrim(COALESCE(p_payload ->> 'name', '')); v_date date := NULLIF(p_payload ->> 'race_date', '')::date;
  v_distance numeric := NULLIF(p_payload ->> 'distance_meters', '')::numeric; v_location text := COALESCE(p_payload ->> 'location', '');
  v_finish integer := NULLIF(p_payload ->> 'finish_seconds', '')::integer; v_notes text := COALESCE(p_payload ->> 'notes', '');
BEGIN
  IF char_length(v_name) NOT BETWEEN 1 AND 120 OR v_date IS NULL OR (v_distance IS NOT NULL AND v_distance < 0) OR (v_finish IS NOT NULL AND v_finish <= 0) OR char_length(v_location) > 160 OR char_length(v_notes) > 1500 THEN RAISE EXCEPTION 'Check the race details.'; END IF;
  IF p_race_id IS NULL THEN INSERT INTO athlete.races (user_id, name, race_date, distance_meters, location, finish_seconds, notes) VALUES (caller, v_name, v_date, v_distance, v_location, v_finish, v_notes) RETURNING id INTO result_id;
  ELSE UPDATE athlete.races SET name = v_name, race_date = v_date, distance_meters = v_distance, location = v_location, finish_seconds = v_finish, notes = v_notes, updated_at = now() WHERE id = p_race_id AND user_id = caller RETURNING id INTO result_id; IF NOT FOUND THEN RAISE EXCEPTION 'That race is unavailable.'; END IF; END IF;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.athlete_save_gym_session(p_session_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = athlete, public
AS $$
DECLARE
  caller uuid := public.athlete_require_user(); result_id uuid;
  v_title text := btrim(COALESCE(p_payload ->> 'title', '')); v_date date := COALESCE(NULLIF(p_payload ->> 'session_date', '')::date, current_date);
  v_duration integer := NULLIF(p_payload ->> 'duration_minutes', '')::integer; v_exercises jsonb := COALESCE(p_payload -> 'exercises', '[]'::jsonb); v_notes text := COALESCE(p_payload ->> 'notes', '');
BEGIN
  IF char_length(v_title) NOT BETWEEN 1 AND 100 OR (v_duration IS NOT NULL AND v_duration <= 0) OR jsonb_typeof(v_exercises) <> 'array' OR jsonb_array_length(v_exercises) > 30 OR char_length(v_notes) > 1500 THEN RAISE EXCEPTION 'Check the strength workout details.'; END IF;
  IF p_session_id IS NULL THEN INSERT INTO athlete.gym_sessions (user_id, session_date, title, duration_minutes, exercises, notes) VALUES (caller, v_date, v_title, v_duration, v_exercises, v_notes) RETURNING id INTO result_id;
  ELSE UPDATE athlete.gym_sessions SET session_date = v_date, title = v_title, duration_minutes = v_duration, exercises = v_exercises, notes = v_notes, updated_at = now() WHERE id = p_session_id AND user_id = caller RETURNING id INTO result_id; IF NOT FOUND THEN RAISE EXCEPTION 'That strength workout is unavailable.'; END IF; END IF;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.athlete_save_goal(p_goal_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = athlete, public
AS $$
DECLARE
  caller uuid := public.athlete_require_user(); result_id uuid;
  v_title text := btrim(COALESCE(p_payload ->> 'title', '')); v_target numeric := NULLIF(p_payload ->> 'target_distance_meters', '')::numeric;
  v_start date := NULLIF(p_payload ->> 'starts_on', '')::date; v_end date := NULLIF(p_payload ->> 'ends_on', '')::date;
BEGIN
  IF char_length(v_title) NOT BETWEEN 1 AND 100 OR v_target IS NULL OR v_target <= 0 OR v_start IS NULL OR v_end IS NULL OR v_end < v_start THEN RAISE EXCEPTION 'Check the running goal details.'; END IF;
  IF p_goal_id IS NULL THEN INSERT INTO athlete.goals (user_id, title, target_distance_meters, starts_on, ends_on) VALUES (caller, v_title, v_target, v_start, v_end) RETURNING id INTO result_id;
  ELSE UPDATE athlete.goals SET title = v_title, target_distance_meters = v_target, starts_on = v_start, ends_on = v_end, updated_at = now() WHERE id = p_goal_id AND user_id = caller RETURNING id INTO result_id; IF NOT FOUND THEN RAISE EXCEPTION 'That goal is unavailable.'; END IF; END IF;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.athlete_delete_record(p_record_type text, p_record_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = athlete, public
AS $$
DECLARE caller uuid := public.athlete_require_user();
BEGIN
  IF p_record_type = 'planned_workout' THEN DELETE FROM athlete.planned_workouts WHERE id = p_record_id AND user_id = caller;
  ELSIF p_record_type = 'race' THEN DELETE FROM athlete.races WHERE id = p_record_id AND user_id = caller;
  ELSIF p_record_type = 'gym_session' THEN DELETE FROM athlete.gym_sessions WHERE id = p_record_id AND user_id = caller;
  ELSIF p_record_type = 'goal' THEN DELETE FROM athlete.goals WHERE id = p_record_id AND user_id = caller;
  ELSE RAISE EXCEPTION 'Unsupported Athlete Hub record.'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'That record is unavailable.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.athlete_delete_all_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = athlete, public
AS $$
DECLARE caller uuid := public.athlete_require_user();
BEGIN
  DELETE FROM athlete.activities WHERE user_id = caller;
  DELETE FROM athlete.planned_workouts WHERE user_id = caller;
  DELETE FROM athlete.recovery_scores WHERE user_id = caller;
  DELETE FROM athlete.races WHERE user_id = caller;
  DELETE FROM athlete.gym_sessions WHERE user_id = caller;
  DELETE FROM athlete.goals WHERE user_id = caller;
  DELETE FROM athlete.settings WHERE user_id = caller;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.athlete_require_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.athlete_get_dashboard() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.athlete_save_settings(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.athlete_save_activity(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.athlete_delete_activity(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.athlete_save_planned_workout(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.athlete_save_recovery(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.athlete_save_race(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.athlete_save_gym_session(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.athlete_save_goal(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.athlete_delete_record(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.athlete_delete_all_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_get_dashboard(), public.athlete_save_settings(text, text, text), public.athlete_save_activity(uuid, jsonb), public.athlete_delete_activity(uuid), public.athlete_save_planned_workout(uuid, jsonb), public.athlete_save_recovery(jsonb), public.athlete_save_race(uuid, jsonb), public.athlete_save_gym_session(uuid, jsonb), public.athlete_save_goal(uuid, jsonb), public.athlete_delete_record(text, uuid), public.athlete_delete_all_data() TO authenticated;
