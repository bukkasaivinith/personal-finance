/*
  Store detailed, immutable before/after information with audit events.
  Existing events are preserved with an empty details object; only future
  actions can include fields that were not collected in the past.
*/

ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.audit_item_snapshot(p_table text, p_row jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'Name', p_row ->> 'name',
    'Counts as', CASE WHEN p_table = 'transaction_types' THEN p_row ->> 'kind' END,
    'Emoji', CASE WHEN p_table = 'categories' THEN p_row ->> 'emoji' END,
    'Description', CASE WHEN p_table = 'accounts' THEN p_row ->> 'description' END,
    'Opening balance (₹)', CASE WHEN p_table = 'accounts' THEN p_row ->> 'opening_balance' END,
    'Opening-balance date', CASE WHEN p_table = 'accounts' THEN p_row ->> 'opening_balance_date' END,
    'Liability account', CASE WHEN p_table = 'accounts' THEN CASE WHEN (p_row ->> 'is_liability')::boolean THEN 'Yes' ELSE 'No' END END,
    'Status', CASE
      WHEN p_row ->> 'deleted_at' IS NOT NULL THEN 'Deleted'
      WHEN p_row ->> 'is_active' = 'false' THEN 'Inactive'
      ELSE 'Active'
    END
  ));
$$;

CREATE OR REPLACE FUNCTION public.audit_transaction_snapshot(p_row jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'Name', p_row ->> 'name',
    'Amount (₹)', p_row ->> 'amount',
    'Transaction type', p_row ->> 'transaction_type_name',
    'Counts as', p_row ->> 'transaction_kind',
    'Category', p_row ->> 'category_name',
    'Account', p_row ->> 'account_name',
    'To account', p_row ->> 'to_account_name',
    'Date', p_row ->> 'transaction_date',
    'Time', p_row ->> 'transaction_time',
    'Source', CASE WHEN p_row ->> 'transaction_source' = 'scheduled' THEN 'Scheduled recurring entry' ELSE 'Manual entry' END
  ));
$$;

CREATE OR REPLACE FUNCTION public.audit_budget_snapshot(p_row jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'Category', (SELECT name FROM public.categories WHERE id = NULLIF(p_row ->> 'category_id', '')::uuid),
    'Monthly limit (₹)', p_row ->> 'amount'
  ));
$$;

CREATE OR REPLACE FUNCTION public.audit_recurring_snapshot(p_row jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'Name', p_row ->> 'name',
    'Amount (₹)', p_row ->> 'amount',
    'Transaction type', (SELECT name FROM public.transaction_types WHERE id = NULLIF(p_row ->> 'transaction_type_id', '')::uuid),
    'Category', (SELECT name FROM public.categories WHERE id = NULLIF(p_row ->> 'category_id', '')::uuid),
    'Account', (SELECT name FROM public.accounts WHERE id = NULLIF(p_row ->> 'account_id', '')::uuid),
    'To account', (SELECT name FROM public.accounts WHERE id = NULLIF(p_row ->> 'to_account_id', '')::uuid),
    'Repeats every', concat(p_row ->> 'interval_value', ' ', p_row ->> 'interval_unit', CASE WHEN p_row ->> 'interval_value' = '1' THEN '' ELSE 's' END),
    'Next due date', p_row ->> 'next_date',
    'End date', p_row ->> 'end_date',
    'Status', CASE WHEN p_row ->> 'is_active' = 'true' THEN 'Active' ELSE 'Paused' END
  ));
$$;

