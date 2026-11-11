/*
  Single-device finance sessions

  Supabase Auth remains responsible for credential verification and refresh-token
  rotation. This migration adds an application-level session gate for the
  finance workspace: a user can have exactly one active JWT session ID at a
  time. The raw session ID is never stored in public tables; only a SHA-256
  hash is retained.

  Existing tables, users, relationships and owner/sharing policies are kept.
  The additional restrictive RLS policies are an AND condition on top of the
  existing policies, so an outdated browser cannot read or mutate finance data.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.active_user_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id_hash text NOT NULL,
  session_started_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS active_user_sessions_active_idx
  ON public.active_user_sessions (expires_at, last_activity_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.active_user_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.active_user_sessions FROM PUBLIC, anon, authenticated;

/*
  Preserve the most recently-created, still-valid Auth session for people who
  are already signed in when this migration is applied. This avoids letting an
  older browser become active simply because it happens to refresh first.
*/
INSERT INTO public.active_user_sessions (
  user_id, session_id_hash, session_started_at, last_activity_at,
  expires_at, revoked_at, user_agent, created_at, updated_at
)
SELECT DISTINCT ON (auth_session.user_id)
  auth_session.user_id,
  encode(extensions.digest(auth_session.id::text, 'sha256'), 'hex'),
  auth_session.created_at,
  COALESCE(auth_session.refreshed_at, auth_session.updated_at, auth_session.created_at),
  LEAST(COALESCE(auth_session.not_after, auth_session.created_at + interval '30 days'), auth_session.created_at + interval '30 days'),
  NULL,
  NULLIF(left(auth_session.user_agent, 500), ''),
  now(),
  now()
FROM auth.sessions auth_session
WHERE auth_session.not_after IS NULL OR auth_session.not_after > now()
ORDER BY auth_session.user_id, auth_session.created_at DESC, auth_session.id DESC
ON CONFLICT (user_id) DO NOTHING;

/* These helpers read only the signed JWT claim. Clients never submit a token. */
CREATE OR REPLACE FUNCTION public.current_single_device_session_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN COALESCE(auth.jwt() ->> 'session_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (auth.jwt() ->> 'session_id')::uuid
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.current_single_device_session_hash()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN public.current_single_device_session_id() IS NULL THEN NULL
    ELSE encode(extensions.digest(public.current_single_device_session_id()::text, 'sha256'), 'hex')
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_current_single_device_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.current_single_device_session_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.active_user_sessions active_session
      WHERE active_session.user_id = auth.uid()
        AND active_session.session_id_hash = public.current_single_device_session_hash()
        AND active_session.revoked_at IS NULL
        AND active_session.expires_at > now()
    )
    AND EXISTS (
      SELECT 1
      FROM auth.sessions auth_session
      WHERE auth_session.id = public.current_single_device_session_id()
        AND auth_session.user_id = auth.uid()
        AND (auth_session.not_after IS NULL OR auth_session.not_after > now())
    );
$$;

CREATE OR REPLACE FUNCTION public.require_current_single_device_session()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_current_single_device_session() THEN
    RAISE EXCEPTION 'This session is no longer active. Sign in again.' USING ERRCODE = '28000';
  END IF;
END;
$$;

/*
  Atomically make the current Auth session the only active finance session.
  auth.sessions.created_at decides the winner, so an older stolen/replayed JWT
  cannot reclaim access after a newer device has signed in.
*/
CREATE OR REPLACE FUNCTION public.activate_current_single_device_session()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  caller uuid := auth.uid();
  current_session_id uuid := public.current_single_device_session_id();
  current_hash text := public.current_single_device_session_hash();
  auth_created_at timestamptz;
  auth_expires_at timestamptz;
  auth_user_agent text;
  existing_session public.active_user_sessions%ROWTYPE;
