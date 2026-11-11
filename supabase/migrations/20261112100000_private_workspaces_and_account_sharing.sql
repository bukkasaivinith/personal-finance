/*
  Private workspaces, selected-account sharing, and a restricted platform admin.

  Existing finance rows remain owned by their current user_id. A signed-in user
  can only read their own workspace unless its single owner explicitly shares
  selected accounts. RLS is the enforcement boundary; the client never decides
  what another person may read or change.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_suspended boolean NOT NULL DEFAULT false,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.platform_administrators (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('viewer', 'editor')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (owner_id, member_id),
  CHECK (owner_id <> member_id)
);

CREATE TABLE IF NOT EXISTS public.account_shares (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, member_id)
);

CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'editor')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
  expires_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_invitation_accounts (
  invitation_id uuid NOT NULL REFERENCES public.workspace_invitations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (invitation_id, account_id)
);

CREATE TABLE IF NOT EXISTS public.workspace_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.audit_events
  ALTER COLUMN actor_id SET DEFAULT auth.uid();

ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_entity_table_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_entity_table_check
  CHECK (entity_table IN (
    'transaction_types', 'categories', 'accounts', 'transactions', 'budgets',
    'recurring_entries', 'authentication', 'investments', 'investment_types',
    'workspace', 'workspace_invitation'
  ));
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_action_check
  CHECK (action IN (
    'created', 'renamed', 'deactivated', 'activated', 'deleted', 'restored',
    'updated', 'permanently_deleted', 'paused', 'resumed', 'processed',
    'signed_in', 'signed_out', 'settled', 'invited', 'access_granted',
    'access_revoked', 'suspended', 'reactivated'
  ));

CREATE INDEX IF NOT EXISTS workspace_members_member_active_idx
  ON public.workspace_members (member_id, owner_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS account_shares_member_idx
  ON public.account_shares (member_id, account_id);
CREATE INDEX IF NOT EXISTS workspace_invitations_email_pending_idx
  ON public.workspace_invitations (lower(email), status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS workspace_notifications_owner_unread_idx
  ON public.workspace_notifications (owner_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS audit_events_workspace_actor_idx
  ON public.audit_events (user_id, actor_id, created_at DESC);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_administrators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitation_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_administrators WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_finance_user_active(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id AND deleted_at IS NULL AND is_suspended = false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_access(p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_finance_user_active(auth.uid())
    AND (
      p_owner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE owner_id = p_owner_id AND member_id = auth.uid() AND revoked_at IS NULL
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_editor(p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_finance_user_active(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE owner_id = p_owner_id AND member_id = auth.uid()
        AND role = 'editor' AND revoked_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_account(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_finance_user_active(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.accounts account
      WHERE account.id = p_account_id
        AND (
          account.user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.account_shares share
            JOIN public.workspace_members member
              ON member.owner_id = share.owner_id
             AND member.member_id = share.member_id
             AND member.revoked_at IS NULL
            WHERE share.account_id = account.id AND share.member_id = auth.uid()
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_account(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_finance_user_active(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.accounts account
      WHERE account.id = p_account_id
        AND (
          account.user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.account_shares share
            JOIN public.workspace_members member
              ON member.owner_id = share.owner_id
             AND member.member_id = share.member_id
             AND member.revoked_at IS NULL
            WHERE share.account_id = account.id AND share.member_id = auth.uid()
              AND share.role = 'editor' AND member.role = 'editor'
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.notify_workspace_owner(p_owner_id uuid, p_actor_id uuid, p_message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_actor_id IS NULL OR p_actor_id = p_owner_id THEN RETURN; END IF;
  INSERT INTO public.workspace_notifications (owner_id, actor_id, message)
  VALUES (p_owner_id, p_actor_id, left(p_message, 300));
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_from_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, lower(NEW.email))
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  IF lower(NEW.email) = 'bukkasaivinith2@gmail.com' THEN
    INSERT INTO public.platform_administrators (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_finance_auth_user_created ON auth.users;
CREATE TRIGGER on_finance_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_from_auth_user();

INSERT INTO public.profiles (id, email)
SELECT id, lower(email) FROM auth.users
WHERE email IS NOT NULL
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.platform_administrators (user_id)
SELECT id FROM auth.users WHERE lower(email) = 'bukkasaivinith2@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
CREATE POLICY profiles_select_self_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS workspace_members_select_participants ON public.workspace_members;
CREATE POLICY workspace_members_select_participants ON public.workspace_members
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR member_id = auth.uid());

DROP POLICY IF EXISTS account_shares_select_participants ON public.account_shares;
CREATE POLICY account_shares_select_participants ON public.account_shares
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR member_id = auth.uid());

DROP POLICY IF EXISTS workspace_invitations_select_owner ON public.workspace_invitations;
CREATE POLICY workspace_invitations_select_owner ON public.workspace_invitations
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS workspace_invitation_accounts_select_owner ON public.workspace_invitation_accounts;
CREATE POLICY workspace_invitation_accounts_select_owner ON public.workspace_invitation_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_invitations invite WHERE invite.id = invitation_id AND invite.owner_id = auth.uid()));

DROP POLICY IF EXISTS workspace_notifications_select_owner ON public.workspace_notifications;
CREATE POLICY workspace_notifications_select_owner ON public.workspace_notifications
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

/* Account owners retain full control. Shared people can only see the selected accounts. */
DROP POLICY IF EXISTS workspace_select_accounts ON public.accounts;
DROP POLICY IF EXISTS workspace_write_accounts ON public.accounts;
CREATE POLICY workspace_select_accounts ON public.accounts
  FOR SELECT TO authenticated USING (public.can_view_account(id));