CREATE OR REPLACE FUNCTION public.record_item_audit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  change_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
    VALUES (NEW.user_id, TG_TABLE_NAME, NEW.id, NEW.name, 'created', jsonb_build_object('current', public.audit_item_snapshot(TG_TABLE_NAME, to_jsonb(NEW))));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
    VALUES (OLD.user_id, TG_TABLE_NAME, OLD.id, OLD.name, 'permanently_deleted', jsonb_build_object('previous', public.audit_item_snapshot(TG_TABLE_NAME, to_jsonb(OLD))));
    RETURN OLD;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    change_action := 'deleted';
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    change_action := 'restored';
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    change_action := CASE WHEN NEW.is_active THEN 'activated' ELSE 'deactivated' END;
  ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
    change_action := 'renamed';
  ELSE
    change_action := 'updated';
  END IF;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (NEW.user_id, TG_TABLE_NAME, NEW.id, NEW.name, change_action,
    jsonb_build_object('previous', public.audit_item_snapshot(TG_TABLE_NAME, to_jsonb(OLD)), 'current', public.audit_item_snapshot(TG_TABLE_NAME, to_jsonb(NEW))));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_transaction_audit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
    VALUES (NEW.user_id, 'transactions', NEW.id, NEW.name || ' — ' || NEW.amount::text, 'created', jsonb_build_object('current', public.audit_transaction_snapshot(to_jsonb(NEW))));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
    IF NEW.name IS NOT DISTINCT FROM OLD.name
       AND NEW.transaction_type_id IS NOT DISTINCT FROM OLD.transaction_type_id
       AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
       AND NEW.amount IS NOT DISTINCT FROM OLD.amount
       AND NEW.transaction_date IS NOT DISTINCT FROM OLD.transaction_date
       AND NEW.transaction_time IS NOT DISTINCT FROM OLD.transaction_time
       AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
       AND NEW.to_account_id IS NOT DISTINCT FROM OLD.to_account_id
       AND NEW.recurring_entry_id IS NOT DISTINCT FROM OLD.recurring_entry_id
       AND NEW.transaction_source IS NOT DISTINCT FROM OLD.transaction_source THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
    VALUES (NEW.user_id, 'transactions', NEW.id, NEW.name || ' — ' || NEW.amount::text, 'updated',
      jsonb_build_object('previous', public.audit_transaction_snapshot(to_jsonb(OLD)), 'current', public.audit_transaction_snapshot(to_jsonb(NEW))));
    RETURN NEW;
  END IF;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (OLD.user_id, 'transactions', OLD.id, OLD.name || ' — ' || OLD.amount::text, 'deleted', jsonb_build_object('previous', public.audit_transaction_snapshot(to_jsonb(OLD))));
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_simple_audit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  change_action text;
  owner_id uuid;
  changed_id uuid;
  label text;
  current_details jsonb;
  previous_details jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    owner_id := OLD.user_id;
    changed_id := OLD.id;
    previous_details := CASE WHEN TG_TABLE_NAME = 'budgets' THEN public.audit_budget_snapshot(to_jsonb(OLD)) ELSE public.audit_recurring_snapshot(to_jsonb(OLD)) END;
    label := COALESCE(previous_details ->> 'Name', previous_details ->> 'Category', TG_TABLE_NAME);
  ELSE
    owner_id := NEW.user_id;
    changed_id := NEW.id;
    current_details := CASE WHEN TG_TABLE_NAME = 'budgets' THEN public.audit_budget_snapshot(to_jsonb(NEW)) ELSE public.audit_recurring_snapshot(to_jsonb(NEW)) END;
    label := COALESCE(current_details ->> 'Name', current_details ->> 'Category', TG_TABLE_NAME);
    IF TG_OP = 'UPDATE' THEN
      previous_details := CASE WHEN TG_TABLE_NAME = 'budgets' THEN public.audit_budget_snapshot(to_jsonb(OLD)) ELSE public.audit_recurring_snapshot(to_jsonb(OLD)) END;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN change_action := 'created';
  ELSIF TG_OP = 'DELETE' THEN change_action := 'deleted';
  ELSIF TG_TABLE_NAME = 'recurring_entries' AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    change_action := CASE WHEN NEW.is_active THEN 'resumed' ELSE 'paused' END;
  ELSE change_action := 'updated';
  END IF;

  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (owner_id, TG_TABLE_NAME, changed_id, label, change_action,
    CASE WHEN previous_details IS NULL THEN jsonb_build_object('current', current_details) ELSE jsonb_build_object('previous', previous_details, 'current', current_details) END);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
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
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'authentication', caller, email_label, p_action,
    jsonb_build_object('Email', email_label, 'Session policy', 'This browser tab only'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_item_snapshot(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_transaction_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_budget_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_recurring_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_item_audit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_transaction_audit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_simple_audit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_auth_activity(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_auth_activity(text) TO authenticated;
