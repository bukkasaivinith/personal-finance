BEGIN;

ALTER TABLE public.ipo_applications ADD COLUMN present_total_value numeric
  CHECK (present_total_value BETWEEN 0 AND 999999999999.99 AND present_total_value = round(present_total_value, 2));

CREATE OR REPLACE FUNCTION public.get_ipo_portfolio()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  owner_id uuid := public.ipo_require_owner();
  applications jsonb;
  demat_accounts jsonb;
BEGIN
  IF NOT public.is_finance_workspace_owner() THEN
    RAISE EXCEPTION 'The IPO portfolio is available only to the workspace owner.';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'company_id', c.id, 'company', c.name, 'demat_account_id', d.id,
    'application_date', a.application_date, 'classification', c.classification,
    'funding_account_id', a.funding_account_id, 'funding_account_name', bank.name, 'adjustment', a.adjustment,
    'allotment_date', COALESCE(NULLIF(c.dates->>'actual_allotment', ''), NULLIF(c.dates->>'expected_allotment', '')),
    'listing_date', COALESCE(NULLIF(c.dates->>'actual_listing', ''), NULLIF(c.dates->>'expected_listing', '')),
    'realized_profit_loss', COALESCE(sales.profit, a.realized_profit_loss),
    'invested_amount', COALESCE(allotment.cost, a.invested_amount), 'present_total_value', a.present_total_value,
    'holder', p.name, 'demat', d.nickname, 'broker', d.broker, 'amount', a.amount, 'issue_price', a.issue_price,
    'lot_size', a.lot_size, 'lots', a.lots, 'can_change', public.ipo_application_can_change(a)
  ) ORDER BY a.application_date DESC, a.created_at DESC, a.id), '[]'::jsonb)
  INTO applications
  FROM public.ipo_applications a
  JOIN public.ipo_companies c ON c.id = a.company_id
  JOIN public.ipo_applicant_accounts d ON d.id = a.applicant_account_id
  JOIN public.ipo_applicants p ON p.id = d.applicant_id
  JOIN public.accounts bank ON bank.id = a.funding_account_id AND bank.user_id = a.user_id
  LEFT JOIN public.ipo_allotments allotment
    ON allotment.application_id = a.id AND allotment.user_id = a.user_id AND NOT allotment.voided
  LEFT JOIN LATERAL (
    SELECT sum(s.profit) AS profit FROM public.ipo_sales s
    WHERE s.application_id = a.id AND s.user_id = a.user_id AND NOT s.voided
  ) sales ON true
  WHERE a.user_id = owner_id AND NOT c.archived
    AND NOT EXISTS (
      SELECT 1 FROM public.ipo_events e
      WHERE e.user_id = owner_id AND e.application_id = a.id AND e.command = 'delete_application'
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', d.id, 'holder', p.name, 'demat', d.nickname, 'designation', p.designation, 'broker', d.broker
  ) ORDER BY p.name, d.nickname, d.broker, d.id), '[]'::jsonb)
  INTO demat_accounts
  FROM public.ipo_applicant_accounts d
  JOIN public.ipo_applicants p ON p.id = d.applicant_id
  WHERE d.user_id = owner_id AND NOT d.archived AND NOT p.archived;

  RETURN jsonb_build_object('applications', applications, 'demat_accounts', demat_accounts, 'allotment_date_supported', true);
END;
$$;

CREATE FUNCTION public.save_ipo_portfolio_result(p_application_id uuid, p_profit_loss numeric, p_present_total_value numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  owner_id uuid := public.ipo_require_owner();
  application public.ipo_applications%ROWTYPE;
  company_name text;
  result_event_id uuid;
BEGIN
  IF NOT public.is_finance_workspace_owner() THEN
    RAISE EXCEPTION 'The IPO portfolio is available only to the workspace owner.';
  END IF;
  IF p_profit_loss IS NOT NULL AND (
    p_profit_loss NOT BETWEEN -999999999999.99 AND 999999999999.99 OR p_profit_loss <> round(p_profit_loss, 2)
  ) THEN
    RAISE EXCEPTION 'Enter a valid result with up to two decimal places.';
  END IF;
  IF p_present_total_value IS NOT NULL AND (
    p_present_total_value NOT BETWEEN 0 AND 999999999999.99 OR p_present_total_value <> round(p_present_total_value, 2)
  ) THEN
    RAISE EXCEPTION 'Enter a present total value of zero or more with up to two decimal places.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ipo:' || owner_id::text, 0));
  SELECT * INTO application FROM public.ipo_applications WHERE id = p_application_id AND user_id = owner_id FOR UPDATE;
  IF NOT FOUND OR NOT public.ipo_application_can_change(application) THEN
    RAISE EXCEPTION 'This IPO application is unavailable or has linked activity.';
  END IF;
  SELECT name INTO company_name FROM public.ipo_companies
  WHERE id = application.company_id AND user_id = owner_id AND NOT archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'This IPO company is unavailable.'; END IF;
  IF application.realized_profit_loss IS NOT DISTINCT FROM p_profit_loss
     AND application.present_total_value IS NOT DISTINCT FROM p_present_total_value THEN RETURN; END IF;

  UPDATE public.ipo_applications SET realized_profit_loss = p_profit_loss, present_total_value = p_present_total_value
  WHERE id = application.id AND user_id = owner_id;

  INSERT INTO public.ipo_events (user_id, request_id, command, payload, application_id, company_id, event_date)
  VALUES (owner_id, gen_random_uuid(), 'record_result', jsonb_build_object('profit_loss', p_profit_loss, 'present_total_value', p_present_total_value),
    application.id, application.company_id, (now() AT TIME ZONE 'Asia/Kolkata')::date)
  RETURNING id INTO result_event_id;

  INSERT INTO public.audit_events (user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (owner_id, 'ipo_events', result_event_id, company_name || ' · IPO result', 'updated',
    jsonb_build_object('previous', jsonb_build_object('Profit / loss (INR)', application.realized_profit_loss, 'Present total value (INR)', application.present_total_value),
      'current', jsonb_build_object('Profit / loss (INR)', p_profit_loss, 'Present total value (INR)', p_present_total_value)));
END;
$$;

REVOKE ALL ON FUNCTION public.save_ipo_portfolio_result(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_ipo_portfolio_result(uuid, numeric, numeric) TO authenticated;

COMMIT;
