BEGIN;

CREATE FUNCTION public.can_open_finance_workspace()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS account
    JOIN public.profiles AS profile ON profile.id = account.id
    WHERE account.id = auth.uid()
      AND NULLIF(btrim(account.email), '') IS NOT NULL
      AND account.email_confirmed_at IS NOT NULL
      AND profile.deleted_at IS NULL
      AND NOT profile.is_suspended
  );
$$;
REVOKE ALL ON FUNCTION public.can_open_finance_workspace() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_open_finance_workspace() TO authenticated;

-- The session and IPO functions use this name to check access to the caller's workspace.
CREATE OR REPLACE FUNCTION public.is_finance_workspace_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT public.can_open_finance_workspace();
$$;

CREATE OR REPLACE FUNCTION public.activate_current_single_device_session()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT public.can_open_finance_workspace() THEN
    RAISE EXCEPTION 'An active account with a verified email is required.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.activate_finance_session_internal();
END;
$$;

CREATE OR REPLACE FUNCTION public.open_finance_workspace()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  PERFORM public.require_current_single_device_session();
  -- Unassigned records from the original workspace belong to its pinned account.
  IF EXISTS (SELECT 1 FROM public.finance_workspace_owner AS legacy WHERE legacy.user_id = caller) THEN
    PERFORM public.claim_unowned_finance_data();
  END IF;
  PERFORM public.initialize_finance_standard_types(caller);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_transaction(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := auth.uid();
  linked_investment uuid;
BEGIN
  PERFORM public.require_current_single_device_session();
  SELECT investment_id INTO linked_investment
  FROM public.transactions
  WHERE id = p_transaction_id AND user_id = caller
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That transaction is unavailable.'; END IF;
  IF linked_investment IS NOT NULL THEN
    RAISE EXCEPTION 'This entry is managed by an investment. Edit or delete the investment instead.';
  END IF;
  DELETE FROM public.transactions WHERE id = p_transaction_id AND user_id = caller;
END;
$$;

CREATE FUNCTION public.validate_transaction_workspace_links()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.recurring_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.recurring_entries
    WHERE id = NEW.recurring_entry_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'That recurring entry is unavailable.';
  END IF;
  IF NEW.investment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.investments
    WHERE id = NEW.investment_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'That investment is unavailable.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_transaction_workspace_links() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_transaction_workspace_links
  BEFORE INSERT OR UPDATE OF recurring_entry_id, investment_id ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_transaction_workspace_links();

COMMIT;
