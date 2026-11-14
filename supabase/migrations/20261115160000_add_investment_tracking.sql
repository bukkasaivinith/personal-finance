/* Productive investment tracking: values, partial returns and goals. */

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS current_estimated_value numeric(14, 2),
  ADD COLUMN IF NOT EXISTS value_updated_on date,
  ADD COLUMN IF NOT EXISTS target_amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS maturity_date date;

UPDATE public.investments
SET current_estimated_value = COALESCE(final_amount, principal_amount),
    value_updated_on = COALESCE(settled_on, invested_on)
WHERE current_estimated_value IS NULL;

ALTER TABLE public.investments
  DROP CONSTRAINT IF EXISTS investments_current_estimated_value_check,
  DROP CONSTRAINT IF EXISTS investments_target_amount_check,
  DROP CONSTRAINT IF EXISTS investments_maturity_date_check;
ALTER TABLE public.investments
  ADD CONSTRAINT investments_current_estimated_value_check CHECK (current_estimated_value IS NULL OR current_estimated_value >= 0),
  ADD CONSTRAINT investments_target_amount_check CHECK (target_amount IS NULL OR target_amount > 0),
  ADD CONSTRAINT investments_maturity_date_check CHECK (maturity_date IS NULL OR maturity_date >= invested_on);

CREATE TABLE IF NOT EXISTS public.investment_value_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  investment_id uuid NOT NULL REFERENCES public.investments(id) ON DELETE CASCADE,
  estimated_value numeric(14, 2) NOT NULL CHECK (estimated_value >= 0),
  valued_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investment_id, valued_on)
);
CREATE INDEX IF NOT EXISTS investment_value_updates_user_investment_date_idx ON public.investment_value_updates (user_id, investment_id, valued_on DESC);

CREATE TABLE IF NOT EXISTS public.investment_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  investment_id uuid NOT NULL REFERENCES public.investments(id) ON DELETE CASCADE,
  amount_received numeric(14, 2) NOT NULL CHECK (amount_received > 0),
  capital_return numeric(14, 2) NOT NULL CHECK (capital_return >= 0),
  profit_amount numeric(14, 2) NOT NULL CHECK (profit_amount >= 0),
  withdrawn_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS investment_withdrawals_user_investment_date_idx ON public.investment_withdrawals (user_id, investment_id, withdrawn_on DESC);

ALTER TABLE public.investment_value_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_withdrawals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investment_value_updates, public.investment_withdrawals FROM PUBLIC, anon;
GRANT SELECT ON public.investment_value_updates, public.investment_withdrawals TO authenticated;

DROP POLICY IF EXISTS "Own investment value updates" ON public.investment_value_updates;
CREATE POLICY "Own investment value updates" ON public.investment_value_updates FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Own investment withdrawals" ON public.investment_withdrawals;
CREATE POLICY "Own investment withdrawals" ON public.investment_withdrawals FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_investment_tracking_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.current_estimated_value IS NULL THEN NEW.current_estimated_value := NEW.principal_amount; END IF;
  IF NEW.value_updated_on IS NULL THEN NEW.value_updated_on := NEW.invested_on; END IF;
  IF NEW.status = 'settled' AND NEW.final_amount IS NOT NULL THEN
    NEW.current_estimated_value := NEW.final_amount;
    NEW.value_updated_on := COALESCE(NEW.settled_on, NEW.value_updated_on);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS investments_set_tracking_defaults ON public.investments;
CREATE TRIGGER investments_set_tracking_defaults BEFORE INSERT OR UPDATE ON public.investments FOR EACH ROW EXECUTE FUNCTION public.set_investment_tracking_defaults();

