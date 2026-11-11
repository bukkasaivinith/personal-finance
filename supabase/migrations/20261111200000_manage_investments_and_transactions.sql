/*
  Investment administration and safe transaction deletion.

  - Investment types are now reusable, user-owned records instead of free text.
  - Editing or deleting an investment keeps its linked accounting transactions in sync.
  - Profitable settlements create two account entries: capital return and profit.
  - Manual/scheduled transactions can be deleted safely; investment entries are managed
    through their investment so financial links cannot be broken.
*/

CREATE TABLE IF NOT EXISTS public.investment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS investment_types_user_name_key
  ON public.investment_types (user_id, lower(name));

ALTER TABLE public.investments ADD COLUMN IF NOT EXISTS investment_type_id uuid;

INSERT INTO public.investment_types (user_id, name)
SELECT DISTINCT user_id, btrim(investment_type)
FROM public.investments
WHERE btrim(investment_type) <> ''
ON CONFLICT DO NOTHING;

UPDATE public.investments AS investment
SET investment_type_id = investment_type.id
FROM public.investment_types AS investment_type
WHERE investment.investment_type_id IS NULL
  AND investment_type.user_id = investment.user_id
  AND lower(investment_type.name) = lower(investment.investment_type);

ALTER TABLE public.investments
  ALTER COLUMN investment_type_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'investments_investment_type_id_fkey'
      AND conrelid = 'public.investments'::regclass
  ) THEN
    ALTER TABLE public.investments
      ADD CONSTRAINT investments_investment_type_id_fkey
      FOREIGN KEY (investment_type_id) REFERENCES public.investment_types(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS investments_user_type_idx ON public.investments (user_id, investment_type_id);

ALTER TABLE public.investment_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investment_types FROM anon, authenticated;
GRANT SELECT ON public.investment_types TO authenticated;
DROP POLICY IF EXISTS investment_types_select_own ON public.investment_types;
CREATE POLICY investment_types_select_own ON public.investment_types
  FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_entity_table_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_entity_table_check
  CHECK (entity_table IN ('transaction_types', 'categories', 'accounts', 'transactions', 'budgets', 'recurring_entries', 'authentication', 'investments', 'investment_types'));

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
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before creating an investment type.'; END IF;
  IF clean_name IS NULL OR char_length(clean_name) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Give the investment type a name between 1 and 40 characters.'; END IF;
  INSERT INTO public.investment_types (user_id, name)
  VALUES (caller, clean_name)
  RETURNING id INTO result_id;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investment_types', result_id, clean_name, 'created', jsonb_build_object('current', jsonb_build_object('Name', clean_name)));
  RETURN result_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That investment type already exists.';
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
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before editing an investment type.'; END IF;
  IF clean_name IS NULL OR char_length(clean_name) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Give the investment type a name between 1 and 40 characters.'; END IF;
  SELECT name INTO previous_name FROM public.investment_types
  WHERE id = p_investment_type_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment type is unavailable.'; END IF;
  UPDATE public.investment_types SET name = clean_name, updated_at = now()
  WHERE id = p_investment_type_id AND user_id = caller;
  UPDATE public.investments SET investment_type = clean_name, updated_at = now()
  WHERE user_id = caller AND investment_type_id = p_investment_type_id;
  UPDATE public.transactions
  SET name = replace(name, ' · ' || previous_name, ' · ' || clean_name)
  WHERE user_id = caller
    AND investment_id IN (SELECT id FROM public.investments WHERE user_id = caller AND investment_type_id = p_investment_type_id);
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investment_types', p_investment_type_id, clean_name, 'renamed', jsonb_build_object('previous', jsonb_build_object('Name', previous_name), 'current', jsonb_build_object('Name', clean_name)));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That investment type already exists.';
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
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before deleting an investment type.'; END IF;
  SELECT name INTO previous_name FROM public.investment_types
  WHERE id = p_investment_type_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment type is unavailable.'; END IF;
  IF EXISTS (SELECT 1 FROM public.investments WHERE user_id = caller AND investment_type_id = p_investment_type_id) THEN
    RAISE EXCEPTION 'This type is used by an investment. Rename it or delete the related investments first.';
  END IF;
  DELETE FROM public.investment_types WHERE id = p_investment_type_id AND user_id = caller;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investment_types', p_investment_type_id, previous_name, 'deleted', jsonb_build_object('previous', jsonb_build_object('Name', previous_name)));
END;
$$;

DROP FUNCTION IF EXISTS public.record_investment(text, text, text, uuid, numeric, date);
CREATE OR REPLACE FUNCTION public.record_investment(
  p_name text,
  p_investment_type_id uuid,
  p_notes text,
  p_funding_account_id uuid,
  p_principal_amount numeric,
  p_invested_on date
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
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before creating an investment.'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Give this investment a name.'; END IF;
  IF p_principal_amount IS NULL OR p_principal_amount <= 0 THEN RAISE EXCEPTION 'Enter an investment amount greater than zero.'; END IF;
  SELECT name INTO investment_type_name FROM public.investment_types
  WHERE id = p_investment_type_id AND user_id = caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an investment type.'; END IF;
  SELECT name INTO account_name FROM public.accounts
  WHERE id = p_funding_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
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
    caller, investment_id, 'Investment capital: ' || btrim(p_name) || ' · ' || investment_type_name, expense_type_id, category_id,
    p_principal_amount, p_invested_on, NULL, p_funding_account_id, NULL, 'investment'
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
  p_investment_id uuid,
  p_name text,
  p_investment_type_id uuid,
  p_notes text,
  p_funding_account_id uuid,
  p_principal_amount numeric,
  p_invested_on date
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
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before editing an investment.'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Give this investment a name.'; END IF;
  IF p_principal_amount IS NULL OR p_principal_amount <= 0 THEN RAISE EXCEPTION 'Enter an investment amount greater than zero.'; END IF;
  SELECT * INTO investment FROM public.investments WHERE id = p_investment_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment is unavailable.'; END IF;
  SELECT name INTO investment_type_name FROM public.investment_types WHERE id = p_investment_type_id AND user_id = caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an investment type.'; END IF;
  IF investment.status = 'settled' AND (p_funding_account_id <> investment.funding_account_id OR p_principal_amount <> investment.principal_amount OR p_invested_on <> investment.invested_on) THEN
    RAISE EXCEPTION 'Only the name, type and notes can be changed after an investment is settled.';
  END IF;
  SELECT name INTO account_name FROM public.accounts
  WHERE id = p_funding_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active account to invest from.'; END IF;

  UPDATE public.investments
  SET name = btrim(p_name), investment_type = investment_type_name, investment_type_id = p_investment_type_id,
      notes = NULLIF(btrim(p_notes), ''), funding_account_id = p_funding_account_id,
      capital_account_id = p_funding_account_id, principal_amount = p_principal_amount,
      invested_on = p_invested_on, updated_at = now()
  WHERE id = investment.id;

  UPDATE public.transactions
  SET name = 'Investment capital: ' || btrim(p_name) || ' · ' || investment_type_name, amount = p_principal_amount,
      transaction_date = p_invested_on, account_id = p_funding_account_id
  WHERE id = investment.opening_transaction_id AND user_id = caller;
  UPDATE public.transactions
  SET name = CASE
    WHEN name LIKE 'Investment capital return:%' THEN 'Investment capital return: ' || btrim(p_name) || ' · ' || investment_type_name
    WHEN name LIKE 'Investment profit:%' THEN 'Investment profit: ' || btrim(p_name) || ' · ' || investment_type_name
    WHEN name LIKE 'Investment loss:%' THEN 'Investment loss: ' || btrim(p_name) || ' · ' || investment_type_name
    WHEN name LIKE 'Investment return:%' THEN 'Investment return: ' || btrim(p_name) || ' · ' || investment_type_name
    ELSE name
  END
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
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before deleting an investment.'; END IF;
  SELECT * INTO investment FROM public.investments WHERE id = p_investment_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment is unavailable.'; END IF;
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO transaction_ids
  FROM public.transactions WHERE investment_id = investment.id AND user_id = caller;
  DELETE FROM public.investments WHERE id = investment.id AND user_id = caller;
  IF cardinality(transaction_ids) > 0 THEN
    DELETE FROM public.transactions WHERE user_id = caller AND id = ANY(transaction_ids);
  END IF;
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
  expense_type_id uuid;
  income_category_id uuid;
  expense_category_id uuid;
  account_name text;
  profit numeric(14, 2);
  capital_return numeric(14, 2);
  settlement_id uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before settling an investment.'; END IF;
  IF p_final_amount IS NULL OR p_final_amount < 0 THEN RAISE EXCEPTION 'Enter a final amount of zero or more.'; END IF;
  SELECT * INTO investment FROM public.investments WHERE id = p_investment_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment is unavailable.'; END IF;
  IF investment.status <> 'active' THEN RAISE EXCEPTION 'This investment has already been settled.'; END IF;
  IF p_settled_on < investment.invested_on THEN RAISE EXCEPTION 'Settlement date cannot be before the investment date.'; END IF;
  SELECT name INTO account_name FROM public.accounts
  WHERE id = investment.funding_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'The account used for this investment is no longer active.'; END IF;

  profit := p_final_amount - investment.principal_amount;
  capital_return := LEAST(p_final_amount, investment.principal_amount);
  income_type_id := public.ensure_investment_type('income');
  income_category_id := public.ensure_investment_category(income_type_id);
  IF capital_return > 0 THEN
    INSERT INTO public.transactions (
      user_id, investment_id, name, transaction_type_id, category_id, amount,
      transaction_date, transaction_time, account_id, to_account_id, transaction_source
    ) VALUES (
      caller, investment.id, 'Investment capital return: ' || investment.name || ' · ' || investment.investment_type, income_type_id, income_category_id,
      capital_return, p_settled_on, NULL, investment.funding_account_id, NULL, 'investment'
    ) RETURNING id INTO settlement_id;
  END IF;
  IF profit > 0 THEN
    INSERT INTO public.transactions (
      user_id, investment_id, name, transaction_type_id, category_id, amount,
      transaction_date, transaction_time, account_id, to_account_id, transaction_source
    ) VALUES (
      caller, investment.id, 'Investment profit: ' || investment.name || ' · ' || investment.investment_type, income_type_id, income_category_id,
      profit, p_settled_on, NULL, investment.funding_account_id, NULL, 'investment'
    ) RETURNING id INTO settlement_id;
  END IF;

  UPDATE public.investments
  SET status = 'settled', final_amount = p_final_amount, profit_amount = profit,
      settled_on = p_settled_on, settlement_transaction_id = settlement_id, updated_at = now()
  WHERE id = investment.id;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment.id, investment.name, 'settled', jsonb_build_object(
    'previous', jsonb_build_object('Capital committed (₹)', investment.principal_amount, 'Status', 'Active'),
    'current', jsonb_build_object('Total amount received (₹)', p_final_amount, 'Capital returned (₹)', capital_return,
      'Profit / loss (₹)', profit, 'Settled on', p_settled_on, 'Status', 'Settled', 'Returned to account', account_name,
      'Accounting', CASE WHEN profit > 0 THEN 'Capital return and profit recorded as separate transactions' ELSE 'Actual returned capital credited to funding account' END)
  ));
END;
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
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before deleting a transaction.'; END IF;
  SELECT * INTO transaction_row FROM public.transactions
  WHERE id = p_transaction_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That transaction is unavailable.'; END IF;
  IF transaction_row.investment_id IS NOT NULL THEN
    RAISE EXCEPTION 'This entry is managed by an investment. Edit or delete the investment instead.';
  END IF;
  DELETE FROM public.transactions WHERE id = transaction_row.id AND user_id = caller;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_investment_type(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rename_investment_type(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_investment_type(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_investment(text, uuid, text, uuid, numeric, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_investment(uuid, text, uuid, text, uuid, numeric, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_investment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.settle_investment(uuid, numeric, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_investment_type(text), public.rename_investment_type(uuid, text), public.delete_investment_type(uuid), public.record_investment(text, uuid, text, uuid, numeric, date), public.update_investment(uuid, text, uuid, text, uuid, numeric, date), public.delete_investment(uuid), public.settle_investment(uuid, numeric, date), public.delete_transaction(uuid) TO authenticated;