CREATE POLICY workspace_write_accounts ON public.accounts
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()));

/* Types and categories intentionally belong to the whole workspace, but only its owner manages them. */
DROP POLICY IF EXISTS workspace_select_types ON public.transaction_types;
DROP POLICY IF EXISTS workspace_write_types ON public.transaction_types;
CREATE POLICY workspace_select_types ON public.transaction_types
  FOR SELECT TO authenticated USING (public.has_workspace_access(user_id));
CREATE POLICY workspace_write_types ON public.transaction_types
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()));

DROP POLICY IF EXISTS workspace_select_categories ON public.categories;
DROP POLICY IF EXISTS workspace_write_categories ON public.categories;
CREATE POLICY workspace_select_categories ON public.categories
  FOR SELECT TO authenticated USING (public.has_workspace_access(user_id));
CREATE POLICY workspace_write_categories ON public.categories
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()));

DROP POLICY IF EXISTS workspace_select_links ON public.category_transaction_types;
DROP POLICY IF EXISTS workspace_write_links ON public.category_transaction_types;
CREATE POLICY workspace_select_links ON public.category_transaction_types
  FOR SELECT TO authenticated USING (public.has_workspace_access(user_id));
CREATE POLICY workspace_write_links ON public.category_transaction_types
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()));

/* Transaction rows are never directly readable by members: the RPC below redacts private transfer counterparts. */
DROP POLICY IF EXISTS workspace_select_transactions ON public.transactions;
DROP POLICY IF EXISTS workspace_write_transactions ON public.transactions;
DROP POLICY IF EXISTS workspace_update_transactions ON public.transactions;
CREATE POLICY workspace_select_transactions ON public.transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()));
CREATE POLICY workspace_insert_transactions ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_finance_user_active(auth.uid()) AND (
      user_id = auth.uid()
      OR (
        public.is_workspace_editor(user_id)
        AND public.can_edit_account(account_id)
        AND (to_account_id IS NULL OR public.can_edit_account(to_account_id))
      )
    )
  );
CREATE POLICY workspace_update_transactions ON public.transactions
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR (public.is_workspace_editor(user_id) AND (public.can_edit_account(account_id) OR (to_account_id IS NOT NULL AND public.can_edit_account(to_account_id))))
  )
  WITH CHECK (
    public.is_finance_user_active(auth.uid()) AND (
      user_id = auth.uid()
      OR (
        public.is_workspace_editor(user_id)
        AND public.can_edit_account(account_id)
        AND (to_account_id IS NULL OR public.can_edit_account(to_account_id))
      )
    )
  );

