/*
  Platform administration audit history.

  This is intentionally separate from workspace audit_events: it records only
  account-access actions performed by a platform administrator and never holds
  balances, transactions, accounts, or other financial data.
*/

CREATE TABLE IF NOT EXISTS public.platform_admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid NOT NULL,
  target_email text NOT NULL,
  action text NOT NULL CHECK (action IN (
    'account_suspended', 'account_reactivated', 'session_terminated', 'account_deleted'
  )),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_admin_activity_log_occurred_at_idx
  ON public.platform_admin_activity_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS platform_admin_activity_log_target_idx
  ON public.platform_admin_activity_log (target_user_id, occurred_at DESC);

ALTER TABLE public.platform_admin_activity_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admin_activity_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_admin_activity(
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  actor_email text,
  target_email text,
  action text,
  details jsonb,
  occurred_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  safe_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.';
  END IF;

  RETURN QUERY
    SELECT event.id,
           COALESCE(actor.email, 'Administrator') AS actor_email,
           event.target_email,
           event.action,
           event.details,
           event.occurred_at
    FROM public.platform_admin_activity_log event
    LEFT JOIN public.profiles actor ON actor.id = event.actor_id
    ORDER BY event.occurred_at DESC
    LIMIT safe_limit OFFSET safe_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_platform_user_suspension(p_user_id uuid, p_suspended boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_email text;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Administrator access is required.'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'An administrator cannot suspend their own account.'; END IF;

  SELECT email INTO target_email
  FROM public.profiles
  WHERE id = p_user_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That user is unavailable.'; END IF;

  UPDATE public.profiles SET is_suspended = p_suspended WHERE id = p_user_id;
  INSERT INTO public.platform_admin_activity_log (actor_id, target_user_id, target_email, action, details)
  VALUES (
    auth.uid(), p_user_id, target_email,
    CASE WHEN p_suspended THEN 'account_suspended' ELSE 'account_reactivated' END,
    jsonb_build_object('Access', CASE WHEN p_suspended THEN 'Suspended' ELSE 'Reactivated' END)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_terminate_user_session(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_email text;
  terminated_count integer;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Administrator access is required.'; END IF;
  SELECT email INTO target_email FROM public.profiles WHERE id = p_user_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That user is unavailable.'; END IF;

  UPDATE public.active_user_sessions
  SET revoked_at = now(), last_activity_at = now(), updated_at = now()
  WHERE user_id = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS terminated_count = ROW_COUNT;

  IF terminated_count > 0 THEN
    INSERT INTO public.audit_events (user_id, actor_id, entity_table, entity_id, entity_name, action, details)
    VALUES (p_user_id, auth.uid(), 'authentication', p_user_id, target_email, 'signed_out',
      jsonb_build_object('Reason', 'Session terminated by administrator'));
    INSERT INTO public.platform_admin_activity_log (actor_id, target_user_id, target_email, action, details)
    VALUES (auth.uid(), p_user_id, target_email, 'session_terminated', jsonb_build_object('Terminated sessions', terminated_count));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_platform_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_email text;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Administrator access is required.'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Use your own account deletion control.'; END IF;

  SELECT email INTO target_email FROM public.profiles WHERE id = p_user_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That user is unavailable.'; END IF;

  INSERT INTO public.platform_admin_activity_log (actor_id, target_user_id, target_email, action, details)
  VALUES (auth.uid(), p_user_id, target_email, 'account_deleted', jsonb_build_object('Financial data handling', 'Deleted with the user account'));

  PERFORM public.purge_finance_user(p_user_id);
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_platform_admin_activity(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_platform_admin_activity(integer, integer) TO authenticated;
