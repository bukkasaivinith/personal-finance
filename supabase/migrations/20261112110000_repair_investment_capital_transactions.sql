/*
  Investment capital transaction repair

  Every investment must create its capital outflow immediately. Earlier
  investment releases could leave an investment without its opening
  transaction when the funding and capital accounts were the same. This
  migration repairs those rows once and reinforces the current RPC used by
  the application.
*/

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

  SELECT name INTO investment_type_name
  FROM public.investment_types
  WHERE id = p_investment_type_id AND user_id = caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an investment type.'; END IF;

  SELECT name INTO account_name
  FROM public.accounts
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

  -- This is deliberately inserted in the same database operation as the
  -- investment. A successful investment can never wait for settlement before
  -- its capital debit appears in the transaction history.
  INSERT INTO public.transactions (
    user_id, investment_id, name, transaction_type_id, category_id, amount,
    transaction_date, transaction_time, account_id, to_account_id, transaction_source
  ) VALUES (
    caller, investment_id, 'Investment capital: ' || btrim(p_name) || ' · ' || investment_type_name,
    expense_type_id, category_id, p_principal_amount, p_invested_on, NULL,
    p_funding_account_id, NULL, 'investment'
  ) RETURNING id INTO opening_id;

  UPDATE public.investments
  SET opening_transaction_id = opening_id
  WHERE id = investment_id;

  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment_id, btrim(p_name), 'created', jsonb_build_object('current', jsonb_build_object(
    'Investment type', investment_type_name,
    'Capital committed (₹)', p_principal_amount,
    'Invested from account', account_name,
    'Invested on', p_invested_on,
    'Status', 'Active',
    'Accounting', 'Capital outflow; capital return and profit credited separately',
    'Notes', NULLIF(btrim(p_notes), '')
  )));

  RETURN investment_id;
END;
$$;

-- Reconnect a capital transaction that was already written, but whose link
-- was not saved on the investment row. This avoids creating a duplicate.
WITH existing_capital AS (
  SELECT DISTINCT ON (t.investment_id) t.investment_id, t.id
  FROM public.transactions t
  WHERE t.investment_id IS NOT NULL
    AND t.transaction_source = 'investment'
    AND t.transaction_kind = 'expense'
  ORDER BY t.investment_id, t.transaction_date, t.created_at, t.id
)
UPDATE public.investments i
SET opening_transaction_id = existing_capital.id
FROM existing_capital
WHERE i.id = existing_capital.investment_id
  AND i.opening_transaction_id IS NULL;

-- Backfill the remaining investments. The procedure is idempotent: after an
-- opening transaction is linked, the row is never selected again.
DO $$
DECLARE
  investment_row record;
  expense_type_id uuid;
  category_id uuid;
  opening_id uuid;
BEGIN
  FOR investment_row IN
    SELECT i.*
    FROM public.investments i
    WHERE i.opening_transaction_id IS NULL
    ORDER BY i.created_at, i.id
  LOOP
    -- Do not invent a transaction for an archived source account. All active
    -- accounts are repaired; an archived account retains its historical data.
    IF NOT EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.id = investment_row.funding_account_id
        AND a.user_id = investment_row.user_id
        AND a.is_active
        AND a.deleted_at IS NULL
    ) THEN
      CONTINUE;
    END IF;

    SELECT id INTO expense_type_id
    FROM public.transaction_types
    WHERE user_id = investment_row.user_id
      AND lower(name) = 'investment capital'
      AND kind = 'expense'
      AND deleted_at IS NULL
    ORDER BY is_active DESC, created_at, id
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.transaction_types (user_id, name, kind)
      VALUES (investment_row.user_id, 'Investment capital', 'expense')
      RETURNING id INTO expense_type_id;
    ELSE
      UPDATE public.transaction_types
      SET is_active = true, updated_at = now()
      WHERE id = expense_type_id AND NOT is_active;
    END IF;

    SELECT id INTO category_id
    FROM public.categories
    WHERE user_id = investment_row.user_id
      AND lower(name) = 'investments'
      AND deleted_at IS NULL
    ORDER BY is_active DESC, created_at, id
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.categories (user_id, name)
      VALUES (investment_row.user_id, 'Investments')
      RETURNING id INTO category_id;
    ELSE
      UPDATE public.categories
      SET is_active = true, updated_at = now()
      WHERE id = category_id AND NOT is_active;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.category_transaction_types link
      WHERE link.category_id = category_id
        AND link.transaction_type_id = expense_type_id
        AND link.user_id = investment_row.user_id
    ) THEN
      INSERT INTO public.category_transaction_types (user_id, category_id, transaction_type_id)
      VALUES (investment_row.user_id, category_id, expense_type_id);
    END IF;

    INSERT INTO public.transactions (
      user_id, investment_id, name, transaction_type_id, category_id, amount,
      transaction_date, transaction_time, account_id, to_account_id, transaction_source
    ) VALUES (
      investment_row.user_id,
      investment_row.id,
      'Investment capital: ' || investment_row.name || ' · ' || investment_row.investment_type,
      expense_type_id,
      category_id,
      investment_row.principal_amount,
      investment_row.invested_on,
      NULL,
      investment_row.funding_account_id,
      NULL,
      'investment'
    ) RETURNING id INTO opening_id;

    UPDATE public.investments
    SET opening_transaction_id = opening_id,
        accounting_mode = 'return_to_funding',
        capital_account_id = funding_account_id,
        updated_at = now()
    WHERE id = investment_row.id;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_investment(text, uuid, text, uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_investment(text, uuid, text, uuid, numeric, date) TO authenticated;
