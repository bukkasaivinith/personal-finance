CREATE TABLE athlete.workout_details (
  activity_id uuid PRIMARY KEY REFERENCES athlete.activities(id) ON DELETE CASCADE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16000000)
);

CREATE TABLE athlete.workout_imports (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  activity_id uuid NOT NULL REFERENCES athlete.activities(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, fingerprint)
);

ALTER TABLE athlete.workout_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete.workout_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON athlete.workout_details, athlete.workout_imports FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.athlete_get_workout_details(p_activity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := public.athlete_require_user();
  result jsonb;
BEGIN
  SELECT details.payload INTO result
  FROM athlete.activities AS activity
  LEFT JOIN athlete.workout_details AS details ON details.activity_id = activity.id
  WHERE activity.id = p_activity_id AND activity.user_id = caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'That activity is unavailable.'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.athlete_save_workout(p_activity_id uuid, p_payload jsonb, p_details jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := public.athlete_require_user();
  result_id uuid;
  fingerprints jsonb := COALESCE(p_details -> 'fingerprints', '[]'::jsonb);
  fingerprint_value text;
  existing_activity uuid;
BEGIN
  IF jsonb_typeof(p_details) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_details -> 'metrics') IS DISTINCT FROM 'object'
     OR jsonb_typeof(fingerprints) IS DISTINCT FROM 'array'
     OR octet_length(p_details::text) > 16000000 THEN
    RAISE EXCEPTION 'Invalid workout details.';
  END IF;
  IF p_details ? 'source' AND p_details ->> 'source' NOT IN ('Samsung Health', 'WHOOP', 'FIT', 'GPX', 'TCX') THEN
    RAISE EXCEPTION 'Invalid workout source.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_details -> 'metrics') AS metric WHERE jsonb_typeof(metric.value) NOT IN ('number', 'null')) THEN
    RAISE EXCEPTION 'Workout metrics must be numbers.';
  END IF;
  IF jsonb_array_length(fingerprints) > 24 THEN RAISE EXCEPTION 'Too many import files for one save.'; END IF;
  IF p_details ? 'samples' THEN
    IF jsonb_typeof(p_details -> 'samples') <> 'array' OR jsonb_array_length(p_details -> 'samples') > 100000 THEN
      RAISE EXCEPTION 'Invalid workout samples.';
    END IF;
  END IF;
  -- Serialize the rare imports for each owner so overlapping batches cannot create two activities.
  PERFORM pg_advisory_xact_lock(hashtextextended(caller::text, 291582));
  FOR fingerprint_value IN SELECT value FROM jsonb_array_elements_text(fingerprints) AS input(value) LOOP
    IF fingerprint_value IS NULL OR fingerprint_value !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid import fingerprint.'; END IF;
    SELECT activity_id INTO existing_activity FROM athlete.workout_imports
      WHERE user_id = caller AND fingerprint = fingerprint_value;
    IF FOUND AND existing_activity IS DISTINCT FROM p_activity_id THEN
      RAISE EXCEPTION 'One or more files were already saved to an activity. Open that activity to update it.';
    END IF;
  END LOOP;
  result_id := public.athlete_save_activity(p_activity_id, p_payload);
  INSERT INTO athlete.workout_details AS saved (activity_id, payload)
  VALUES (result_id, p_details - 'fingerprints')
  ON CONFLICT (activity_id) DO UPDATE SET payload =
    (saved.payload || excluded.payload) ||
    jsonb_build_object('metrics', jsonb_strip_nulls((saved.payload -> 'metrics') || (excluded.payload -> 'metrics')));
  INSERT INTO athlete.workout_imports (user_id, fingerprint, activity_id)
  SELECT DISTINCT caller, value, result_id FROM jsonb_array_elements_text(fingerprints) AS input(value)
  ON CONFLICT (user_id, fingerprint) DO NOTHING;
  RETURN result_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.athlete_get_workout_details(uuid), public.athlete_save_workout(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_get_workout_details(uuid), public.athlete_save_workout(uuid, jsonb, jsonb) TO authenticated;
