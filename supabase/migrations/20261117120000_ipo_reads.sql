BEGIN;
CREATE FUNCTION public.ipo_dashboard() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=public.ipo_require_owner(); r jsonb:='{}'; t text; records jsonb;
BEGIN
 FOREACH t IN ARRAY ARRAY['applicants','applicant_accounts','companies','cash_accounts','applications','events','allotments','sales','settlements'] LOOP
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x)),''[]''::jsonb) FROM public.ipo_%I x WHERE user_id=$1',t) INTO records USING u;
  r:=r||jsonb_build_object(t,records);
 END LOOP;
 RETURN r;
END $$;

-- Small finance adapter; shared workspace members receive no private IPO metadata.
CREATE FUNCTION public.ipo_finance_links(p_owner_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid; r jsonb;
BEGIN
 PERFORM public.require_current_single_device_session();
 IF p_owner_id<>auth.uid() THEN RETURN '{}'::jsonb; END IF;
 u:=public.ipo_require_owner();
 SELECT jsonb_build_object(
  'balances',jsonb_build_object(
   'applications',(SELECT count(*) FROM public.ipo_applications WHERE user_id=u),
   'invested',(SELECT COALESCE(sum(al.cost-COALESCE(s.cost,0)),0) FROM public.ipo_allotments al
    LEFT JOIN LATERAL(SELECT sum(cost_basis) cost FROM public.ipo_sales WHERE application_id=al.application_id AND NOT voided) s ON true WHERE al.user_id=u AND NOT al.voided),
   'applicant_custody',(SELECT COALESCE(sum(public.ipo_balance(account_id)),0) FROM public.ipo_cash_accounts WHERE user_id=u AND purpose='friend'),
   'awaiting_receipt',(SELECT COALESCE(sum(public.ipo_balance(account_id)),0) FROM public.ipo_cash_accounts WHERE user_id=u AND purpose='proceeds'),
   'refund_due',(SELECT COALESCE(sum(refund_due),0) FROM public.ipo_applications WHERE user_id=u),
   'prepaid_pending',(SELECT COALESCE(sum(greatest(0,prepaid-refund_due)),0) FROM public.ipo_applications WHERE user_id=u),
   'blocked',(SELECT COALESCE(sum(blocked),0) FROM public.ipo_applications WHERE user_id=u)),
  'investments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',al.investment_id,'application_id',a.id,'name',c.name||' IPO — '||p.name||' / '||da.nickname,'voided',al.voided,
   'sold_cost',COALESCE(s.cost,0),'proceeds',COALESCE(s.proceeds,0),'profit',COALESCE(s.profit,0),'remaining_shares',al.shares-COALESCE(s.shares,0)))
   FROM public.ipo_allotments al JOIN public.ipo_applications a ON a.id=al.application_id JOIN public.ipo_companies c ON c.id=a.company_id JOIN public.ipo_applicant_accounts da ON da.id=a.applicant_account_id JOIN public.ipo_applicants p ON p.id=da.applicant_id
   LEFT JOIN LATERAL(SELECT sum(cost_basis) cost,sum(net) proceeds,sum(profit) profit,sum(shares) shares FROM public.ipo_sales WHERE application_id=a.id AND NOT voided) s ON true
   WHERE al.user_id=u AND al.investment_id IS NOT NULL),'[]'),
  'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'custody',c.purpose,'blocked',COALESCE(b.amount,0))) FROM public.accounts a
   LEFT JOIN public.ipo_cash_accounts c ON c.account_id=a.id
   LEFT JOIN LATERAL(SELECT sum(ap.blocked) amount FROM public.ipo_applications ap JOIN public.ipo_applicant_accounts da ON da.id=ap.applicant_account_id WHERE ap.user_id=u AND ((ap.funding_method='direct' AND ap.funding_account_id=a.id) OR(ap.funding_method='friend' AND da.applicant_id=c.applicant_id))) b ON true
   WHERE a.user_id=u AND (c.id IS NOT NULL OR b.amount>0)),'[]'),
  'memos',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',c.name||' · '||replace(e.command,'_',' '),'amount',e.amount,'date',e.event_date,'application_id',e.application_id,'account_id',COALESCE(e.account_id,a.funding_account_id),'reversed',e.reversed))
   FROM public.ipo_events e JOIN public.ipo_applications a ON a.id=e.application_id JOIN public.ipo_companies c ON c.id=a.company_id WHERE e.user_id=u AND e.memo AND e.command IN ('application','edit_application','block','unblock','mandate','allot')),'[]')
 ) INTO r;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.ipo_dashboard(),public.ipo_finance_links(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ipo_dashboard(),public.ipo_finance_links(uuid) TO authenticated;

-- Preserve the existing explicit account-deletion workflow and its authorization.
-- This helper has no browser grant; only the existing authorized callers use it.
ALTER FUNCTION public.purge_finance_user(uuid) RENAME TO purge_finance_user_before_ipo;
REVOKE ALL ON FUNCTION public.purge_finance_user_before_ipo(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.purge_finance_user(p_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.ipo_write_context(transaction_id,user_id) VALUES(txid_current(),p_user_id);
 UPDATE public.transactions SET ipo_event_id=NULL WHERE user_id=p_user_id AND ipo_event_id IS NOT NULL;
 DELETE FROM public.ipo_settlements WHERE user_id=p_user_id;
 DELETE FROM public.ipo_sales WHERE user_id=p_user_id;
 DELETE FROM public.ipo_allotments WHERE user_id=p_user_id;
 DELETE FROM public.ipo_events WHERE user_id=p_user_id;
 DELETE FROM public.ipo_applications WHERE user_id=p_user_id;
 DELETE FROM public.ipo_cash_accounts WHERE user_id=p_user_id;
 DELETE FROM public.ipo_applicant_accounts WHERE user_id=p_user_id;
 DELETE FROM public.ipo_applicants WHERE user_id=p_user_id;
 DELETE FROM public.ipo_companies WHERE user_id=p_user_id;
 PERFORM public.purge_finance_user_before_ipo(p_user_id);
 DELETE FROM public.ipo_write_context WHERE transaction_id=txid_current();
END $$;
REVOKE ALL ON FUNCTION public.purge_finance_user(uuid) FROM PUBLIC,anon,authenticated;
-- Qualify the existing withdrawal aggregate: capital_return is also a local variable.
-- Financial behavior and existing execute grants are unchanged.
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
  SELECT COALESCE(SUM(w.capital_return),0), COALESCE(SUM(w.profit_amount),0), COALESCE(SUM(w.amount_received),0) INTO prior_capital, prior_profit, prior_total FROM public.investment_withdrawals w WHERE w.investment_id = investment.id AND w.user_id = caller;
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
COMMIT;