CREATE OR REPLACE FUNCTION public.update_investment_tracking(
  p_investment_id uuid, p_current_estimated_value numeric, p_valued_on date,
  p_target_amount numeric DEFAULT NULL, p_maturity_date date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE caller uuid := auth.uid(); investment public.investments%ROWTYPE;
BEGIN
  PERFORM public.require_current_single_device_session();
  IF p_current_estimated_value IS NULL OR p_current_estimated_value < 0 THEN RAISE EXCEPTION 'Enter a current value of zero or more.'; END IF;
  SELECT * INTO investment FROM public.investments WHERE id = p_investment_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND OR investment.status <> 'active' THEN RAISE EXCEPTION 'Only active investments can be updated.'; END IF;
  IF p_valued_on IS NULL OR p_valued_on < investment.invested_on THEN RAISE EXCEPTION 'Choose a value date on or after the investment date.'; END IF;
  IF p_target_amount IS NOT NULL AND p_target_amount <= 0 THEN RAISE EXCEPTION 'Target amount must be greater than zero.'; END IF;
  IF p_maturity_date IS NOT NULL AND p_maturity_date < investment.invested_on THEN RAISE EXCEPTION 'Maturity date cannot be before the investment date.'; END IF;
  UPDATE public.investments SET current_estimated_value = p_current_estimated_value, value_updated_on = p_valued_on, target_amount = p_target_amount, maturity_date = p_maturity_date, updated_at = now() WHERE id = investment.id;
  INSERT INTO public.investment_value_updates (user_id, investment_id, estimated_value, valued_on) VALUES (caller, investment.id, p_current_estimated_value, p_valued_on)
  ON CONFLICT (investment_id, valued_on) DO UPDATE SET estimated_value = EXCLUDED.estimated_value, created_at = now();
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment.id, investment.name, 'updated', jsonb_build_object('current', jsonb_build_object('Current estimated value (₹)', p_current_estimated_value, 'Value date', p_valued_on, 'Target amount (₹)', p_target_amount, 'Maturity date', p_maturity_date)));
END;
$$;

