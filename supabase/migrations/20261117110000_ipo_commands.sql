BEGIN;

-- One lock per workspace serializes financial decisions across applications and pools.
-- The unique request key also makes a network retry return the original result.
CREATE FUNCTION public.ipo_command(p_request_id uuid,p_command text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 u uuid:=public.ipo_require_owner(); e uuid; target uuid:=NULLIF(p_data->>'id','')::uuid;
 app public.ipo_applications; co public.ipo_companies; demat public.ipo_applicant_accounts;
 al public.ipo_allotments; sale public.ipo_sales; old_event public.ipo_events; tx record;
 d date:=COALESCE(NULLIF(p_data->>'date','')::date,(now() AT TIME ZONE 'Asia/Kolkata')::date);
 bank uuid:=NULLIF(p_data->>'account_id','')::uuid; person uuid:=NULLIF(p_data->>'applicant_id','')::uuid;
 app_id uuid:=NULLIF(p_data->>'application_id','')::uuid; company uuid:=NULLIF(p_data->>'company_id','')::uuid;
 cash uuid; inv uuid; it uuid; opening uuid; result_id uuid;
 n numeric:=COALESCE(NULLIF(p_data->>'amount','')::numeric,0); cost numeric; fees numeric; net numeric; basis numeric;
 qty integer; sold integer; total_net numeric; total_basis numeric; available numeric; outcome text; before_inv jsonb;
 detail jsonb:='{}';
BEGIN
 IF p_request_id IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'A request key and details are required.'; END IF;
 FOR tx IN SELECT key,value FROM jsonb_each_text(p_data) WHERE key IN ('amount','issue_price','adjustment','purchase_charges','price','charges','reference_price') LOOP
  IF tx.value IS NOT NULL AND tx.value<>'' AND tx.value !~ '^-?[0-9]+(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Amounts must be finite INR values with at most two decimals.'; END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('ipo:'||u::text,0));
 SELECT * INTO old_event FROM public.ipo_events WHERE user_id=u AND request_id=p_request_id;
 IF FOUND THEN
  IF old_event.command<>p_command OR old_event.payload<>p_data THEN RAISE EXCEPTION 'This request key was already used for different details.'; END IF;
  RETURN jsonb_build_object('event_id',old_event.id,'id',old_event.details->>'result_id');
 END IF;
 INSERT INTO public.ipo_write_context(transaction_id,user_id) VALUES(txid_current(),u);
 IF n<>round(n,2) OR n<0 THEN RAISE EXCEPTION 'Use a nonnegative amount with at most two decimal places.'; END IF;
 IF bank IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.id=bank AND a.user_id=u AND a.is_active AND a.deleted_at IS NULL AND NOT a.is_liability AND NOT EXISTS(SELECT 1 FROM public.ipo_cash_accounts c WHERE c.account_id=a.id)) THEN RAISE EXCEPTION 'Choose your own active bank or cash account.'; END IF;
 IF person IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ipo_applicants WHERE id=person AND user_id=u) THEN RAISE EXCEPTION 'Applicant unavailable.'; END IF;
 IF company IS NOT NULL THEN SELECT * INTO co FROM public.ipo_companies WHERE id=company AND user_id=u; IF NOT FOUND THEN RAISE EXCEPTION 'Company unavailable.'; END IF; END IF;
 IF app_id IS NOT NULL THEN
  SELECT * INTO app FROM public.ipo_applications WHERE id=app_id AND user_id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application unavailable.'; END IF;
  company:=app.company_id; SELECT * INTO co FROM public.ipo_companies WHERE id=company AND user_id=u;
  SELECT * INTO demat FROM public.ipo_applicant_accounts WHERE id=app.applicant_account_id AND user_id=u; person:=demat.applicant_id;
  detail:=jsonb_build_object('before_application',to_jsonb(app));
  IF d<app.application_date AND p_command NOT IN ('edit_application','reverse') THEN RAISE EXCEPTION 'An event cannot precede its application.'; END IF;
 END IF;
 IF d>(now() AT TIME ZONE 'Asia/Kolkata')::date AND p_command NOT IN ('company','applicant','demat','event') THEN RAISE EXCEPTION 'Record actual movements on or before today. Use an expected event for future dates.'; END IF;
 INSERT INTO public.ipo_events(user_id,request_id,command,payload,application_id,company_id,applicant_id,event_date,account_id,details)
 VALUES(u,p_request_id,p_command,p_data,app_id,company,person,d,bank,detail) RETURNING id INTO e;

 CASE p_command
 WHEN 'applicant' THEN
  IF target IS NULL THEN
   INSERT INTO public.ipo_applicants(user_id,name,designation,relationship,notes) VALUES(u,btrim(p_data->>'name'),p_data->>'designation',COALESCE(p_data->>'relationship',''),COALESCE(p_data->>'notes','')) RETURNING id INTO result_id;
  ELSE
   SELECT to_jsonb(a) INTO detail FROM public.ipo_applicants a WHERE id=target AND user_id=u; IF NOT FOUND THEN RAISE EXCEPTION 'Applicant unavailable.'; END IF;
   UPDATE public.ipo_applicants SET name=btrim(p_data->>'name'),designation=p_data->>'designation',relationship=COALESCE(p_data->>'relationship',''),notes=COALESCE(p_data->>'notes',''),archived=COALESCE((p_data->>'archived')::boolean,false) WHERE id=target AND user_id=u; result_id:=target;
   UPDATE public.accounts SET name='IPO custody · '||left(btrim(p_data->>'name'),14)||' · '||left(target::text,8)
    WHERE id IN(SELECT account_id FROM public.ipo_cash_accounts WHERE user_id=u AND applicant_id=target);
  END IF;
  UPDATE public.ipo_events SET applicant_id=result_id,details=jsonb_build_object('before',detail) WHERE id=e;
 WHEN 'demat' THEN
  IF person IS NULL THEN RAISE EXCEPTION 'Choose an applicant.'; END IF;
  IF target IS NULL THEN
   INSERT INTO public.ipo_applicant_accounts(user_id,applicant_id,nickname,broker,demat_label,bank_nickname,notes) VALUES(u,person,btrim(p_data->>'nickname'),COALESCE(p_data->>'broker',''),COALESCE(p_data->>'demat_label',''),COALESCE(p_data->>'bank_nickname',''),COALESCE(p_data->>'notes','')) RETURNING id INTO result_id;
  ELSE
   SELECT to_jsonb(a) INTO detail FROM public.ipo_applicant_accounts a WHERE id=target AND user_id=u AND applicant_id=person; IF NOT FOUND THEN RAISE EXCEPTION 'Demat account unavailable; its owner cannot be changed.'; END IF;
   UPDATE public.ipo_applicant_accounts SET nickname=btrim(p_data->>'nickname'),broker=COALESCE(p_data->>'broker',''),demat_label=COALESCE(p_data->>'demat_label',''),bank_nickname=COALESCE(p_data->>'bank_nickname',''),notes=COALESCE(p_data->>'notes',''),archived=COALESCE((p_data->>'archived')::boolean,false) WHERE id=target AND user_id=u; result_id:=target;
  END IF;
  UPDATE public.ipo_events SET details=jsonb_build_object('before',detail) WHERE id=e;
 WHEN 'company' THEN
  IF jsonb_typeof(COALESCE(p_data->'dates','{}'))<>'object' THEN RAISE EXCEPTION 'Invalid company dates.'; END IF;
  FOR tx IN SELECT key,value FROM jsonb_each_text(COALESCE(p_data->'dates','{}')) LOOP
   IF tx.key NOT IN ('opening','closing','expected_allotment','actual_allotment','expected_refund','actual_refund','expected_listing','actual_listing') THEN RAISE EXCEPTION 'Unknown date field.'; END IF;
   IF tx.value IS NOT NULL AND tx.value<>'' THEN
    PERFORM tx.value::date;
    IF tx.key LIKE 'actual_%' AND tx.value::date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'An actual company date cannot be in the future.'; END IF;
   END IF;
  END LOOP;
  IF NULLIF(p_data->'dates'->>'opening','')::date>NULLIF(p_data->'dates'->>'closing','')::date THEN RAISE EXCEPTION 'Closing date cannot precede opening date.'; END IF;
  IF target IS NULL THEN
   INSERT INTO public.ipo_companies(user_id,name,symbol,classification,issue_price,lot_size,minimum_lots,dates,notes) VALUES(u,btrim(p_data->>'name'),COALESCE(p_data->>'symbol',''),p_data->>'classification',(p_data->>'issue_price')::numeric,(p_data->>'lot_size')::integer,(p_data->>'minimum_lots')::integer,COALESCE(p_data->'dates','{}'),COALESCE(p_data->>'notes','')) RETURNING id INTO result_id;
  ELSE
   SELECT to_jsonb(c) INTO detail FROM public.ipo_companies c WHERE id=target AND user_id=u; IF NOT FOUND THEN RAISE EXCEPTION 'Company unavailable.'; END IF;
   UPDATE public.ipo_companies SET name=btrim(p_data->>'name'),symbol=COALESCE(p_data->>'symbol',''),classification=p_data->>'classification',issue_price=(p_data->>'issue_price')::numeric,lot_size=(p_data->>'lot_size')::integer,minimum_lots=(p_data->>'minimum_lots')::integer,dates=dates||COALESCE(p_data->'dates','{}'),notes=COALESCE(p_data->>'notes',''),archived=COALESCE((p_data->>'archived')::boolean,false) WHERE id=target AND user_id=u; result_id:=target;
  END IF;
  UPDATE public.ipo_events SET company_id=result_id,details=jsonb_build_object('before',detail) WHERE id=e;
 WHEN 'application','edit_application' THEN
  IF company IS NULL OR co.archived OR bank IS NULL THEN RAISE EXCEPTION 'Choose an active company and funding account.'; END IF;
  SELECT * INTO demat FROM public.ipo_applicant_accounts WHERE id=(p_data->>'applicant_account_id')::uuid AND user_id=u AND NOT archived;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.ipo_applicants WHERE id=demat.applicant_id AND archived) THEN RAISE EXCEPTION 'Choose an active applicant account.'; END IF;
  IF (p_data->>'lots')::integer<co.minimum_lots THEN RAISE EXCEPTION 'Application is below the company minimum lots.'; END IF;
  IF p_command='edit_application' THEN
   IF app.id IS NULL OR app.blocked>0 OR app.prepaid>0 OR EXISTS(SELECT 1 FROM public.ipo_allotments WHERE application_id=app.id AND NOT voided) THEN RAISE EXCEPTION 'Release funds or reverse dependent events before editing this application.'; END IF;
   IF EXISTS(SELECT 1 FROM public.ipo_events WHERE application_id=app.id AND id<>e AND NOT reversed AND command NOT IN ('application','edit_application','reverse') AND event_date<d) THEN RAISE EXCEPTION 'Application date cannot be after its recorded activity.'; END IF;
   UPDATE public.ipo_applications SET applicant_account_id=demat.id,application_date=d,lots=(p_data->>'lots')::integer,lot_size=(p_data->>'lot_size')::integer,issue_price=(p_data->>'issue_price')::numeric,adjustment=COALESCE((p_data->>'adjustment')::numeric,0),adjustment_reason=COALESCE(p_data->>'adjustment_reason',''),funding_method=p_data->>'funding_method',funding_account_id=bank,reference=COALESCE(p_data->>'reference',''),notes=COALESCE(p_data->>'notes','') WHERE id=app.id RETURNING * INTO app;
  ELSE
   INSERT INTO public.ipo_applications(user_id,company_id,applicant_account_id,application_date,lots,lot_size,issue_price,adjustment,adjustment_reason,funding_method,funding_account_id,reference,notes)
   VALUES(u,company,demat.id,d,(p_data->>'lots')::integer,(p_data->>'lot_size')::integer,(p_data->>'issue_price')::numeric,COALESCE((p_data->>'adjustment')::numeric,0),COALESCE(p_data->>'adjustment_reason',''),p_data->>'funding_method',bank,COALESCE(p_data->>'reference',''),COALESCE(p_data->>'notes','')) RETURNING * INTO app;
  END IF;
  result_id:=app.id;
  UPDATE public.ipo_events SET application_id=app.id,applicant_id=demat.applicant_id,amount=app.amount,account_id=bank WHERE id=e;
 WHEN 'block' THEN
  IF app.id IS NULL OR app.status<>'applied' OR n<=0 OR app.blocked+n>app.amount OR app.prepaid>0 THEN RAISE EXCEPTION 'Invalid block amount or application state.'; END IF;
  IF app.funding_method='friend' THEN
   cash:=public.ipo_cash_account('friend',person);
   SELECT COALESCE(sum(a.blocked),0) INTO available FROM public.ipo_applications a JOIN public.ipo_applicant_accounts da ON da.id=a.applicant_account_id WHERE da.applicant_id=person AND a.funding_method='friend';
   IF public.ipo_balance(cash)-available<n THEN RAISE EXCEPTION 'Transfer enough funds to this applicant first.'; END IF;
  END IF;
  UPDATE public.ipo_applications SET blocked=blocked+n WHERE id=app.id;
 WHEN 'unblock' THEN
  IF app.id IS NULL OR n<=0 OR n>app.blocked THEN RAISE EXCEPTION 'Release cannot exceed the remaining block.'; END IF;
  UPDATE public.ipo_applications SET blocked=blocked-n WHERE id=app.id;
 WHEN 'prepay' THEN
  IF app.id IS NULL OR app.funding_method<>'direct' OR app.status<>'applied' OR app.blocked>0 OR n<=0 OR app.prepaid+n>app.amount THEN RAISE EXCEPTION 'Invalid prepayment. Use a block for ASBA funds still in your bank.'; END IF;
  cash:=public.ipo_cash_account('escrow');
  PERFORM public.ipo_post(e,'transfer',n,d,app.funding_account_id,cash,NULL,'IPO prepayment: '||co.name);
  UPDATE public.ipo_applications SET prepaid=prepaid+n WHERE id=app.id;
 WHEN 'fund_friend','repay' THEN
  IF person IS NULL OR bank IS NULL OR n<=0 THEN RAISE EXCEPTION 'Choose an applicant, bank and positive amount.'; END IF;
  cash:=public.ipo_cash_account('friend',person);
  IF p_command='repay' THEN
   SELECT COALESCE(sum(a.blocked),0) INTO available FROM public.ipo_applications a JOIN public.ipo_applicant_accounts da ON da.id=a.applicant_account_id WHERE da.applicant_id=person AND a.funding_method='friend';
   IF n>public.ipo_balance(cash)-available THEN RAISE EXCEPTION 'Repayment exceeds unreserved funds held by this applicant.'; END IF;
  END IF;
  PERFORM public.ipo_post(e,'transfer',n,d,CASE WHEN p_command='fund_friend' THEN bank ELSE cash END,CASE WHEN p_command='fund_friend' THEN cash ELSE bank END,NULL,CASE WHEN p_command='fund_friend' THEN 'IPO funds sent to applicant' ELSE 'IPO applicant repayment' END);
  INSERT INTO public.ipo_settlements(user_id,event_id,applicant_id,amount,received_on,receiving_account_id,kind) VALUES(u,e,person,n,d,CASE WHEN p_command='fund_friend' THEN cash ELSE bank END,CASE WHEN p_command='fund_friend' THEN 'funding' ELSE 'repayment' END);
 WHEN 'allot' THEN
  IF app.id IS NULL OR EXISTS(SELECT 1 FROM public.ipo_allotments WHERE application_id=app.id AND NOT voided) THEN RAISE EXCEPTION 'This application already has an allotment result.'; END IF;
  qty:=(p_data->>'shares')::integer; fees:=COALESCE((p_data->>'purchase_charges')::numeric,0); outcome:=p_data->>'result';
  IF qty IS NULL OR qty<0 OR qty>app.lots*app.lot_size OR fees<0 OR fees<>round(fees,2) OR (outcome IN ('full','partial'))<>(qty>0) OR (outcome='full' AND qty<>app.lots*app.lot_size) OR (outcome='partial' AND qty=app.lots*app.lot_size) OR (qty=0 AND fees<>0) THEN RAISE EXCEPTION 'Check allotted shares, result and purchase charges.'; END IF;
  cost:=round(qty*app.issue_price+fees,2);
  IF app.prepaid>0 AND cost>app.prepaid THEN RAISE EXCEPTION 'Prepaid funds are insufficient; correct the prepayment first.'; END IF;
  IF app.funding_method='friend' THEN
   cash:=public.ipo_cash_account('friend',person);
   SELECT COALESCE(sum(a.blocked),0) INTO available FROM public.ipo_applications a JOIN public.ipo_applicant_accounts da ON da.id=a.applicant_account_id WHERE da.applicant_id=person AND a.funding_method='friend' AND a.id<>app.id;
   IF cost>public.ipo_balance(cash)-available THEN RAISE EXCEPTION 'Insufficient uncommitted funds with this applicant.'; END IF;
  ELSIF app.prepaid>0 THEN cash:=public.ipo_cash_account('escrow'); ELSE cash:=app.funding_account_id; END IF;
  IF qty>0 THEN
   SELECT id INTO it FROM public.investment_types WHERE user_id=u AND lower(name)='ipo';
   IF it IS NULL THEN INSERT INTO public.investment_types(user_id,name) VALUES(u,'IPO') RETURNING id INTO it; END IF;
   INSERT INTO public.investments(user_id,name,investment_type,investment_type_id,notes,funding_account_id,capital_account_id,principal_amount,invested_on,accounting_mode)
   VALUES(u,left(co.name||' IPO — '||demat.nickname,80),'IPO',it,'Managed in IPO. Application '||app.id,app.funding_account_id,app.funding_account_id,cost,d,'return_to_funding') RETURNING id INTO inv;
   opening:=public.ipo_post(e,'expense',cost,d,cash,NULL,inv,'IPO allotment: '||co.name);
   UPDATE public.investments SET opening_transaction_id=opening WHERE id=inv;
  END IF;
  INSERT INTO public.ipo_allotments(user_id,application_id,event_id,result,shares,purchase_charges,cost,allotted_on,investment_id) VALUES(u,app.id,e,outcome,qty,fees,cost,d,inv) RETURNING id INTO result_id;
  UPDATE public.ipo_applications SET status=outcome,blocked=greatest(0,blocked-least(cost,qty*issue_price)),refund_due=greatest(0,prepaid-cost),prepaid=greatest(0,prepaid-cost) WHERE id=app.id;
  n:=cost; UPDATE public.ipo_events SET details=details||jsonb_build_object('investment_id',inv,'shares',qty,'result',outcome) WHERE id=e;
 WHEN 'refund' THEN
  IF app.id IS NULL OR n<=0 OR n>app.refund_due OR bank IS NULL THEN RAISE EXCEPTION 'Refund must be against actual prepaid funds still due.'; END IF;
  cash:=public.ipo_cash_account('escrow'); PERFORM public.ipo_post(e,'transfer',n,d,cash,bank,NULL,'IPO refund: '||co.name);
  UPDATE public.ipo_applications SET refund_due=refund_due-n,prepaid=prepaid-n WHERE id=app.id;
  INSERT INTO public.ipo_settlements(user_id,event_id,amount,received_on,receiving_account_id,kind) VALUES(u,e,n,d,bank,'refund');
 WHEN 'sale' THEN
  SELECT * INTO al FROM public.ipo_allotments WHERE application_id=app.id AND user_id=u AND NOT voided AND shares>0;
  IF NOT FOUND OR d<al.allotted_on THEN RAISE EXCEPTION 'Record an allotment before selling shares.'; END IF;
  qty:=(p_data->>'shares')::integer; fees:=COALESCE((p_data->>'charges')::numeric,0); n:=(p_data->>'price')::numeric;
  SELECT COALESCE(sum(shares),0),COALESCE(sum(cost_basis),0),COALESCE(sum(s.net),0) INTO sold,total_basis,total_net FROM public.ipo_sales s WHERE application_id=app.id AND NOT voided;
  IF qty IS NULL OR qty<=0 OR sold+qty>al.shares OR n IS NULL OR n<0 OR fees<0 OR n<>round(n,2) OR fees<>round(fees,2) OR d<COALESCE((SELECT max(sold_on) FROM public.ipo_sales WHERE application_id=app.id AND NOT voided),al.allotted_on) THEN RAISE EXCEPTION 'Check remaining shares, price, charges and sale date.'; END IF;
  net:=round(qty*n-fees,2); IF net<0 THEN RAISE EXCEPTION 'Charges cannot exceed gross proceeds.'; END IF;
  basis:=round(al.cost*(sold+qty)/al.shares,2)-total_basis;
  INSERT INTO public.ipo_sales(user_id,application_id,event_id,shares,price,charges,gross,net,cost_basis,profit,sold_on) VALUES(u,app.id,e,qty,n,fees,qty*n,net,basis,net-basis,d) RETURNING id INTO result_id;
  SELECT to_jsonb(i) INTO before_inv FROM public.investments i WHERE id=al.investment_id;
  UPDATE public.ipo_events SET details=details||jsonb_build_object('before_investment',before_inv,'shares',qty,'cost_basis',basis,'profit',net-basis) WHERE id=e;
  cash:=public.ipo_cash_account('proceeds'); PERFORM public.ipo_post(e,'income',net,d,cash,NULL,al.investment_id,'IPO sale: '||co.name);
  IF sold+qty=al.shares THEN
   UPDATE public.investments SET status='settled',final_amount=total_net+net,profit_amount=total_net+net-al.cost,settled_on=d WHERE id=al.investment_id;
  ELSE UPDATE public.investments SET current_estimated_value=al.cost-total_basis-basis,value_updated_on=d WHERE id=al.investment_id; END IF;
  n:=net;
 WHEN 'receipt' THEN
  SELECT * INTO sale FROM public.ipo_sales WHERE id=(p_data->>'sale_id')::uuid AND user_id=u AND NOT voided;
  IF NOT FOUND OR n<=0 OR d<sale.sold_on THEN RAISE EXCEPTION 'Choose a sale and valid receipt amount/date.'; END IF;
  SELECT sale.net-COALESCE(sum(amount),0) INTO available FROM public.ipo_settlements WHERE sale_id=sale.id AND NOT voided AND kind='receipt';
  IF n>available THEN RAISE EXCEPTION 'Receipt exceeds unsettled sale proceeds.'; END IF;
  SELECT * INTO app FROM public.ipo_applications WHERE id=sale.application_id AND user_id=u;
  IF p_data->>'destination'='friend' THEN
   SELECT applicant_id INTO person FROM public.ipo_applicant_accounts WHERE id=app.applicant_account_id;
   bank:=public.ipo_cash_account('friend',person);
  ELSIF bank IS NULL OR p_data->>'destination'<>'bank' THEN RAISE EXCEPTION 'Choose a receiving bank or applicant custody account.'; END IF;
  cash:=public.ipo_cash_account('proceeds'); PERFORM public.ipo_post(e,'transfer',n,d,cash,bank,NULL,'IPO sale proceeds received');
  INSERT INTO public.ipo_settlements(user_id,event_id,sale_id,applicant_id,amount,received_on,receiving_account_id,kind) VALUES(u,e,sale.id,CASE WHEN p_data->>'destination'='friend' THEN person ELSE NULL END,n,d,bank,'receipt');
  UPDATE public.ipo_events SET application_id=app.id,company_id=app.company_id,applicant_id=(SELECT applicant_id FROM public.ipo_applicant_accounts WHERE id=app.applicant_account_id),account_id=bank WHERE id=e;
 WHEN 'mandate' THEN
  IF app.id IS NULL THEN RAISE EXCEPTION 'Choose an application.'; END IF;
  UPDATE public.ipo_applications SET mandate=p_data->>'status' WHERE id=app.id;
 WHEN 'event' THEN
  IF company IS NULL OR p_data->>'kind' NOT IN ('shares_credited','listing','expected_refund','expected_allotment','expected_listing','note') THEN RAISE EXCEPTION 'Choose a company and event type.'; END IF;
  IF d>(now() AT TIME ZONE 'Asia/Kolkata')::date AND NOT (COALESCE((p_data->>'expected')::boolean,false) OR p_data->>'kind' LIKE 'expected_%') THEN RAISE EXCEPTION 'A future event must be marked expected.'; END IF;
  UPDATE public.ipo_events SET expected=COALESCE((p_data->>'expected')::boolean,false) OR p_data->>'kind' LIKE 'expected_%',details=details||jsonb_build_object('kind',p_data->>'kind','notes',COALESCE(p_data->>'notes',''),'reference_price',NULLIF(p_data->>'reference_price','')::numeric) WHERE id=e;
 WHEN 'reverse' THEN
  SELECT * INTO old_event FROM public.ipo_events WHERE id=(p_data->>'event_id')::uuid AND user_id=u AND NOT reversed FOR UPDATE;
  IF NOT FOUND OR old_event.command IN ('company','applicant','demat','application','reverse') OR length(btrim(COALESCE(p_data->>'reason','')))=0 THEN RAISE EXCEPTION 'Choose a reversible event and explain the correction.'; END IF;
  IF EXISTS(SELECT 1 FROM public.ipo_events WHERE user_id=u AND id<>e AND NOT reversed AND command NOT IN ('company','applicant','demat','application','reverse') AND created_at>old_event.created_at) THEN RAISE EXCEPTION 'Reverse newer financial/activity events first, so dependent balances remain correct.'; END IF;
  IF d<old_event.event_date THEN RAISE EXCEPTION 'Correction date cannot precede the original event.'; END IF;
  FOR tx IN SELECT * FROM public.transactions WHERE ipo_event_id=old_event.id LOOP
   PERFORM public.ipo_post(e,CASE tx.transaction_kind WHEN 'income' THEN 'expense' WHEN 'expense' THEN 'income' ELSE 'transfer' END,tx.amount,d,CASE WHEN tx.transaction_kind='transfer' THEN tx.to_account_id ELSE tx.account_id END,CASE WHEN tx.transaction_kind='transfer' THEN tx.account_id ELSE NULL END,tx.investment_id,'IPO reversal: '||tx.name);
  END LOOP;
  IF old_event.details ? 'before_application' THEN
   SELECT * INTO app FROM jsonb_populate_record(NULL::public.ipo_applications,old_event.details->'before_application');
   UPDATE public.ipo_applications SET application_date=app.application_date,applicant_account_id=app.applicant_account_id,lots=app.lots,lot_size=app.lot_size,issue_price=app.issue_price,adjustment=app.adjustment,adjustment_reason=app.adjustment_reason,funding_method=app.funding_method,funding_account_id=app.funding_account_id,reference=app.reference,mandate=app.mandate,status=app.status,blocked=app.blocked,prepaid=app.prepaid,refund_due=app.refund_due,notes=app.notes WHERE id=app.id AND user_id=u;
  END IF;
  IF old_event.command='allot' THEN
   UPDATE public.ipo_allotments SET voided=true WHERE event_id=old_event.id RETURNING investment_id INTO inv;
   IF inv IS NOT NULL THEN UPDATE public.investments SET status='settled',final_amount=0,profit_amount=0,settled_on=d WHERE id=inv; END IF;
  ELSIF old_event.command='sale' THEN
   UPDATE public.ipo_sales SET voided=true WHERE event_id=old_event.id;
   before_inv:=old_event.details->'before_investment';
   UPDATE public.investments SET status=before_inv->>'status',final_amount=(before_inv->>'final_amount')::numeric,profit_amount=(before_inv->>'profit_amount')::numeric,settled_on=(before_inv->>'settled_on')::date,current_estimated_value=(before_inv->>'current_estimated_value')::numeric,value_updated_on=(before_inv->>'value_updated_on')::date WHERE id=(before_inv->>'id')::uuid AND user_id=u;
  END IF;
  UPDATE public.ipo_settlements SET voided=true WHERE event_id=old_event.id;
  UPDATE public.ipo_events SET reversed=true WHERE id=old_event.id;
  UPDATE public.ipo_events SET application_id=old_event.application_id,company_id=old_event.company_id,applicant_id=old_event.applicant_id,reversal_of=old_event.id,details=jsonb_build_object('reason',p_data->>'reason') WHERE id=e;
 ELSE RAISE EXCEPTION 'Unknown IPO operation.';
 END CASE;
 UPDATE public.ipo_events SET amount=CASE WHEN p_command IN ('application','edit_application') THEN amount ELSE n END,memo=NOT EXISTS(SELECT 1 FROM public.transactions WHERE ipo_event_id=e),details=details||jsonb_build_object('result_id',result_id) WHERE id=e;
 INSERT INTO public.audit_events(user_id,entity_table,entity_id,entity_name,action,details)
 SELECT u,'ipo_events',e,COALESCE(c.name,p.name,'IPO portfolio')||' · '||replace(p_command,'_',' '),'created',
  jsonb_build_object('current',jsonb_build_object('Event',replace(p_command,'_',' '),'Date',ev.event_date,
   'Amount (INR)',ev.amount,'Cash posted',NOT ev.memo,'Expected',ev.expected,'Details',ev.payload),
   'event_id',ev.id,'reversal_of',ev.reversal_of)
 FROM public.ipo_events ev LEFT JOIN public.ipo_companies c ON c.id=ev.company_id
 LEFT JOIN public.ipo_applicants p ON p.id=ev.applicant_id WHERE ev.id=e;
 DELETE FROM public.ipo_write_context WHERE transaction_id=txid_current();
 RETURN jsonb_build_object('event_id',e,'id',result_id);
END $$;
REVOKE ALL ON FUNCTION public.ipo_command(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ipo_command(uuid,text,jsonb) TO authenticated;
COMMIT;