BEGIN
  IF caller IS NULL OR current_session_id IS NULL OR current_hash IS NULL THEN
    RAISE EXCEPTION 'A valid signed-in session is required.' USING ERRCODE = '28000';
  END IF;

  SELECT created_at, LEAST(COALESCE(not_after, created_at + interval '30 days'), created_at + interval '30 days'), user_agent
  INTO auth_created_at, auth_expires_at, auth_user_agent
  FROM auth.sessions
  WHERE id = current_session_id AND user_id = caller;
  IF NOT FOUND OR auth_expires_at <= now() THEN
    RAISE EXCEPTION 'This authentication session has expired. Sign in again.' USING ERRCODE = '28000';
  END IF;

  LOOP
    SELECT * INTO existing_session
    FROM public.active_user_sessions
    WHERE user_id = caller
    FOR UPDATE;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.active_user_sessions (
          user_id, session_id_hash, session_started_at, last_activity_at,
          expires_at, revoked_at, user_agent, created_at, updated_at
        ) VALUES (
          caller, current_hash, auth_created_at, now(), auth_expires_at,
          NULL, NULLIF(left(auth_user_agent, 500), ''), now(), now()
        );
        RETURN;
      EXCEPTION WHEN unique_violation THEN
        /* Another simultaneous login inserted first; lock and compare it. */
      END;
    ELSIF existing_session.session_id_hash = current_hash
      AND existing_session.revoked_at IS NULL
      AND existing_session.expires_at > now() THEN
      UPDATE public.active_user_sessions
      SET last_activity_at = now(), user_agent = COALESCE(NULLIF(left(auth_user_agent, 500), ''), user_agent), updated_at = now()
      WHERE user_id = caller;
      RETURN;
    ELSIF existing_session.session_started_at >= auth_created_at THEN
      RAISE EXCEPTION 'This session was replaced by a newer sign-in.' USING ERRCODE = '28000';
    ELSE
      UPDATE public.active_user_sessions
      SET session_id_hash = current_hash,
          session_started_at = auth_created_at,
          last_activity_at = now(),
          expires_at = auth_expires_at,
          revoked_at = NULL,
          user_agent = NULLIF(left(auth_user_agent, 500), ''),
          updated_at = now()
      WHERE user_id = caller;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_current_single_device_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  current_hash text := public.current_single_device_session_hash();
BEGIN
  IF NOT public.is_current_single_device_session() THEN
    RETURN false;
  END IF;

  /* Activity metadata is useful to the administrator without writing on every request. */
  UPDATE public.active_user_sessions
  SET last_activity_at = now(), updated_at = now()
  WHERE user_id = caller
    AND session_id_hash = current_hash
    AND last_activity_at < now() - interval '1 minute';
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_current_single_device_session()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  current_hash text := public.current_single_device_session_hash();
BEGIN
  IF caller IS NULL OR current_hash IS NULL THEN RETURN; END IF;
  /* A replaced, old device can never revoke the new device's session. */
  UPDATE public.active_user_sessions
  SET revoked_at = now(), last_activity_at = now(), updated_at = now()
  WHERE user_id = caller AND session_id_hash = current_hash AND revoked_at IS NULL;
END;
$$;

/* Existing access helpers now require both an active profile and active device session. */
CREATE OR REPLACE FUNCTION public.is_finance_user_active(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id = auth.uid()
    AND public.is_current_single_device_session()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND deleted_at IS NULL AND is_suspended = false
    );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_current_single_device_session()
    AND EXISTS (SELECT 1 FROM public.platform_administrators WHERE user_id = auth.uid());
$$;

/* A restrictive policy applies the active-session test to every direct data API call. */
DO $$
DECLARE
  protected_table text;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'profiles', 'platform_administrators', 'workspace_members', 'account_shares',
    'workspace_invitations', 'workspace_invitation_accounts', 'workspace_notifications',
    'transaction_types', 'categories', 'category_transaction_types', 'accounts',
    'transactions', 'budgets', 'recurring_entries', 'audit_events', 'investments',
    'investment_types'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS single_device_session_required ON public.%I', protected_table);
    EXECUTE format(
      'CREATE POLICY single_device_session_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_current_single_device_session()) WITH CHECK (public.is_current_single_device_session())',
      protected_table
    );
  END LOOP;
END;
$$;

