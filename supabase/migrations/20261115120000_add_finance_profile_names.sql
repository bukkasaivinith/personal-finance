/*
  Personal profile names.

  Names are kept separately from finance data. Existing accounts retain their
  current profiles and are asked once to complete these fields after sign-in.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_first_name_valid;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_first_name_valid CHECK (
    first_name IS NULL OR (
      first_name = btrim(first_name)
      AND char_length(first_name) BETWEEN 1 AND 80
      AND first_name !~ '[[:cntrl:]]'
    )
  );

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_last_name_valid;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_last_name_valid CHECK (
    last_name IS NULL OR (
      last_name = btrim(last_name)
      AND char_length(last_name) BETWEEN 1 AND 80
      AND last_name !~ '[[:cntrl:]]'
    )
  );

/* Capture validated names submitted while a new account is being created. */
CREATE OR REPLACE FUNCTION public.sync_profile_from_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  supplied_first_name text := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'first_name', '')), '');
  supplied_last_name text := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'last_name', '')), '');
BEGIN
  IF supplied_first_name IS NOT NULL AND (
    char_length(supplied_first_name) > 80 OR supplied_first_name ~ '[[:cntrl:]]'
  ) THEN
    supplied_first_name := NULL;
  END IF;
  IF supplied_last_name IS NOT NULL AND (
    char_length(supplied_last_name) > 80 OR supplied_last_name ~ '[[:cntrl:]]'
  ) THEN
    supplied_last_name := NULL;
  END IF;

  INSERT INTO public.profiles AS profile (id, email, first_name, last_name)
  VALUES (NEW.id, lower(NEW.email), supplied_first_name, supplied_last_name)
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      first_name = COALESCE(profile.first_name, EXCLUDED.first_name),
      last_name = COALESCE(profile.last_name, EXCLUDED.last_name);

  IF lower(NEW.email) = 'bukkasaivinith2@gmail.com' THEN
    INSERT INTO public.platform_administrators (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_finance_profile()
RETURNS TABLE(
  id uuid,
  email text,
  first_name text,
  last_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile.id, profile.email, profile.first_name, profile.last_name
  FROM public.profiles profile
  WHERE profile.id = auth.uid() AND profile.deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.set_current_finance_profile_name(
  p_first_name text,
  p_last_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean_first_name text := btrim(COALESCE(p_first_name, ''));
  clean_last_name text := btrim(COALESCE(p_last_name, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  IF char_length(clean_first_name) NOT BETWEEN 1 AND 80
     OR char_length(clean_last_name) NOT BETWEEN 1 AND 80
     OR clean_first_name ~ '[[:cntrl:]]'
     OR clean_last_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Enter a valid first name and last name.';
  END IF;

  UPDATE public.profiles
  SET first_name = clean_first_name,
      last_name = clean_last_name
  WHERE id = auth.uid() AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your profile is unavailable.';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_current_finance_profile(), public.set_current_finance_profile_name(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_finance_profile(), public.set_current_finance_profile_name(text, text) TO authenticated;
