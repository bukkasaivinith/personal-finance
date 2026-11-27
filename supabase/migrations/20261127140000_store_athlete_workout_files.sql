BEGIN;

ALTER TABLE athlete.activity_media
  DROP CONSTRAINT activity_media_mime_check,
  DROP CONSTRAINT activity_media_content_check,
  ADD CONSTRAINT activity_media_type_and_size_check CHECK (
    (mime IN ('image/jpeg', 'image/png', 'image/webp') AND octet_length(content) BETWEEN 1 AND 4194304)
    OR (mime = 'application/octet-stream' AND name ~* '[.](gpx|gtx|tcx|fit)$'
      AND octet_length(content) BETWEEN 1 AND 10485760)
  );

CREATE OR REPLACE FUNCTION athlete.append_activity_media(p_activity_id uuid, p_batch_id uuid, p_media jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := public.athlete_require_user();
  existing_count int;
  existing_bytes bigint;
  screenshot_bytes bigint;
  workout_count int;
  workout_bytes bigint;
BEGIN
  PERFORM 1 FROM athlete.activities WHERE id = p_activity_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That activity is unavailable.'; END IF;

  IF p_batch_id IS NULL OR jsonb_typeof(p_media) IS DISTINCT FROM 'array'
     OR octet_length(p_media::text) > 31000000 THEN
    RAISE EXCEPTION 'Attachments exceed the size limit for one save.';
  END IF;
  IF jsonb_array_length(p_media) NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'Choose between 1 and 24 activity attachments.';
  END IF;
  IF EXISTS (SELECT 1 FROM athlete.activity_media WHERE activity_id = p_activity_id AND batch_id = p_batch_id) THEN RETURN; END IF;

  SELECT count(*), COALESCE(sum(octet_length(content)), 0) INTO existing_count, existing_bytes
    FROM athlete.activity_media WHERE activity_id = p_activity_id;
  IF existing_count + jsonb_array_length(p_media) > 60 THEN
    RAISE EXCEPTION 'An activity can have up to 60 attachments.';
  END IF;
  SELECT count(*) FILTER (WHERE mime = 'application/octet-stream'),
    COALESCE(sum(bytes) FILTER (WHERE mime = 'application/octet-stream'), 0),
    COALESCE(sum(bytes) FILTER (WHERE mime <> 'application/octet-stream'), 0)
  INTO workout_count, workout_bytes, screenshot_bytes
  FROM (
    SELECT item ->> 'mime' AS mime, octet_length(decode(item ->> 'data', 'base64')) AS bytes
    FROM jsonb_array_elements(p_media) AS item
  ) AS attachments;
  IF workout_count > 1 OR workout_bytes > 10485760 THEN
    RAISE EXCEPTION 'Choose one workout file up to 10 MB per save.';
  END IF;
  IF screenshot_bytes > 12582912 OR existing_bytes + screenshot_bytes + workout_bytes > 33554432 THEN
    RAISE EXCEPTION 'Screenshots are limited to 12 MB per save and total attachments to 32 MB per activity.';
  END IF;

  INSERT INTO athlete.activity_media (activity_id, batch_id, position, name, mime, content)
  SELECT p_activity_id, p_batch_id, position, item ->> 'name', item ->> 'mime', decode(item ->> 'data', 'base64')
  FROM jsonb_array_elements(p_media) WITH ORDINALITY AS attachment(item, position);
END;
$$;

COMMIT;
