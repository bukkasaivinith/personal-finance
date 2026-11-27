BEGIN;

CREATE FUNCTION public.athlete_combine_activities(p_keep_id uuid, p_other_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := public.athlete_require_user();
  locked_rows integer;
  kept athlete.activities%ROWTYPE;
  other athlete.activities%ROWTYPE;
  kept_details jsonb;
  other_details jsonb;
  combined_details jsonb;
  combined_notes text;
  collection text;
BEGIN
  IF p_keep_id IS NULL OR p_other_id IS NULL OR p_keep_id = p_other_id THEN
    RAISE EXCEPTION 'Choose two different activities to combine.';
  END IF;

  -- Follow the lock order used when saving workout details with screenshots.
  PERFORM pg_advisory_xact_lock(hashtextextended(caller::text, 904327));
  PERFORM pg_advisory_xact_lock(hashtextextended(caller::text, 291582));
  PERFORM 1 FROM athlete.activities
    WHERE user_id = caller AND id IN (p_keep_id, p_other_id) ORDER BY id FOR UPDATE;
  GET DIAGNOSTICS locked_rows = ROW_COUNT;
  IF locked_rows <> 2 THEN RAISE EXCEPTION 'One or more activities are unavailable.'; END IF;

  SELECT * INTO STRICT kept FROM athlete.activities WHERE id = p_keep_id;
  SELECT * INTO STRICT other FROM athlete.activities WHERE id = p_other_id;
  combined_notes := CASE WHEN btrim(kept.notes) = btrim(other.notes) THEN kept.notes
    ELSE concat_ws(E'\n\n', NULLIF(btrim(kept.notes), ''), NULLIF(btrim(other.notes), '')) END;
  IF char_length(combined_notes) > 1500 THEN
    RAISE EXCEPTION 'The combined notes exceed 1,500 characters. Edit the notes before combining.';
  END IF;

  kept_details := COALESCE((SELECT payload FROM athlete.workout_details WHERE activity_id = p_keep_id), '{}'::jsonb);
  other_details := COALESCE((SELECT payload FROM athlete.workout_details WHERE activity_id = p_other_id), '{}'::jsonb);
  IF COALESCE(jsonb_array_length(kept_details -> 'samples'), 0) > 0
    AND COALESCE(jsonb_array_length(other_details -> 'samples'), 0) > 0
    AND kept_details -> 'samples' <> other_details -> 'samples' THEN
    RAISE EXCEPTION 'The activities have different workout timelines. Choose a screenshot-only entry to combine with the workout file.';
  END IF;

  IF kept_details <> '{}'::jsonb OR other_details <> '{}'::jsonb THEN
    combined_details := (other_details || kept_details) || jsonb_build_object('metrics',
      COALESCE(other_details -> 'metrics', '{}'::jsonb) || COALESCE(kept_details -> 'metrics', '{}'::jsonb));
    FOREACH collection IN ARRAY ARRAY['samples', 'route', 'laps', 'zones'] LOOP
      IF COALESCE(kept_details -> collection, '[]'::jsonb) IN ('[]'::jsonb, 'null'::jsonb)
        AND other_details ? collection THEN
        combined_details := jsonb_set(combined_details, ARRAY[collection], other_details -> collection);
      END IF;
    END LOOP;
    IF octet_length(combined_details::text) > 16000000 THEN
      RAISE EXCEPTION 'The combined workout details exceed the size limit.';
    END IF;
    INSERT INTO athlete.workout_details (activity_id, payload) VALUES (p_keep_id, combined_details)
      ON CONFLICT (activity_id) DO UPDATE SET payload = excluded.payload;
  END IF;

  UPDATE athlete.activities SET
    duration_seconds = COALESCE(kept.duration_seconds, other.duration_seconds),
    distance_meters = COALESCE(kept.distance_meters, other.distance_meters),
    average_heart_rate = COALESCE(kept.average_heart_rate, other.average_heart_rate),
    calories = COALESCE(kept.calories, other.calories),
    elevation_meters = COALESCE(kept.elevation_meters, other.elevation_meters),
    cadence = COALESCE(kept.cadence, other.cadence),
    effort = COALESCE(kept.effort, other.effort),
    notes = combined_notes,
    updated_at = now()
  WHERE id = p_keep_id AND user_id = caller;

  WITH overlapping_batches AS MATERIALIZED (
    SELECT existing.batch_id, gen_random_uuid() AS new_batch
    FROM (SELECT DISTINCT batch_id FROM athlete.activity_media WHERE activity_id = p_keep_id) AS existing
    WHERE EXISTS (SELECT 1 FROM athlete.activity_media AS incoming
      WHERE incoming.activity_id = p_other_id AND incoming.batch_id = existing.batch_id)
  )
  UPDATE athlete.activity_media AS media SET activity_id = p_keep_id,
    batch_id = COALESCE((SELECT new_batch FROM overlapping_batches WHERE batch_id = media.batch_id), media.batch_id)
  WHERE media.activity_id = p_other_id;

  UPDATE athlete.workout_imports SET activity_id = p_keep_id WHERE user_id = caller AND activity_id = p_other_id;
  DELETE FROM athlete.activities WHERE id = p_other_id AND user_id = caller;
  RETURN p_keep_id;
END;
$$;

REVOKE ALL ON FUNCTION public.athlete_combine_activities(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athlete_combine_activities(uuid, uuid) TO authenticated;
COMMIT;
