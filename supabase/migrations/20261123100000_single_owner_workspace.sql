BEGIN;

-- Bind the workspace to the existing verified account, never to an email supplied
-- by a browser or to a future account registered with the same address.
CREATE TABLE public.finance_workspace_owner (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id uuid NOT NULL
);
ALTER TABLE public.finance_workspace_owner ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_workspace_owner FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  owner_ids uuid[];
BEGIN
  SELECT array_agg(u.id) INTO owner_ids
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = 'bukkasaivinith@gmail.com'
    AND u.email_confirmed_at IS NOT NULL
    AND p.deleted_at IS NULL
    AND NOT p.is_suspended;
  IF COALESCE(cardinality(owner_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'Expected one active, verified account for bukkasaivinith@gmail.com. No changes were applied.';
  END IF;
  INSERT INTO public.finance_workspace_owner (user_id) VALUES (owner_ids[1]);
END;
$$;

CREATE FUNCTION public.is_finance_workspace_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.finance_workspace_owner settings
    JOIN public.profiles profile ON profile.id = settings.user_id
    WHERE settings.user_id = auth.uid()
      AND profile.deleted_at IS NULL
      AND NOT profile.is_suspended
  );
$$;
REVOKE ALL ON FUNCTION public.is_finance_workspace_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_finance_workspace_owner() TO authenticated;

-- Existing RLS policies and privileged finance functions reuse this check.
CREATE OR REPLACE FUNCTION public.is_current_single_device_session()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp AS $$
  SELECT public.is_finance_workspace_owner()
    AND public.current_single_device_session_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.active_user_sessions active_session
      WHERE active_session.user_id = auth.uid()
        AND active_session.session_id_hash = public.current_single_device_session_hash()
        AND active_session.revoked_at IS NULL
        AND active_session.expires_at > now()
    )
    AND EXISTS (
      SELECT 1 FROM auth.sessions auth_session
      WHERE auth_session.id = public.current_single_device_session_id()
        AND auth_session.user_id = auth.uid()
        AND (auth_session.not_after IS NULL OR auth_session.not_after > now())
    );
$$;

ALTER FUNCTION public.activate_current_single_device_session() RENAME TO activate_finance_session_internal;
REVOKE ALL ON FUNCTION public.activate_finance_session_internal() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.activate_current_single_device_session()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_finance_workspace_owner() THEN
    RAISE EXCEPTION 'This finance workspace is available only to its owner.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.activate_finance_session_internal();
END;
$$;
REVOKE ALL ON FUNCTION public.activate_current_single_device_session() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_current_single_device_session() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_workspace_access(p_owner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE(public.is_finance_user_active(p_owner_id), false);
$$;

-- Existing policies and transaction RPCs refer to these signatures.
CREATE OR REPLACE FUNCTION public.is_workspace_editor(p_owner_id uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$ SELECT false; $$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$ SELECT false; $$;

CREATE OR REPLACE FUNCTION public.can_view_account(p_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT public.is_finance_user_active(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_account(p_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT public.can_view_account(p_account_id);
$$;

CREATE OR REPLACE FUNCTION public.open_finance_workspace()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.require_current_single_device_session();
  PERFORM public.claim_unowned_finance_data();
END;
$$;

-- Older app versions can still open the owner's workspace.
CREATE OR REPLACE FUNCTION public.list_accessible_workspaces()
RETURNS TABLE(owner_id uuid, owner_email text, role text, account_count bigint, is_platform_admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT p.id, p.email, 'owner'::text,
         (SELECT count(*) FROM public.accounts a WHERE a.user_id = p.id AND a.deleted_at IS NULL),
         false
  FROM public.profiles p
  WHERE p.id = auth.uid() AND public.is_finance_user_active(p.id);
$$;

CREATE OR REPLACE FUNCTION public.get_current_finance_profile()
RETURNS TABLE(id uuid, email text, first_name text, last_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT p.id, p.email, p.first_name, p.last_name
  FROM public.profiles p
  WHERE p.id = auth.uid() AND public.is_finance_user_active(p.id);
$$;

ALTER FUNCTION public.set_current_finance_profile_name(text, text) RENAME TO set_finance_profile_name_internal;
REVOKE ALL ON FUNCTION public.set_finance_profile_name_internal(text, text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.set_current_finance_profile_name(p_first_name text, p_last_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.require_current_single_device_session();
  PERFORM public.set_finance_profile_name_internal(p_first_name, p_last_name);
END;
$$;
REVOKE ALL ON FUNCTION public.set_current_finance_profile_name(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_current_finance_profile_name(text, text) TO authenticated;

-- Signup still captures the user's profile without granting a platform role.
CREATE OR REPLACE FUNCTION public.sync_profile_from_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  supplied_first_name text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'first_name'), '');
  supplied_last_name text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'last_name'), '');
BEGIN
  IF char_length(supplied_first_name) > 80 OR supplied_first_name ~ '[[:cntrl:]]' THEN
    supplied_first_name := NULL;
  END IF;
  IF char_length(supplied_last_name) > 80 OR supplied_last_name ~ '[[:cntrl:]]' THEN
    supplied_last_name := NULL;
  END IF;
  INSERT INTO public.profiles AS profile (id, email, first_name, last_name)
  VALUES (NEW.id, lower(NEW.email), supplied_first_name, supplied_last_name)
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      first_name = COALESCE(profile.first_name, EXCLUDED.first_name),
      last_name = COALESCE(profile.last_name, EXCLUDED.last_name);
  RETURN NEW;
END;
$$;

-- Keep historical rows intact while disabling browser access to these controls.
REVOKE ALL ON public.workspace_members, public.account_shares, public.platform_administrators,
  public.workspace_invitations, public.workspace_invitation_accounts,
  public.workspace_notifications, public.platform_admin_activity_log
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.get_workspace_sharing(uuid),
  public.create_workspace_invitation(uuid, text, text, uuid[], text),
  public.cancel_workspace_invitation(uuid),
  public.update_workspace_member_access(uuid, uuid, text, uuid[]),
  public.revoke_workspace_member(uuid, uuid),
  public.mark_workspace_notifications_read(uuid),
  public.notify_workspace_owner(uuid, uuid, text),
  public.claim_unowned_finance_data(),
  public.list_platform_users(),
  public.set_platform_user_suspension(uuid, boolean),
  public.delete_platform_user(uuid),
  public.list_platform_user_sessions(),
  public.admin_terminate_user_session(uuid),
  public.list_platform_admin_activity(integer, integer),
  public.list_platform_user_usage()
FROM PUBLIC, anon, authenticated;

COMMIT;
