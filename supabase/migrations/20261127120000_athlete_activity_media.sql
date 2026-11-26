BEGIN;

CREATE TABLE athlete.activity_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES athlete.activities(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  position int NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 4194304),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, batch_id, position)
);

CREATE INDEX activity_media_batch_idx ON athlete.activity_media (batch_id);
ALTER TABLE athlete.activity_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE athlete.activity_media FROM PUBLIC, anon, authenticated;

CREATE FUNCTION athlete.append_activity_media(p_activity_id uuid, p_batch_id uuid, p_media jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := public.athlete_require_user();
  existing_count int;
  existing_bytes bigint;
  added_bytes bigint;
BEGIN
  PERFORM 1 FROM athlete.activities
    WHERE id = p_activity_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That activity is unavailable.'; END IF;

  IF p_batch_id IS NULL OR jsonb_typeof(p_media) IS DISTINCT FROM 'array'
     OR octet_length(p_media::text) > 17000000 THEN
    RAISE EXCEPTION 'Attachments exceed the 12 MB limit for one save.';
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
  SELECT sum(octet_length(decode(item ->> 'data', 'base64'))) INTO added_bytes
    FROM jsonb_array_elements(p_media) AS item;
  IF added_bytes > 12582912 OR existing_bytes + added_bytes > 33554432 THEN
    RAISE EXCEPTION 'Activity attachments are limited to 12 MB per save and 32 MB per activity.';
  END IF;

  INSERT INTO athlete.activity_media (activity_id, batch_id, position, name, mime, content)
  SELECT p_activity_id, p_batch_id, position, item ->> 'name', item ->> 'mime', decode(item ->> 'data', 'base64')
  FROM jsonb_array_elements(p_media) WITH ORDINALITY AS attachment(item, position);
END;
$$;
REVOKE ALL ON FUNCTION athlete.append_activity_media(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.athlete_save_activity_with_media(
  p_activity_id uuid, p_payload jsonb, p_details jsonb, p_batch_id uuid, p_media jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := public.athlete_require_user();
  activity_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(caller::text, 904327));
  SELECT media.activity_id INTO activity_id
  FROM athlete.activity_media AS media
  JOIN athlete.activities AS activity ON activity.id = media.activity_id
  WHERE media.batch_id = p_batch_id AND activity.user_id = caller
  LIMIT 1;
  IF FOUND THEN
    IF p_activity_id IS NOT NULL AND p_activity_id <> activity_id THEN
      RAISE EXCEPTION 'That upload belongs to a different activity.';
    END IF;
    RETURN activity_id;
  END IF;

  activity_id := CASE WHEN p_details IS NULL THEN public.athlete_save_activity(p_activity_id, p_payload)
    ELSE public.athlete_save_workout(p_activity_id, p_payload, p_details) END;
  PERFORM athlete.append_activity_media(activity_id, p_batch_id, p_media);
  RETURN activity_id;
END;
$$;

CREATE FUNCTION public.athlete_add_activity_media(p_activity_id uuid, p_batch_id uuid, p_media jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT athlete.append_activity_media(p_activity_id, p_batch_id, p_media);
$$;

CREATE FUNCTION public.athlete_get_activity_page(p_activity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := public.athlete_require_user();
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'activity', to_jsonb(activity) - 'user_id',
    'distance_unit', COALESCE(settings.distance_unit, 'km'),
    'weight_unit', COALESCE(settings.weight_unit, 'kg'),
    'timezone', settings.timezone,
    'details', workout.payload,
    'media', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', media.id, 'batch_id', media.batch_id,
        'name', media.name, 'mime', media.mime, 'created_at', media.created_at
      ) ORDER BY media.created_at DESC, media.batch_id, media.position)
      FROM athlete.activity_media AS media WHERE media.activity_id = activity.id
    ), '[]'::jsonb)
  ) INTO result
  FROM athlete.activities AS activity
  LEFT JOIN athlete.settings AS settings ON settings.user_id = activity.user_id
  LEFT JOIN athlete.workout_details AS workout ON workout.activity_id = activity.id
  WHERE activity.id = p_activity_id AND activity.user_id = caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'That activity is unavailable.'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.athlete_get_activity_media(p_media_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := public.athlete_require_user();
  result text;
BEGIN
  SELECT encode(media.content, 'base64') INTO result
  FROM athlete.activity_media AS media
  JOIN athlete.activities AS activity ON activity.id = media.activity_id
  WHERE media.id = p_media_id AND activity.user_id = caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'That attachment is unavailable.'; END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.athlete_save_activity_with_media(uuid, jsonb, jsonb, uuid, jsonb),
  public.athlete_add_activity_media(uuid, uuid, jsonb), public.athlete_get_activity_page(uuid),
  public.athlete_get_activity_media(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athlete_save_activity_with_media(uuid, jsonb, jsonb, uuid, jsonb),
  public.athlete_add_activity_media(uuid, uuid, jsonb), public.athlete_get_activity_page(uuid),
  public.athlete_get_activity_media(uuid) TO authenticated;
COMMIT;