DROP POLICY IF EXISTS workspace_select_budgets ON public.budgets;
DROP POLICY IF EXISTS workspace_write_budgets ON public.budgets;
CREATE POLICY workspace_select_budgets ON public.budgets
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()));
CREATE POLICY workspace_write_budgets ON public.budgets
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()));

DROP POLICY IF EXISTS workspace_select_recurring ON public.recurring_entries;
DROP POLICY IF EXISTS workspace_write_recurring ON public.recurring_entries;
CREATE POLICY workspace_select_recurring ON public.recurring_entries
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()));
CREATE POLICY workspace_write_recurring ON public.recurring_entries
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()));

DROP POLICY IF EXISTS workspace_select_audit ON public.audit_events;
CREATE POLICY workspace_select_audit ON public.audit_events
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.is_finance_user_active(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(), public.is_finance_user_active(uuid), public.has_workspace_access(uuid), public.is_workspace_editor(uuid), public.can_view_account(uuid), public.can_edit_account(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.open_finance_workspace()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_email text;
  confirmed_at timestamptz;
  invite public.workspace_invitations%ROWTYPE;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before opening a workspace.'; END IF;
  SELECT lower(email), email_confirmed_at INTO caller_email, confirmed_at FROM auth.users WHERE id = caller;
  IF caller_email IS NULL THEN RAISE EXCEPTION 'Your account is unavailable.'; END IF;
  IF confirmed_at IS NULL THEN RAISE EXCEPTION 'Confirm your email before opening your workspace.'; END IF;
  IF NOT public.is_finance_user_active(caller) THEN RAISE EXCEPTION 'This account is unavailable. Contact the administrator if you need help.'; END IF;

  PERFORM public.claim_unowned_finance_data();
  UPDATE public.workspace_invitations
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now();

  FOR invite IN
    SELECT * FROM public.workspace_invitations
    WHERE status = 'pending'
      AND lower(email) = caller_email
      AND (expires_at IS NULL OR expires_at >= now())
    FOR UPDATE
  LOOP
    INSERT INTO public.workspace_members (owner_id, member_id, role, joined_at, revoked_at)
    VALUES (invite.owner_id, caller, invite.role, now(), NULL)
    ON CONFLICT (owner_id, member_id) DO UPDATE
      SET role = EXCLUDED.role, joined_at = EXCLUDED.joined_at, revoked_at = NULL;

    INSERT INTO public.account_shares (account_id, owner_id, member_id, role)
    SELECT scope.account_id, invite.owner_id, caller, invite.role
    FROM public.workspace_invitation_accounts scope
    JOIN public.accounts account ON account.id = scope.account_id AND account.user_id = invite.owner_id
    WHERE scope.invitation_id = invite.id
    ON CONFLICT (account_id, member_id) DO UPDATE SET role = EXCLUDED.role, owner_id = EXCLUDED.owner_id;

    UPDATE public.workspace_invitations
    SET status = 'accepted', accepted_by = caller, accepted_at = now()
    WHERE id = invite.id;

    INSERT INTO public.audit_events (user_id, actor_id, entity_table, entity_id, entity_name, action, details)
    VALUES (invite.owner_id, caller, 'workspace_invitation', invite.id, caller_email, 'access_granted',
      jsonb_build_object('Role', invite.role, 'Event', 'Invitation accepted'));
  END LOOP;
END;
$$;

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
  WHERE profile.id = auth.uid() AND profile.deleted_at IS NULL AND profile.is_suspended = false
  UNION ALL
  SELECT member.owner_id, owner_profile.email, member.role,
         (SELECT count(*) FROM public.account_shares share WHERE share.owner_id = member.owner_id AND share.member_id = member.member_id),
         public.is_platform_admin()
  FROM public.workspace_members member
  JOIN public.profiles owner_profile ON owner_profile.id = member.owner_id
  WHERE member.member_id = auth.uid() AND member.revoked_at IS NULL
    AND owner_profile.deleted_at IS NULL AND owner_profile.is_suspended = false
  ORDER BY role DESC, owner_email;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_transactions(p_owner_id uuid)
RETURNS TABLE(
  id uuid, name text, transaction_type_id uuid, transaction_type_name text,
  transaction_kind text, category_id uuid, category_name text, amount numeric,
  transaction_date date, transaction_time time, account_id uuid, account_name text,
  to_account_id uuid, to_account_name text, recurring_entry_id uuid, investment_id uuid,
  transaction_source text, visible_transfer_direction text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_workspace_access(p_owner_id) THEN RAISE EXCEPTION 'This workspace is unavailable.'; END IF;
  IF p_owner_id = auth.uid() THEN
    RETURN QUERY
      SELECT transaction.id, transaction.name, transaction.transaction_type_id, transaction.transaction_type_name,
        transaction.transaction_kind, transaction.category_id, transaction.category_name, transaction.amount,
        transaction.transaction_date, transaction.transaction_time, transaction.account_id, transaction.account_name,
        transaction.to_account_id, transaction.to_account_name, transaction.recurring_entry_id, transaction.investment_id,
        transaction.transaction_source, NULL::text
      FROM public.transactions transaction
      WHERE transaction.user_id = p_owner_id
      ORDER BY transaction.transaction_date DESC, transaction.transaction_time DESC NULLS LAST, transaction.created_at DESC;
  ELSE
    RETURN QUERY
      SELECT transaction.id, transaction.name, transaction.transaction_type_id, transaction.transaction_type_name,
        transaction.transaction_kind, transaction.category_id, transaction.category_name, transaction.amount,
        transaction.transaction_date, transaction.transaction_time,
        CASE WHEN public.can_view_account(transaction.account_id) THEN transaction.account_id ELSE transaction.to_account_id END,
        CASE WHEN public.can_view_account(transaction.account_id) THEN transaction.account_name ELSE transaction.to_account_name END,
        NULL::uuid, NULL::text, transaction.recurring_entry_id, transaction.investment_id, transaction.transaction_source,
        CASE
          WHEN transaction.transaction_kind <> 'transfer' THEN NULL
          WHEN public.can_view_account(transaction.account_id) THEN 'out'
          ELSE 'in'
        END
      FROM public.transactions transaction
      WHERE transaction.user_id = p_owner_id
        AND (public.can_view_account(transaction.account_id) OR (transaction.to_account_id IS NOT NULL AND public.can_view_account(transaction.to_account_id)))
      ORDER BY transaction.transaction_date DESC, transaction.transaction_time DESC NULLS LAST, transaction.created_at DESC;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_activity(
  p_owner_id uuid, p_action text DEFAULT NULL, p_entity text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_workspace_access(p_owner_id) THEN RAISE EXCEPTION 'This workspace is unavailable.'; END IF;
  WITH filtered AS (
    SELECT * FROM public.audit_events event
    WHERE event.user_id = p_owner_id
      AND (p_action IS NULL OR event.action = p_action)
      AND (p_entity IS NULL OR event.entity_table = p_entity)
      AND (p_from IS NULL OR event.created_at >= p_from)
      AND (p_to IS NULL OR event.created_at <= p_to)
      AND (
        p_owner_id = auth.uid()
        OR (
          event.entity_table = 'transactions'
          AND EXISTS (
            SELECT 1 FROM public.accounts account
            WHERE account.user_id = p_owner_id
              AND public.can_view_account(account.id)
              AND (
                event.details -> 'current' ->> 'Account' = account.name
                OR event.details -> 'previous' ->> 'Account' = account.name
              )
          )
        )
      )
  ), paged AS (
    SELECT * FROM filtered
    ORDER BY created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM filtered),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', event.id, 'entity_table', event.entity_table, 'entity_id', event.entity_id,
      'entity_name', event.entity_name, 'action', event.action, 'created_at', event.created_at,
      'details', event.details, 'actor_email', COALESCE(actor.email, 'System')
    ) ORDER BY event.created_at DESC)
    FROM paged event LEFT JOIN public.profiles actor ON actor.id = event.actor_id), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_sharing(p_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  members jsonb;
  invitations jsonb;
  notifications jsonb;
BEGIN
  IF p_owner_id <> auth.uid() OR NOT public.is_finance_user_active(auth.uid()) THEN RAISE EXCEPTION 'Only the workspace owner can manage sharing.'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', member.member_id, 'email', profile.email, 'role', member.role,
    'account_ids', COALESCE((SELECT jsonb_agg(share.account_id) FROM public.account_shares share WHERE share.owner_id = p_owner_id AND share.member_id = member.member_id), '[]'::jsonb),
    'joined_at', member.joined_at
  ) ORDER BY profile.email), '[]'::jsonb) INTO members
  FROM public.workspace_members member
  JOIN public.profiles profile ON profile.id = member.member_id
  WHERE member.owner_id = p_owner_id AND member.revoked_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', invite.id, 'email', invite.email, 'role', invite.role,
    'account_ids', COALESCE((SELECT jsonb_agg(scope.account_id) FROM public.workspace_invitation_accounts scope WHERE scope.invitation_id = invite.id), '[]'::jsonb),
    'expires_at', invite.expires_at, 'created_at', invite.created_at
  ) ORDER BY invite.created_at DESC), '[]'::jsonb) INTO invitations
  FROM public.workspace_invitations invite
  WHERE invite.owner_id = p_owner_id AND invite.status = 'pending';

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', note.id, 'message', note.message, 'created_at', note.created_at, 'read_at', note.read_at) ORDER BY note.created_at DESC), '[]'::jsonb)
  INTO notifications
  FROM (SELECT * FROM public.workspace_notifications WHERE owner_id = p_owner_id AND read_at IS NULL ORDER BY created_at DESC LIMIT 8) note;

  RETURN jsonb_build_object('members', members, 'invitations', invitations, 'notifications', notifications);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_workspace_invitation(
  p_owner_id uuid, p_email text, p_role text, p_account_ids uuid[], p_expires_in text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite_id uuid;
  clean_email text := lower(btrim(p_email));
  expiry timestamptz;
  selected_count integer;
BEGIN
  IF p_owner_id <> auth.uid() OR NOT public.is_finance_user_active(auth.uid()) THEN RAISE EXCEPTION 'Only the workspace owner can invite people.'; END IF;
  IF clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Enter a valid email address.'; END IF;
  IF clean_email = (SELECT email FROM public.profiles WHERE id = auth.uid()) THEN RAISE EXCEPTION 'You already own this workspace.'; END IF;
  IF p_role NOT IN ('viewer', 'editor') THEN RAISE EXCEPTION 'Choose Viewer or Editor access.'; END IF;
  IF cardinality(p_account_ids) IS NULL OR cardinality(p_account_ids) = 0 THEN RAISE EXCEPTION 'Choose at least one account to share.'; END IF;
  SELECT count(*) INTO selected_count FROM public.accounts
  WHERE user_id = p_owner_id AND id = ANY(p_account_ids) AND deleted_at IS NULL;
  IF selected_count <> cardinality(ARRAY(SELECT DISTINCT unnest(p_account_ids))) THEN RAISE EXCEPTION 'One or more selected accounts are unavailable.'; END IF;
  expiry := CASE p_expires_in
    WHEN '24h' THEN now() + interval '24 hours'
    WHEN '7d' THEN now() + interval '7 days'
    WHEN '30d' THEN now() + interval '30 days'
    WHEN 'never' THEN NULL
    ELSE NULL
  END;
  IF p_expires_in NOT IN ('24h', '7d', '30d', 'never') THEN RAISE EXCEPTION 'Choose a valid invitation expiry.'; END IF;

  UPDATE public.workspace_invitations SET status = 'cancelled'
  WHERE owner_id = p_owner_id AND lower(email) = clean_email AND status = 'pending';
  INSERT INTO public.workspace_invitations (owner_id, email, role, expires_at)
  VALUES (p_owner_id, clean_email, p_role, expiry) RETURNING id INTO invite_id;
  INSERT INTO public.workspace_invitation_accounts (invitation_id, account_id)
  SELECT invite_id, selected_id FROM unnest(ARRAY(SELECT DISTINCT unnest(p_account_ids))) selected_id;
  INSERT INTO public.audit_events (user_id, actor_id, entity_table, entity_id, entity_name, action, details)
  VALUES (p_owner_id, auth.uid(), 'workspace_invitation', invite_id, clean_email, 'invited',
    jsonb_build_object('Role', p_role, 'Expiry', COALESCE(expiry::text, 'Until cancelled')));
  RETURN invite_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_workspace_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE invite public.workspace_invitations%ROWTYPE;
BEGIN
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.workspace_notifications SET read_at = now()
  WHERE owner_id = p_owner_id AND owner_id = auth.uid() AND read_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.delete_transaction(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  transaction_row public.transactions%ROWTYPE;
BEGIN
  IF caller IS NULL OR NOT public.is_finance_user_active(caller) THEN RAISE EXCEPTION 'Sign in before deleting a transaction.'; END IF;
  SELECT * INTO transaction_row FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR (transaction_row.user_id <> caller AND NOT (
    public.is_workspace_editor(transaction_row.user_id)
    AND public.can_edit_account(transaction_row.account_id)
    AND (transaction_row.to_account_id IS NULL OR public.can_edit_account(transaction_row.to_account_id))
  )) THEN
    RAISE EXCEPTION 'That transaction is unavailable.';
  END IF;
  IF transaction_row.investment_id IS NOT NULL THEN RAISE EXCEPTION 'This entry is managed by an investment. Edit or delete the investment instead.'; END IF;
  DELETE FROM public.transactions WHERE id = transaction_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_transaction_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_events (user_id, actor_id, entity_table, entity_id, entity_name, action, details)
    VALUES (NEW.user_id, actor, 'transactions', NEW.id, NEW.name || ' — ' || NEW.amount::text, 'created', jsonb_build_object('current', public.audit_transaction_snapshot(to_jsonb(NEW))));
    PERFORM public.notify_workspace_owner(NEW.user_id, actor, 'A shared editor added “' || NEW.name || '”.');
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
    IF NEW.name IS NOT DISTINCT FROM OLD.name AND NEW.transaction_type_id IS NOT DISTINCT FROM OLD.transaction_type_id AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id AND NEW.amount IS NOT DISTINCT FROM OLD.amount AND NEW.transaction_date IS NOT DISTINCT FROM OLD.transaction_date AND NEW.transaction_time IS NOT DISTINCT FROM OLD.transaction_time AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id AND NEW.to_account_id IS NOT DISTINCT FROM OLD.to_account_id AND NEW.recurring_entry_id IS NOT DISTINCT FROM OLD.recurring_entry_id AND NEW.transaction_source IS NOT DISTINCT FROM OLD.transaction_source THEN RETURN NEW; END IF;
    INSERT INTO public.audit_events (user_id, actor_id, entity_table, entity_id, entity_name, action, details)
    VALUES (NEW.user_id, actor, 'transactions', NEW.id, NEW.name || ' — ' || NEW.amount::text, 'updated', jsonb_build_object('previous', public.audit_transaction_snapshot(to_jsonb(OLD)), 'current', public.audit_transaction_snapshot(to_jsonb(NEW))));
    PERFORM public.notify_workspace_owner(NEW.user_id, actor, 'A shared editor updated “' || NEW.name || '”.');
    RETURN NEW;
  END IF;
  INSERT INTO public.audit_events (user_id, actor_id, entity_table, entity_id, entity_name, action, details)
  VALUES (OLD.user_id, actor, 'transactions', OLD.id, OLD.name || ' — ' || OLD.amount::text, 'deleted', jsonb_build_object('previous', public.audit_transaction_snapshot(to_jsonb(OLD))));
  PERFORM public.notify_workspace_owner(OLD.user_id, actor, 'A shared editor deleted “' || OLD.name || '”.');
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_users()
RETURNS TABLE(id uuid, email text, created_at timestamptz, is_suspended boolean, deleted_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Administrator access is required.'; END IF;
  RETURN QUERY SELECT profile.id, profile.email, profile.created_at, profile.is_suspended, profile.deleted_at FROM public.profiles profile ORDER BY profile.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_platform_user_suspension(p_user_id uuid, p_suspended boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Administrator access is required.'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'An administrator cannot suspend their own account.'; END IF;
  UPDATE public.profiles SET is_suspended = p_suspended WHERE id = p_user_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That user is unavailable.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_finance_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.account_shares WHERE owner_id = p_user_id OR member_id = p_user_id;
  DELETE FROM public.workspace_invitation_accounts scope USING public.workspace_invitations invite
  WHERE scope.invitation_id = invite.id AND (invite.owner_id = p_user_id OR invite.accepted_by = p_user_id);
  DELETE FROM public.workspace_invitations WHERE owner_id = p_user_id OR accepted_by = p_user_id;
  DELETE FROM public.workspace_members WHERE owner_id = p_user_id OR member_id = p_user_id;
  DELETE FROM public.workspace_notifications WHERE owner_id = p_user_id OR actor_id = p_user_id;
  UPDATE public.investments SET opening_transaction_id = NULL, settlement_transaction_id = NULL WHERE user_id = p_user_id;
  DELETE FROM public.transactions WHERE user_id = p_user_id;
  DELETE FROM public.investments WHERE user_id = p_user_id;
  DELETE FROM public.investment_types WHERE user_id = p_user_id;
  DELETE FROM public.recurring_entries WHERE user_id = p_user_id;
  DELETE FROM public.budgets WHERE user_id = p_user_id;
  DELETE FROM public.category_transaction_types WHERE user_id = p_user_id;
  UPDATE public.categories SET parent_id = NULL WHERE user_id = p_user_id;
  DELETE FROM public.categories WHERE user_id = p_user_id;
  DELETE FROM public.accounts WHERE user_id = p_user_id;
  DELETE FROM public.transaction_types WHERE user_id = p_user_id;
  DELETE FROM public.audit_events WHERE user_id = p_user_id OR actor_id = p_user_id;
  DELETE FROM public.profiles WHERE id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_finance_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_finance_user_active(auth.uid()) THEN RAISE EXCEPTION 'This account is unavailable.'; END IF;
  PERFORM public.purge_finance_user(auth.uid());
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_platform_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Administrator access is required.'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Use your own account deletion control.'; END IF;
  PERFORM public.purge_finance_user(p_user_id);
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON public.profiles, public.platform_administrators, public.workspace_members,
  public.account_shares, public.workspace_invitations, public.workspace_invitation_accounts,
  public.workspace_notifications FROM anon, authenticated;
GRANT SELECT ON public.profiles, public.workspace_members, public.account_shares,
  public.workspace_invitations, public.workspace_invitation_accounts, public.workspace_notifications TO authenticated;

REVOKE EXECUTE ON FUNCTION public.open_finance_workspace(), public.list_accessible_workspaces(), public.get_workspace_transactions(uuid), public.get_workspace_activity(uuid, text, text, timestamptz, timestamptz, integer, integer), public.get_workspace_sharing(uuid), public.create_workspace_invitation(uuid, text, text, uuid[], text), public.cancel_workspace_invitation(uuid), public.update_workspace_member_access(uuid, uuid, text, uuid[]), public.revoke_workspace_member(uuid, uuid), public.mark_workspace_notifications_read(uuid), public.list_platform_users(), public.set_platform_user_suspension(uuid, boolean), public.delete_my_finance_account(), public.delete_platform_user(uuid), public.purge_finance_user(uuid), public.notify_workspace_owner(uuid, uuid, text), public.sync_profile_from_auth_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_finance_workspace(), public.list_accessible_workspaces(), public.get_workspace_transactions(uuid), public.get_workspace_activity(uuid, text, text, timestamptz, timestamptz, integer, integer), public.get_workspace_sharing(uuid), public.create_workspace_invitation(uuid, text, text, uuid[], text), public.cancel_workspace_invitation(uuid), public.update_workspace_member_access(uuid, uuid, text, uuid[]), public.revoke_workspace_member(uuid, uuid), public.mark_workspace_notifications_read(uuid), public.list_platform_users(), public.set_platform_user_suspension(uuid, boolean), public.delete_my_finance_account(), public.delete_platform_user(uuid), public.delete_transaction(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_finance_user(uuid), public.notify_workspace_owner(uuid, uuid, text), public.sync_profile_from_auth_user() FROM authenticated;
