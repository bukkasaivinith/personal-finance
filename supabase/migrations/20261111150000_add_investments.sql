/*
  Universal investment tracking.
  An investment begins with a transfer to an existing Investment Capital
  account. Settling it adds only the calculated profit or loss to that same
  capital account. This avoids recording capital twice.
*/

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_transaction_source_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_transaction_source_check
  CHECK (transaction_source IN ('manual', 'scheduled', 'investment'));

CREATE TABLE IF NOT EXISTS public.investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  investment_type text NOT NULL CHECK (char_length(btrim(investment_type)) BETWEEN 1 AND 40),
  notes text,
  funding_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  capital_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  principal_amount numeric(14, 2) NOT NULL CHECK (principal_amount > 0),
  invested_on date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled')),
  final_amount numeric(14, 2) CHECK (final_amount IS NULL OR final_amount >= 0),
  profit_amount numeric(14, 2),
  settled_on date,
  opening_transaction_id uuid UNIQUE REFERENCES public.transactions(id) ON DELETE RESTRICT,
  settlement_transaction_id uuid UNIQUE REFERENCES public.transactions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'active' AND final_amount IS NULL AND profit_amount IS NULL AND settled_on IS NULL AND settlement_transaction_id IS NULL)
    OR (status = 'settled' AND final_amount IS NOT NULL AND profit_amount IS NOT NULL AND settled_on IS NOT NULL
      AND ((profit_amount = 0 AND settlement_transaction_id IS NULL) OR (profit_amount <> 0 AND settlement_transaction_id IS NOT NULL))))
);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS investment_id uuid REFERENCES public.investments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS transactions_investment_id_idx ON public.transactions (investment_id);

CREATE INDEX IF NOT EXISTS investments_user_invested_on_idx ON public.investments (user_id, invested_on DESC);
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investments FROM anon, authenticated;
GRANT SELECT ON public.investments TO authenticated;
CREATE POLICY investments_select_own ON public.investments FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_entity_table_check;
ALTER TABLE public.audit_events ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_entity_table_check
  CHECK (entity_table IN ('transaction_types', 'categories', 'accounts', 'transactions', 'budgets', 'recurring_entries', 'authentication', 'investments'));
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_action_check
  CHECK (action IN ('created', 'renamed', 'deactivated', 'activated', 'deleted', 'restored', 'updated', 'permanently_deleted', 'paused', 'resumed', 'processed', 'signed_in', 'signed_out', 'settled'));

CREATE OR REPLACE FUNCTION public.investment_account_name(p_account_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT name FROM public.accounts WHERE id = p_account_id AND user_id = p_user_id $$;

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
    'Source', CASE p_row ->> 'transaction_source'
      WHEN 'scheduled' THEN 'Scheduled recurring entry'
      WHEN 'investment' THEN 'Investment entry'
      ELSE 'Manual entry'
    END
  ));
$$;