/* Workspace RPCs that did not previously use is_finance_user_active(). */
CREATE OR REPLACE FUNCTION public.list_accessible_workspaces()
RETURNS TABLE(owner_id uuid, owner_email text, role text, account_count bigint, is_platform_admin boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid(), profile.email, 'owner'::text,
         (SELECT count(*) FROM public.accounts WHERE user_id = auth.uid() AND deleted_at IS NULL),
         public.is_platform_admin()
  FROM public.profiles profile
  WHERE profile.id = auth.uid()
    AND profile.deleted_at IS NULL
    AND profile.is_suspended = false
    AND public.is_current_single_device_session()
  UNION ALL
  SELECT member.owner_id, owner_profile.email, member.role,
         (SELECT count(*) FROM public.account_shares share WHERE share.owner_id = member.owner_id AND share.member_id = member.member_id),
         public.is_platform_admin()
  FROM public.workspace_members member
  JOIN public.profiles owner_profile ON owner_profile.id = member.owner_id
  WHERE member.member_id = auth.uid()
    AND member.revoked_at IS NULL
    AND owner_profile.deleted_at IS NULL
    AND owner_profile.is_suspended = false
    AND public.is_current_single_device_session()
  ORDER BY 3 DESC, 2;
$$;

CREATE OR REPLACE FUNCTION public.cancel_workspace_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE invite public.workspace_invitations%ROWTYPE;
BEGIN
  PERFORM public.require_current_single_device_session();
  SELECT * INTO invite FROM public.workspace_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND OR invite.owner_id <> auth.uid() THEN RAISE EXCEPTION 'That invitation is unavailable.'; END IF;
  IF invite.status <> 'pending' THEN RAISE EXCEPTION 'Only pending invitations can be cancelled.'; END IF;
  UPDATE public.workspace_invitations SET status = 'cancelled' WHERE id = p_invitation_id;
  INSERT INTO public.audit_events (user_id, actor_id, entity_table, entity_id, entity_name, action)
  VALUES (invite.owner_id, auth.uid(), 'workspace_invitation', invite.id, invite.email, 'access_revoked');
END;
$$;

CREATE OR REPLACE FUNCTION public.update_workspace_member_access(
  p_owner_id uuid, p_member_id uuid, p_role text, p_account_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE selected_count integer;
BEGIN
  PERFORM public.require_current_single_device_session();
  IF p_owner_id <> auth.uid() THEN RAISE EXCEPTION 'Only the workspace owner can change access.'; END IF;
  IF p_role NOT IN ('viewer', 'editor') THEN RAISE EXCEPTION 'Choose Viewer or Editor access.'; END IF;
  IF cardinality(p_account_ids) IS NULL OR cardinality(p_account_ids) = 0 THEN RAISE EXCEPTION 'Keep at least one account selected or remove this person.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE owner_id = p_owner_id AND member_id = p_member_id AND revoked_at IS NULL) THEN RAISE EXCEPTION 'That member is unavailable.'; END IF;
  SELECT count(*) INTO selected_count FROM public.accounts WHERE user_id = p_owner_id AND id = ANY(p_account_ids) AND deleted_at IS NULL;
  IF selected_count <> cardinality(ARRAY(SELECT DISTINCT unnest(p_account_ids))) THEN RAISE EXCEPTION 'One or more selected accounts are unavailable.'; END IF;
  UPDATE public.workspace_members SET role = p_role WHERE owner_id = p_owner_id AND member_id = p_member_id;
  DELETE FROM public.account_shares WHERE owner_id = p_owner_id AND member_id = p_member_id;
  INSERT INTO public.account_shares (account_id, owner_id, member_id, role)
  SELECT selected_id, p_owner_id, p_member_id, p_role FROM unnest(ARRAY(SELECT DISTINCT unnest(p_account_ids))) selected_id;
  INSERT INTO public.audit_events (user_id, actor_id, entity_table, entity_id, entity_name, action, details)
  VALUES (p_owner_id, auth.uid(), 'workspace', p_member_id, (SELECT email FROM public.profiles WHERE id = p_member_id), 'updated', jsonb_build_object('Role', p_role, 'Shared accounts', cardinality(p_account_ids)));
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_workspace_member(p_owner_id uuid, p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_current_single_device_session();
  IF p_owner_id <> auth.uid() THEN RAISE EXCEPTION 'Only the workspace owner can remove a member.'; END IF;
  UPDATE public.workspace_members SET revoked_at = now() WHERE owner_id = p_owner_id AND member_id = p_member_id AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That member is unavailable.'; END IF;
  DELETE FROM public.account_shares WHERE owner_id = p_owner_id AND member_id = p_member_id;
  INSERT INTO public.audit_events (user_id, actor_id, entity_table, entity_id, entity_name, action)
  VALUES (p_owner_id, auth.uid(), 'workspace', p_member_id, (SELECT email FROM public.profiles WHERE id = p_member_id), 'access_revoked');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_workspace_notifications_read(p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_current_single_device_session();
  UPDATE public.workspace_notifications SET read_at = now()
  WHERE owner_id = p_owner_id AND owner_id = auth.uid() AND read_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_due_recurring_entries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  rule public.recurring_entries%ROWTYPE;
  due_date date;
  generated integer := 0;
BEGIN
  PERFORM public.require_current_single_device_session();
  FOR rule IN
    SELECT * FROM public.recurring_entries
    WHERE user_id = caller AND is_active AND next_date <= CURRENT_DATE
      AND (end_date IS NULL OR next_date <= end_date)
    ORDER BY next_date
    FOR UPDATE
  LOOP
    due_date := rule.next_date;
    WHILE due_date <= CURRENT_DATE AND (rule.end_date IS NULL OR due_date <= rule.end_date) LOOP
      INSERT INTO public.transactions (
        user_id, name, transaction_type_id, category_id, amount, transaction_date,
        transaction_time, account_id, to_account_id, recurring_entry_id, transaction_source
      ) VALUES (
        caller, rule.name, rule.transaction_type_id, rule.category_id, rule.amount, due_date,
        NULL, rule.account_id, rule.to_account_id, rule.id, 'scheduled'
      ) ON CONFLICT (recurring_entry_id, transaction_date) WHERE recurring_entry_id IS NOT NULL DO NOTHING;
      IF FOUND THEN generated := generated + 1; END IF;
      due_date := public.next_recurring_date(due_date, rule.interval_value, rule.interval_unit, rule.month_day);
    END LOOP;
    UPDATE public.recurring_entries
    SET next_date = due_date,
        is_active = CASE WHEN end_date IS NOT NULL AND due_date > end_date THEN false ELSE is_active END,
        updated_at = now()
    WHERE id = rule.id AND user_id = caller;
  END LOOP;
  RETURN generated;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_auth_activity(p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  email_label text := COALESCE(auth.jwt() ->> 'email', 'Signed-in user');
BEGIN
  IF caller IS NULL OR p_action NOT IN ('signed_in', 'signed_out') THEN RETURN; END IF;
  PERFORM public.require_current_single_device_session();
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'authentication', caller, email_label, p_action,
    jsonb_build_object('Email', email_label, 'Session policy', 'One active device session'));
END;
$$;

/* Investment APIs are security-definer functions, so guard each one explicitly. */
CREATE OR REPLACE FUNCTION public.create_investment_type(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  result_id uuid;
  clean_name text := btrim(p_name);
BEGIN
  PERFORM public.require_current_single_device_session();
  IF clean_name IS NULL OR char_length(clean_name) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Give the investment type a name between 1 and 40 characters.'; END IF;
  INSERT INTO public.investment_types (user_id, name) VALUES (caller, clean_name) RETURNING id INTO result_id;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investment_types', result_id, clean_name, 'created', jsonb_build_object('current', jsonb_build_object('Name', clean_name)));
  RETURN result_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'That investment type already exists.';
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_investment_type(p_investment_type_id uuid, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  previous_name text;
  clean_name text := btrim(p_name);
BEGIN
  PERFORM public.require_current_single_device_session();
  IF clean_name IS NULL OR char_length(clean_name) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Give the investment type a name between 1 and 40 characters.'; END IF;
  SELECT name INTO previous_name FROM public.investment_types WHERE id = p_investment_type_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment type is unavailable.'; END IF;
  UPDATE public.investment_types SET name = clean_name, updated_at = now() WHERE id = p_investment_type_id AND user_id = caller;
  UPDATE public.investments SET investment_type = clean_name, updated_at = now() WHERE user_id = caller AND investment_type_id = p_investment_type_id;
  UPDATE public.transactions SET name = replace(name, ' · ' || previous_name, ' · ' || clean_name)
  WHERE user_id = caller AND investment_id IN (SELECT id FROM public.investments WHERE user_id = caller AND investment_type_id = p_investment_type_id);
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investment_types', p_investment_type_id, clean_name, 'renamed', jsonb_build_object('previous', jsonb_build_object('Name', previous_name), 'current', jsonb_build_object('Name', clean_name)));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'That investment type already exists.';
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_investment_type(p_investment_type_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  previous_name text;
BEGIN
  PERFORM public.require_current_single_device_session();
  SELECT name INTO previous_name FROM public.investment_types WHERE id = p_investment_type_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment type is unavailable.'; END IF;
  IF EXISTS (SELECT 1 FROM public.investments WHERE user_id = caller AND investment_type_id = p_investment_type_id) THEN RAISE EXCEPTION 'This type is used by an investment. Rename it or delete the related investments first.'; END IF;
  DELETE FROM public.investment_types WHERE id = p_investment_type_id AND user_id = caller;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investment_types', p_investment_type_id, previous_name, 'deleted', jsonb_build_object('previous', jsonb_build_object('Name', previous_name)));
END;
$$;

CREATE OR REPLACE FUNCTION public.record_investment(
  p_name text, p_investment_type_id uuid, p_notes text, p_funding_account_id uuid,
  p_principal_amount numeric, p_invested_on date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  expense_type_id uuid;
  category_id uuid;
  account_name text;
  investment_type_name text;
  investment_id uuid;
  opening_id uuid;
BEGIN
  PERFORM public.require_current_single_device_session();
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Give this investment a name.'; END IF;
  IF p_principal_amount IS NULL OR p_principal_amount <= 0 THEN RAISE EXCEPTION 'Enter an investment amount greater than zero.'; END IF;
  SELECT name INTO investment_type_name FROM public.investment_types WHERE id = p_investment_type_id AND user_id = caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an investment type.'; END IF;
  SELECT name INTO account_name FROM public.accounts WHERE id = p_funding_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active account to invest from.'; END IF;
  expense_type_id := public.ensure_investment_type('expense');
  category_id := public.ensure_investment_category(expense_type_id);
  INSERT INTO public.investments (
    user_id, name, investment_type, investment_type_id, notes, funding_account_id, capital_account_id,
    principal_amount, invested_on, accounting_mode
  ) VALUES (
    caller, btrim(p_name), investment_type_name, p_investment_type_id, NULLIF(btrim(p_notes), ''),
    p_funding_account_id, p_funding_account_id, p_principal_amount, p_invested_on, 'return_to_funding'
  ) RETURNING id INTO investment_id;
  INSERT INTO public.transactions (
    user_id, investment_id, name, transaction_type_id, category_id, amount,
    transaction_date, transaction_time, account_id, to_account_id, transaction_source
  ) VALUES (
    caller, investment_id, 'Investment capital: ' || btrim(p_name) || ' · ' || investment_type_name,
    expense_type_id, category_id, p_principal_amount, p_invested_on, NULL, p_funding_account_id, NULL, 'investment'
  ) RETURNING id INTO opening_id;
  UPDATE public.investments SET opening_transaction_id = opening_id WHERE id = investment_id;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment_id, btrim(p_name), 'created', jsonb_build_object('current', jsonb_build_object(
    'Investment type', investment_type_name, 'Capital committed (₹)', p_principal_amount,
    'Invested from account', account_name, 'Invested on', p_invested_on, 'Status', 'Active',
    'Accounting', 'Capital outflow; capital return and profit credited separately', 'Notes', NULLIF(btrim(p_notes), '')
  )));
  RETURN investment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_investment(
  p_investment_id uuid, p_name text, p_investment_type_id uuid, p_notes text,
  p_funding_account_id uuid, p_principal_amount numeric, p_invested_on date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  investment public.investments%ROWTYPE;
  investment_type_name text;
  account_name text;
BEGIN
  PERFORM public.require_current_single_device_session();
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Give this investment a name.'; END IF;
  IF p_principal_amount IS NULL OR p_principal_amount <= 0 THEN RAISE EXCEPTION 'Enter an investment amount greater than zero.'; END IF;
  SELECT * INTO investment FROM public.investments WHERE id = p_investment_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment is unavailable.'; END IF;
  SELECT name INTO investment_type_name FROM public.investment_types WHERE id = p_investment_type_id AND user_id = caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an investment type.'; END IF;
  IF investment.status = 'settled' AND (p_funding_account_id <> investment.funding_account_id OR p_principal_amount <> investment.principal_amount OR p_invested_on <> investment.invested_on) THEN RAISE EXCEPTION 'Only the name, type and notes can be changed after an investment is settled.'; END IF;
  SELECT name INTO account_name FROM public.accounts WHERE id = p_funding_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active account to invest from.'; END IF;
  UPDATE public.investments SET name = btrim(p_name), investment_type = investment_type_name, investment_type_id = p_investment_type_id,
      notes = NULLIF(btrim(p_notes), ''), funding_account_id = p_funding_account_id, capital_account_id = p_funding_account_id,
      principal_amount = p_principal_amount, invested_on = p_invested_on, updated_at = now() WHERE id = investment.id;
  UPDATE public.transactions SET name = 'Investment capital: ' || btrim(p_name) || ' · ' || investment_type_name, amount = p_principal_amount,
      transaction_date = p_invested_on, account_id = p_funding_account_id WHERE id = investment.opening_transaction_id AND user_id = caller;
  UPDATE public.transactions SET name = CASE
    WHEN name LIKE 'Investment capital return:%' THEN 'Investment capital return: ' || btrim(p_name) || ' · ' || investment_type_name
    WHEN name LIKE 'Investment profit:%' THEN 'Investment profit: ' || btrim(p_name) || ' · ' || investment_type_name
    WHEN name LIKE 'Investment loss:%' THEN 'Investment loss: ' || btrim(p_name) || ' · ' || investment_type_name
    WHEN name LIKE 'Investment return:%' THEN 'Investment return: ' || btrim(p_name) || ' · ' || investment_type_name
    ELSE name END
  WHERE investment_id = investment.id AND user_id = caller;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment.id, btrim(p_name), 'updated', jsonb_build_object(
    'previous', jsonb_build_object('Name', investment.name, 'Investment type', investment.investment_type, 'Capital (₹)', investment.principal_amount, 'Invested on', investment.invested_on),
    'current', jsonb_build_object('Name', btrim(p_name), 'Investment type', investment_type_name, 'Capital (₹)', p_principal_amount, 'Invested on', p_invested_on, 'Account', account_name)
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_investment(p_investment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  investment public.investments%ROWTYPE;
  transaction_ids uuid[];
BEGIN
  PERFORM public.require_current_single_device_session();
  SELECT * INTO investment FROM public.investments WHERE id = p_investment_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment is unavailable.'; END IF;
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO transaction_ids FROM public.transactions WHERE investment_id = investment.id AND user_id = caller;
  DELETE FROM public.investments WHERE id = investment.id AND user_id = caller;
  IF cardinality(transaction_ids) > 0 THEN DELETE FROM public.transactions WHERE user_id = caller AND id = ANY(transaction_ids); END IF;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment.id, investment.name, 'deleted', jsonb_build_object('previous', jsonb_build_object('Investment type', investment.investment_type, 'Capital (₹)', investment.principal_amount, 'Status', investment.status)));
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_investment(p_investment_id uuid, p_final_amount numeric, p_settled_on date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  investment public.investments%ROWTYPE;
  income_type_id uuid;
  income_category_id uuid;
  account_name text;
  profit numeric(14, 2);
  capital_return numeric(14, 2);
  settlement_id uuid;
BEGIN
  PERFORM public.require_current_single_device_session();
  IF p_final_amount IS NULL OR p_final_amount < 0 THEN RAISE EXCEPTION 'Enter a final amount of zero or more.'; END IF;
  SELECT * INTO investment FROM public.investments WHERE id = p_investment_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment is unavailable.'; END IF;
  IF investment.status <> 'active' THEN RAISE EXCEPTION 'This investment has already been settled.'; END IF;
  IF p_settled_on < investment.invested_on THEN RAISE EXCEPTION 'Settlement date cannot be before the investment date.'; END IF;
  SELECT name INTO account_name FROM public.accounts WHERE id = investment.funding_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'The account used for this investment is no longer active.'; END IF;
  profit := p_final_amount - investment.principal_amount;
  capital_return := LEAST(p_final_amount, investment.principal_amount);
  income_type_id := public.ensure_investment_type('income');
  income_category_id := public.ensure_investment_category(income_type_id);
  IF capital_return > 0 THEN
    INSERT INTO public.transactions (user_id, investment_id, name, transaction_type_id, category_id, amount, transaction_date, transaction_time, account_id, to_account_id, transaction_source)
    VALUES (caller, investment.id, 'Investment capital return: ' || investment.name || ' · ' || investment.investment_type, income_type_id, income_category_id, capital_return, p_settled_on, NULL, investment.funding_account_id, NULL, 'investment') RETURNING id INTO settlement_id;
  END IF;
  IF profit > 0 THEN
    INSERT INTO public.transactions (user_id, investment_id, name, transaction_type_id, category_id, amount, transaction_date, transaction_time, account_id, to_account_id, transaction_source)
    VALUES (caller, investment.id, 'Investment profit: ' || investment.name || ' · ' || investment.investment_type, income_type_id, income_category_id, profit, p_settled_on, NULL, investment.funding_account_id, NULL, 'investment') RETURNING id INTO settlement_id;
  END IF;
  UPDATE public.investments SET status = 'settled', final_amount = p_final_amount, profit_amount = profit,
      settled_on = p_settled_on, settlement_transaction_id = settlement_id, updated_at = now() WHERE id = investment.id;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment.id, investment.name, 'settled', jsonb_build_object(
    'previous', jsonb_build_object('Capital committed (₹)', investment.principal_amount, 'Status', 'Active'),
    'current', jsonb_build_object('Total amount received (₹)', p_final_amount, 'Capital returned (₹)', capital_return, 'Profit / loss (₹)', profit, 'Settled on', p_settled_on, 'Status', 'Settled', 'Returned to account', account_name, 'Accounting', CASE WHEN profit > 0 THEN 'Capital return and profit recorded as separate transactions' ELSE 'Actual returned capital credited to funding account' END)
  ));
END;
$$;

/* Administrative session status contains session metadata only, never finance data. */
CREATE OR REPLACE FUNCTION public.list_platform_user_sessions()
RETURNS TABLE(
  user_id uuid,
  session_started_at timestamptz,
  last_activity_at timestamptz,
  expires_at timestamptz,
  is_active boolean,
  device_label text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Administrator access is required.'; END IF;
  RETURN QUERY
    SELECT active_session.user_id, active_session.session_started_at, active_session.last_activity_at,
      active_session.expires_at,
      active_session.revoked_at IS NULL AND active_session.expires_at > now(),
      NULLIF(left(active_session.user_agent, 180), '')
    FROM public.active_user_sessions active_session
    ORDER BY active_session.last_activity_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_terminate_user_session(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE target_email text;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Administrator access is required.'; END IF;
  SELECT email INTO target_email FROM public.profiles WHERE id = p_user_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That user is unavailable.'; END IF;
  UPDATE public.active_user_sessions
  SET revoked_at = now(), last_activity_at = now(), updated_at = now()
  WHERE user_id = p_user_id AND revoked_at IS NULL;
  IF FOUND THEN
    INSERT INTO public.audit_events (user_id, actor_id, entity_table, entity_id, entity_name, action, details)
    VALUES (p_user_id, auth.uid(), 'authentication', p_user_id, target_email, 'signed_out',
      jsonb_build_object('Reason', 'Session terminated by administrator'));
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.current_single_device_session_id(), public.current_single_device_session_hash(),
  public.is_current_single_device_session(), public.require_current_single_device_session(),
  public.activate_current_single_device_session(), public.validate_current_single_device_session(),
  public.end_current_single_device_session(), public.list_platform_user_sessions(),
  public.admin_terminate_user_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_current_single_device_session(),
  public.validate_current_single_device_session(), public.end_current_single_device_session() TO authenticated;
/* RLS evaluates this predicate as the authenticated caller. It exposes only a boolean. */
GRANT EXECUTE ON FUNCTION public.is_current_single_device_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_user_sessions(), public.admin_terminate_user_session(uuid) TO authenticated;
