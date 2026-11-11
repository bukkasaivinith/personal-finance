/*
  Investment accounting v2

  New investments use two clear entries in the account that funded them:
    1. Investment capital — an expense for the capital committed.
    2. Investment return — income for the total amount received later.

  This works equally for stocks, funds, gold, a small business, money lent to
  a friend, and other investments. The difference between the two is stored as
  profit or loss. Existing capital-pool investments keep their previous
  accounting behaviour, so their balances are never changed retroactively.
*/

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS accounting_mode text NOT NULL DEFAULT 'capital_pool'
    CHECK (accounting_mode IN ('capital_pool', 'return_to_funding'));

-- The first investment release required a separate capital account and had a
-- stricter settlement-id check. Constraint names differ between projects, so
-- remove only those two obsolete checks by their definitions.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.investments'::regclass
      AND c.contype = 'c'
      AND (pg_get_constraintdef(c.oid) LIKE '%funding_account_id <> capital_account_id%'
        OR (pg_get_constraintdef(c.oid) LIKE '%settlement_transaction_id%' AND pg_get_constraintdef(c.oid) LIKE '%status%'))
  LOOP
    EXECUTE format('ALTER TABLE public.investments DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;

ALTER TABLE public.investments ADD CONSTRAINT investments_settlement_consistency_check
  CHECK ((status = 'active' AND final_amount IS NULL AND profit_amount IS NULL AND settled_on IS NULL AND settlement_transaction_id IS NULL)
    OR (status = 'settled' AND final_amount IS NOT NULL AND profit_amount IS NOT NULL AND settled_on IS NOT NULL));

ALTER TABLE public.audit_events ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.ensure_investment_type(p_kind text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  target_name text := CASE WHEN p_kind = 'income' THEN 'Investment return' ELSE 'Investment capital' END;
  type_id uuid;
BEGIN
  IF caller IS NULL OR p_kind NOT IN ('income', 'expense') THEN RAISE EXCEPTION 'Invalid investment transaction type.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('investment-type-' || caller::text || '-' || p_kind));
  SELECT id INTO type_id FROM public.transaction_types
  WHERE user_id = caller AND lower(name) = lower(target_name) AND kind = p_kind AND is_active AND deleted_at IS NULL;
  IF FOUND THEN RETURN type_id; END IF;
  INSERT INTO public.transaction_types (user_id, name, kind)
  VALUES (caller, target_name, p_kind)
  RETURNING id INTO type_id;
  RETURN type_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_investment_category(p_type_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  result_category_id uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before recording an investment.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('investment-category-' || caller::text));
  SELECT c.id INTO result_category_id
  FROM public.categories c
  WHERE c.user_id = caller AND lower(c.name) = 'investments' AND c.is_active AND c.deleted_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.categories (user_id, name) VALUES (caller, 'Investments') RETURNING id INTO result_category_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.category_transaction_types l
    WHERE l.category_id = result_category_id AND l.transaction_type_id = p_type_id AND l.user_id = caller
  ) THEN
    INSERT INTO public.category_transaction_types (user_id, category_id, transaction_type_id)
    VALUES (caller, result_category_id, p_type_id);
  END IF;
  RETURN result_category_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_investment(
  p_name text,
  p_investment_type text,
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
  investment_id uuid;
  opening_id uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before creating an investment.'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Give this investment a name.'; END IF;
  IF p_investment_type IS NULL OR char_length(btrim(p_investment_type)) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Choose or enter an investment type.'; END IF;
  IF p_principal_amount IS NULL OR p_principal_amount <= 0 THEN RAISE EXCEPTION 'Enter an investment amount greater than zero.'; END IF;
  SELECT name INTO account_name FROM public.accounts
  WHERE id = p_funding_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active account to invest from.'; END IF;

  expense_type_id := public.ensure_investment_type('expense');
  category_id := public.ensure_investment_category(expense_type_id);
  INSERT INTO public.investments (
    user_id, name, investment_type, notes, funding_account_id, capital_account_id,
    principal_amount, invested_on, accounting_mode
  ) VALUES (
    caller, btrim(p_name), btrim(p_investment_type), NULLIF(btrim(p_notes), ''),
    p_funding_account_id, p_funding_account_id, p_principal_amount, p_invested_on, 'return_to_funding'
  ) RETURNING id INTO investment_id;

  INSERT INTO public.transactions (
    user_id, investment_id, name, transaction_type_id, category_id, amount,
    transaction_date, transaction_time, account_id, to_account_id, transaction_source
  ) VALUES (
    caller, investment_id, 'Investment capital: ' || btrim(p_name), expense_type_id, category_id,
    p_principal_amount, p_invested_on, NULL, p_funding_account_id, NULL, 'investment'
  ) RETURNING id INTO opening_id;
  UPDATE public.investments SET opening_transaction_id = opening_id WHERE id = investment_id;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment_id, btrim(p_name), 'created', jsonb_build_object('current', jsonb_build_object(
    'Investment type', btrim(p_investment_type), 'Capital committed (₹)', p_principal_amount,
    'Invested from account', account_name, 'Invested on', p_invested_on, 'Status', 'Active',
    'Accounting', 'Capital outflow and full return to the funding account', 'Notes', NULLIF(btrim(p_notes), '')
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
  transaction_type_id uuid;
  category_id uuid;
  account_name text;
  profit numeric(14, 2);
  settlement_id uuid;
  settlement_kind text;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in before settling an investment.'; END IF;
  IF p_final_amount IS NULL OR p_final_amount < 0 THEN RAISE EXCEPTION 'Enter a final amount of zero or more.'; END IF;
  SELECT * INTO investment FROM public.investments WHERE id = p_investment_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That investment is unavailable.'; END IF;
  IF investment.status <> 'active' THEN RAISE EXCEPTION 'This investment has already been settled.'; END IF;
  IF p_settled_on < investment.invested_on THEN RAISE EXCEPTION 'Settlement date cannot be before the investment date.'; END IF;
  profit := p_final_amount - investment.principal_amount;

  IF investment.accounting_mode = 'return_to_funding' THEN
    SELECT name INTO account_name FROM public.accounts
    WHERE id = investment.funding_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'The account used for this investment is no longer active.'; END IF;
    IF p_final_amount > 0 THEN
      transaction_type_id := public.ensure_investment_type('income');
      category_id := public.ensure_investment_category(transaction_type_id);
      INSERT INTO public.transactions (
        user_id, investment_id, name, transaction_type_id, category_id, amount,
        transaction_date, transaction_time, account_id, to_account_id, transaction_source
      ) VALUES (
        caller, investment.id, 'Investment return: ' || investment.name, transaction_type_id, category_id,
        p_final_amount, p_settled_on, NULL, investment.funding_account_id, NULL, 'investment'
      ) RETURNING id INTO settlement_id;
    END IF;
  ELSE
    -- Preserve the first Investment Capital release's accounting for any
    -- existing investment created before this migration.
    SELECT name INTO account_name FROM public.accounts
    WHERE id = investment.capital_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'The legacy Investment Capital account is no longer active.'; END IF;
    IF profit <> 0 THEN
      settlement_kind := CASE WHEN profit > 0 THEN 'income' ELSE 'expense' END;
      transaction_type_id := public.ensure_investment_type(settlement_kind);
      category_id := public.ensure_investment_category(transaction_type_id);
      INSERT INTO public.transactions (
        user_id, investment_id, name, transaction_type_id, category_id, amount,
        transaction_date, transaction_time, account_id, to_account_id, transaction_source
      ) VALUES (
        caller, investment.id, CASE WHEN profit > 0 THEN 'Investment profit: ' ELSE 'Investment loss: ' END || investment.name,
        transaction_type_id, category_id, abs(profit), p_settled_on, NULL, investment.capital_account_id, NULL, 'investment'
      ) RETURNING id INTO settlement_id;
    END IF;
  END IF;

  UPDATE public.investments
  SET status = 'settled', final_amount = p_final_amount, profit_amount = profit,
      settled_on = p_settled_on, settlement_transaction_id = settlement_id, updated_at = now()
  WHERE id = investment.id;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment.id, investment.name, 'settled', jsonb_build_object(
    'previous', jsonb_build_object('Capital committed (₹)', investment.principal_amount, 'Status', 'Active'),
    'current', jsonb_build_object('Total amount received (₹)', p_final_amount, 'Profit / loss (₹)', profit,
      'Settled on', p_settled_on, 'Status', 'Settled',
      'Returned to account', account_name,
      'Accounting', CASE WHEN investment.accounting_mode = 'return_to_funding' THEN 'Full return credited to funding account' ELSE 'Legacy Investment Capital accounting' END)
  ));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_investment(text, text, text, uuid, uuid, numeric, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_investment_type(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_investment_category(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_investment(text, text, text, uuid, numeric, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.settle_investment(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_investment(text, text, text, uuid, numeric, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_investment(uuid, numeric, date) TO authenticated;