CREATE OR REPLACE FUNCTION public.record_investment_withdrawal(p_investment_id uuid, p_amount_received numeric, p_withdrawn_on date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid(); investment public.investments%ROWTYPE; income_type_id uuid; category_id uuid;
  already_returned numeric(14,2); remaining_capital numeric(14,2); capital_part numeric(14,2); profit_part numeric(14,2);
BEGIN
  PERFORM public.require_current_single_device_session();
  IF p_amount_received IS NULL OR p_amount_received <= 0 THEN RAISE EXCEPTION 'Enter an amount greater than zero.'; END IF;
  SELECT * INTO investment FROM public.investments WHERE id = p_investment_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND OR investment.status <> 'active' THEN RAISE EXCEPTION 'Only active investments can have a partial return.'; END IF;
  IF p_withdrawn_on IS NULL OR p_withdrawn_on < investment.invested_on THEN RAISE EXCEPTION 'Choose a return date on or after the investment date.'; END IF;
  SELECT COALESCE(SUM(capital_return), 0) INTO already_returned FROM public.investment_withdrawals WHERE investment_id = investment.id AND user_id = caller;
  remaining_capital := GREATEST(investment.principal_amount - already_returned, 0);
  capital_part := LEAST(p_amount_received, remaining_capital);
  profit_part := GREATEST(p_amount_received - capital_part, 0);
  income_type_id := public.ensure_investment_type('income'); category_id := public.ensure_investment_category(income_type_id);
  IF capital_part > 0 THEN
    INSERT INTO public.transactions (user_id, investment_id, name, transaction_type_id, category_id, amount, transaction_date, transaction_time, account_id, to_account_id, transaction_source)
    VALUES (caller, investment.id, 'Investment capital return: ' || investment.name || ' · ' || investment.investment_type, income_type_id, category_id, capital_part, p_withdrawn_on, NULL, investment.funding_account_id, NULL, 'investment');
  END IF;
  IF profit_part > 0 THEN
    INSERT INTO public.transactions (user_id, investment_id, name, transaction_type_id, category_id, amount, transaction_date, transaction_time, account_id, to_account_id, transaction_source)
    VALUES (caller, investment.id, 'Investment profit: ' || investment.name || ' · ' || investment.investment_type, income_type_id, category_id, profit_part, p_withdrawn_on, NULL, investment.funding_account_id, NULL, 'investment');
  END IF;
  INSERT INTO public.investment_withdrawals (user_id, investment_id, amount_received, capital_return, profit_amount, withdrawn_on) VALUES (caller, investment.id, p_amount_received, capital_part, profit_part, p_withdrawn_on);
  UPDATE public.investments SET current_estimated_value = GREATEST(COALESCE(current_estimated_value, principal_amount) - p_amount_received, 0), value_updated_on = p_withdrawn_on, updated_at = now() WHERE id = investment.id;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment.id, investment.name, 'updated', jsonb_build_object('current', jsonb_build_object('Partial amount received (₹)', p_amount_received, 'Capital returned (₹)', capital_part, 'Profit credited (₹)', profit_part, 'Returned on', p_withdrawn_on)));
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_investment(p_investment_id uuid, p_final_amount numeric, p_settled_on date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid(); investment public.investments%ROWTYPE; income_type_id uuid; income_category_id uuid; account_name text;
  prior_capital numeric(14,2); prior_profit numeric(14,2); prior_total numeric(14,2); remaining_capital numeric(14,2); capital_return numeric(14,2); profit numeric(14,2); settlement_id uuid;
BEGIN
  PERFORM public.require_current_single_device_session();
  IF p_final_amount IS NULL OR p_final_amount < 0 THEN RAISE EXCEPTION 'Enter a final amount of zero or more.'; END IF;
  SELECT * INTO investment FROM public.investments WHERE id = p_investment_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND OR investment.status <> 'active' THEN RAISE EXCEPTION 'This investment is unavailable or already settled.'; END IF;
  IF p_settled_on < investment.invested_on THEN RAISE EXCEPTION 'Settlement date cannot be before the investment date.'; END IF;
  SELECT name INTO account_name FROM public.accounts WHERE id = investment.funding_account_id AND user_id = caller AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'The account used for this investment is no longer active.'; END IF;
  SELECT COALESCE(SUM(capital_return),0), COALESCE(SUM(profit_amount),0), COALESCE(SUM(amount_received),0) INTO prior_capital, prior_profit, prior_total FROM public.investment_withdrawals WHERE investment_id = investment.id AND user_id = caller;
  remaining_capital := GREATEST(investment.principal_amount - prior_capital, 0);
  capital_return := LEAST(p_final_amount, remaining_capital);
  profit := GREATEST(p_final_amount - capital_return, 0);
  income_type_id := public.ensure_investment_type('income'); income_category_id := public.ensure_investment_category(income_type_id);
  IF capital_return > 0 THEN INSERT INTO public.transactions (user_id, investment_id, name, transaction_type_id, category_id, amount, transaction_date, transaction_time, account_id, to_account_id, transaction_source) VALUES (caller, investment.id, 'Investment capital return: ' || investment.name || ' · ' || investment.investment_type, income_type_id, income_category_id, capital_return, p_settled_on, NULL, investment.funding_account_id, NULL, 'investment') RETURNING id INTO settlement_id; END IF;
  IF profit > 0 THEN INSERT INTO public.transactions (user_id, investment_id, name, transaction_type_id, category_id, amount, transaction_date, transaction_time, account_id, to_account_id, transaction_source) VALUES (caller, investment.id, 'Investment profit: ' || investment.name || ' · ' || investment.investment_type, income_type_id, income_category_id, profit, p_settled_on, NULL, investment.funding_account_id, NULL, 'investment') RETURNING id INTO settlement_id; END IF;
  UPDATE public.investments SET status = 'settled', final_amount = prior_total + p_final_amount, profit_amount = prior_profit + profit - GREATEST(remaining_capital - p_final_amount, 0), settled_on = p_settled_on, settlement_transaction_id = settlement_id, current_estimated_value = p_final_amount, value_updated_on = p_settled_on, updated_at = now() WHERE id = investment.id;
  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (caller, 'investments', investment.id, investment.name, 'settled', jsonb_build_object('current', jsonb_build_object('Final receipt (₹)', p_final_amount, 'Total returned (₹)', prior_total + p_final_amount, 'Capital returned now (₹)', capital_return, 'Profit credited now (₹)', profit, 'Settled on', p_settled_on, 'Returned to account', account_name)));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_investment_tracking(uuid, numeric, date, numeric, date), public.record_investment_withdrawal(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_investment_tracking(uuid, numeric, date, numeric, date), public.record_investment_withdrawal(uuid, numeric, date) TO authenticated;