CREATE OR REPLACE FUNCTION public.create_investment(
  p_name text,
  p_investment_type text,
  p_notes text,
  p_funding_account_id uuid,
  p_capital_account_id uuid,
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
  transfer_type public.transaction_types%ROWTYPE;
  investment_id uuid;
  opening_id uuid;
  funding_name text;
  capital_name text;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before creating an investment.'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Give this investment a name.'; END IF;
  IF p_investment_type IS NULL OR char_length(btrim(p_investment_type)) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Choose an investment type.'; END IF;
  IF p_principal_amount IS NULL OR p_principal_amount <= 0 THEN RAISE EXCEPTION 'Enter an investment amount greater than zero.'; END IF;
  IF p_funding_account_id <> p_capital_account_id THEN
    SELECT * INTO transfer_type FROM public.transaction_types WHERE user_id = caller AND kind = 'transfer' AND is_active AND deleted_at IS NULL ORDER BY created_at LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Create an active Transfer transaction type before adding an investment funded from another account.'; END IF;
    SELECT name INTO funding_name FROM public.accounts WHERE id = p_funding_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active account to fund the investment.'; END IF;
  END IF;
  SELECT name INTO capital_name FROM public.accounts WHERE id = p_capital_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active Investment Capital account.'; END IF;

  INSERT INTO public.investments (user_id, name, investment_type, notes, funding_account_id, capital_account_id, principal_amount, invested_on)
  VALUES (caller, btrim(p_name), btrim(p_investment_type), NULLIF(btrim(p_notes), ''), p_funding_account_id, p_capital_account_id, p_principal_amount, p_invested_on)
  RETURNING id INTO investment_id;

  IF p_funding_account_id <> p_capital_account_id THEN
    INSERT INTO public.transactions (
    user_id, investment_id, name, transaction_type_id, category_id, amount, transaction_date, transaction_time,
    account_id, to_account_id, transaction_type_name, transaction_kind, category_name, account_name, to_account_name, transaction_source
    ) VALUES (
    caller, investment_id, 'Investment capital: ' || btrim(p_name), transfer_type.id, NULL, p_principal_amount, p_invested_on, NULL,
    p_funding_account_id, p_capital_account_id, transfer_type.name, 'transfer', NULL, funding_name, capital_name, 'investment'
    ) RETURNING id INTO opening_id;
    UPDATE public.investments SET opening_transaction_id = opening_id WHERE id = investment_id;
  END IF;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment_id, btrim(p_name), 'created', jsonb_build_object('current', jsonb_build_object(
    'Investment type', btrim(p_investment_type), 'Capital (₹)', p_principal_amount, 'Funded from', funding_name,
    'Investment Capital account', capital_name, 'Invested on', p_invested_on, 'Status', 'Active', 'Notes', NULLIF(btrim(p_notes), ''),
    'Capital movement', CASE WHEN p_funding_account_id = p_capital_account_id THEN 'Already held in Investment Capital' ELSE 'Transferred from ' || funding_name END
  )));
  RETURN investment_id;
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
  income_type public.transaction_types%ROWTYPE;
  expense_type public.transaction_types%ROWTYPE;
  chosen_type public.transaction_types%ROWTYPE;
  category record;
  capital_name text;
  profit numeric(14, 2);
  settlement_id uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before settling an investment.'; END IF;
  IF p_final_amount IS NULL OR p_final_amount < 0 THEN RAISE EXCEPTION 'Enter a final value of zero or more.'; END IF;
  SELECT * INTO investment FROM public.investments WHERE id = p_investment_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment is unavailable.'; END IF;
  IF investment.status <> 'active' THEN RAISE EXCEPTION 'This investment has already been settled.'; END IF;
  IF p_settled_on < investment.invested_on THEN RAISE EXCEPTION 'Settlement date cannot be before the investment date.'; END IF;
  SELECT name INTO capital_name FROM public.accounts WHERE id = investment.capital_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'The Investment Capital account is no longer active.'; END IF;
  profit := p_final_amount - investment.principal_amount;

  IF profit > 0 THEN
    SELECT * INTO chosen_type FROM public.transaction_types WHERE user_id = caller AND kind = 'income' AND is_active AND deleted_at IS NULL ORDER BY created_at LIMIT 1;
  ELSIF profit < 0 THEN
    SELECT * INTO chosen_type FROM public.transaction_types WHERE user_id = caller AND kind = 'expense' AND is_active AND deleted_at IS NULL ORDER BY created_at LIMIT 1;
  END IF;

  IF profit <> 0 THEN
    IF NOT FOUND THEN RAISE EXCEPTION 'Create an active income or expense type before settling this investment.'; END IF;
    SELECT c.id, c.name INTO category FROM public.categories c JOIN public.category_transaction_types l ON l.category_id = c.id
    WHERE c.user_id = caller AND c.is_active AND c.deleted_at IS NULL AND l.transaction_type_id = chosen_type.id AND l.user_id = caller
    ORDER BY c.created_at LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Create an active category for the selected income or expense type before settling this investment.'; END IF;
    INSERT INTO public.transactions (
      user_id, investment_id, name, transaction_type_id, category_id, amount, transaction_date, transaction_time,
      account_id, to_account_id, transaction_type_name, transaction_kind, category_name, account_name, to_account_name, transaction_source
    ) VALUES (
      caller, investment.id, CASE WHEN profit > 0 THEN 'Investment profit: ' ELSE 'Investment loss: ' END || investment.name,
      chosen_type.id, category.id, abs(profit), p_settled_on, NULL, investment.capital_account_id, NULL,
      chosen_type.name, chosen_type.kind, category.name, capital_name, NULL, 'investment'
    ) RETURNING id INTO settlement_id;
  END IF;

  UPDATE public.investments
  SET status = 'settled', final_amount = p_final_amount, profit_amount = profit, settled_on = p_settled_on,
      settlement_transaction_id = settlement_id, updated_at = now()
  WHERE id = investment.id;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment.id, investment.name, 'settled', jsonb_build_object(
    'previous', jsonb_build_object('Capital (₹)', investment.principal_amount, 'Status', 'Active'),
    'current', jsonb_build_object('Final value (₹)', p_final_amount, 'Profit / loss (₹)', profit, 'Settled on', p_settled_on, 'Status', 'Settled', 'Investment Capital account', capital_name)
  ));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.investment_account_name(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_investment(text, text, text, uuid, uuid, numeric, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.settle_investment(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_investment(text, text, text, uuid, uuid, numeric, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_investment(uuid, numeric, date) TO authenticated;
