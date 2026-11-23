BEGIN;

-- The portfolio reuses the company allotment dates for all demat applications of one IPO.

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
    'holder', p.name, 'demat', d.nickname, 'broker', d.broker, 'amount', a.amount, 'issue_price', a.issue_price,
    'lot_size', a.lot_size, 'lots', a.lots, 'can_change', public.ipo_application_can_change(a)
  ) ORDER BY a.application_date DESC, a.created_at DESC, a.id), '[]'::jsonb)
  INTO applications
  FROM public.ipo_applications a
  JOIN public.ipo_companies c ON c.id = a.company_id
  JOIN public.ipo_applicant_accounts d ON d.id = a.applicant_account_id
  JOIN public.ipo_applicants p ON p.id = d.applicant_id
  JOIN public.accounts bank ON bank.id = a.funding_account_id AND bank.user_id = a.user_id
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

CREATE OR REPLACE FUNCTION public.save_ipo_portfolio_application(p_request_id uuid, p_draft jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  owner_id uuid := public.ipo_require_owner();
  company_name text := btrim(p_draft->>'company_name');
  classification text := p_draft->>'classification';
  holder_name text := btrim(p_draft->>'holder_name');
  holder_kind text := p_draft->>'designation';
  bank_id uuid := NULLIF(p_draft->>'account_id', '')::uuid;
  demat_id uuid := NULLIF(p_draft->>'demat_id', '')::uuid;
  application_date date := NULLIF(p_draft->>'application_date', '')::date;
  allotment_date date := NULLIF(p_draft->>'allotment_date', '')::date;
  saved_allotment date;
  listing_date date := NULLIF(p_draft->>'listing_date', '')::date;
  issue_price numeric;
  amount numeric;
  lot_size integer;
  lot_count numeric;
  previous public.ipo_events%ROWTYPE;
  company public.ipo_companies%ROWTYPE;
  holder_id uuid;
  company_id uuid;
BEGIN
  IF NOT public.is_finance_workspace_owner() THEN
    RAISE EXCEPTION 'The IPO portfolio is available only to the workspace owner.';
  END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_draft) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Provide the IPO application details.';
  END IF;
  IF COALESCE(length(company_name), 0) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Enter the company name.';
  END IF;
  IF COALESCE(classification, '') NOT IN ('Mainboard', 'SME') THEN
    RAISE EXCEPTION 'Choose an IPO classification.';
  END IF;
  IF application_date IS NULL OR application_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Choose an application date on or before today.';
  END IF;
  IF listing_date < application_date THEN
    RAISE EXCEPTION 'The listing date must be on or after the application date.';
  END IF;
  IF bank_id IS NULL THEN
    RAISE EXCEPTION 'Choose a funding account.';
  END IF;
  IF COALESCE(p_draft->>'issue_price', '') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
     OR COALESCE(p_draft->>'amount', '') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
     OR COALESCE(p_draft->>'lot_size', '') !~ '^[0-9]{1,10}$' THEN
    RAISE EXCEPTION 'Enter a valid price, number of shares and amount applied.';
  END IF;
  issue_price := (p_draft->>'issue_price')::numeric;
  amount := (p_draft->>'amount')::numeric;
  IF issue_price <= 0 OR amount <= 0 OR (p_draft->>'lot_size')::numeric NOT BETWEEN 1 AND 2147483647 THEN
    RAISE EXCEPTION 'Price, shares per lot and amount applied must be positive.';
  END IF;
  lot_size := (p_draft->>'lot_size')::integer;
  lot_count := amount / (issue_price * lot_size);
  IF lot_count < 1 OR lot_count * lot_size > 2147483647 OR mod(amount, issue_price * lot_size) <> 0 THEN
    RAISE EXCEPTION 'The amount applied must match a whole number of lots at the entered price.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ipo:' || owner_id::text, 0));
  SELECT * INTO previous FROM public.ipo_events WHERE user_id = owner_id AND request_id = p_request_id;
  IF FOUND THEN
    IF previous.command <> 'application' OR (previous.payload->'portfolio_draft') IS DISTINCT FROM p_draft THEN
      RAISE EXCEPTION 'This request was already used for different details.';
    END IF;
    RETURN previous.application_id;
  END IF;

  IF demat_id IS NULL THEN
    IF COALESCE(length(holder_name), 0) NOT BETWEEN 1 AND 80 OR COALESCE(holder_kind, '') NOT IN ('self', 'friend') THEN
      RAISE EXCEPTION 'Choose or enter the demat account holder.';
    END IF;
    SELECT d.id INTO demat_id
    FROM public.ipo_applicant_accounts d
    JOIN public.ipo_applicants p ON p.id = d.applicant_id
    WHERE d.user_id = owner_id AND NOT d.archived AND NOT p.archived
      AND p.designation = holder_kind AND lower(p.name) = lower(holder_name)
      AND d.nickname = 'Demat'
    ORDER BY d.id LIMIT 1;
    IF demat_id IS NULL THEN
      holder_id := (public.ipo_command(gen_random_uuid(), 'applicant', jsonb_build_object(
        'name', holder_name, 'designation', holder_kind
      ))->>'id')::uuid;
      demat_id := (public.ipo_command(gen_random_uuid(), 'demat', jsonb_build_object(
        'applicant_id', holder_id, 'nickname', 'Demat'
      ))->>'id')::uuid;
    END IF;
  END IF;

  SELECT p.designation INTO holder_kind
  FROM public.ipo_applicant_accounts d
  JOIN public.ipo_applicants p ON p.id = d.applicant_id
  WHERE d.id = demat_id AND d.user_id = owner_id AND NOT d.archived AND NOT p.archived;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an active demat account.';
  END IF;

  -- Multiple demat applications to the same listing share the company record.
  SELECT * INTO company FROM public.ipo_companies c
  WHERE c.user_id = owner_id AND NOT c.archived AND lower(c.name) = lower(company_name)
    AND COALESCE(NULLIF(c.dates->>'actual_listing', ''), NULLIF(c.dates->>'expected_listing', ''))
      IS NOT DISTINCT FROM listing_date::text
  ORDER BY c.created_at, c.id LIMIT 1;
  IF FOUND THEN
    IF company.issue_price <> issue_price OR company.lot_size <> lot_size OR company.classification <> classification THEN
      RAISE EXCEPTION 'This listing already has a different classification, issue price or lot size.';
    END IF;
    company_id := company.id;
    saved_allotment := COALESCE(NULLIF(company.dates->>'actual_allotment', ''), NULLIF(company.dates->>'expected_allotment', ''))::date;
    IF allotment_date IS NOT NULL AND saved_allotment IS NOT NULL AND allotment_date <> saved_allotment THEN
      RAISE EXCEPTION 'This IPO already has a different allotment date. Edit an existing application to change it.';
    END IF;
    allotment_date := COALESCE(allotment_date, saved_allotment);
  END IF;

  IF allotment_date IS NOT NULL AND (
    NOT isfinite(allotment_date) OR allotment_date < application_date OR allotment_date > listing_date
  ) THEN
    RAISE EXCEPTION 'The allotment date must be on or after the application date and on or before the listing date.';
  END IF;
  IF allotment_date IS DISTINCT FROM saved_allotment AND EXISTS (
    SELECT 1 FROM public.ipo_applications a
    WHERE a.user_id = owner_id AND a.company_id = company.id AND a.application_date > allotment_date
      AND NOT EXISTS (
        SELECT 1 FROM public.ipo_events e WHERE e.user_id = owner_id AND e.application_id = a.id AND e.command = 'delete_application'
      )
  ) THEN
    RAISE EXCEPTION 'The allotment date cannot precede another application for this IPO.';
  END IF;

  IF company_id IS NULL THEN
    company_id := (public.ipo_command(gen_random_uuid(), 'company', jsonb_build_object(
      'name', company_name, 'classification', classification,
      'issue_price', issue_price, 'lot_size', lot_size, 'minimum_lots', 1,
      'dates', jsonb_strip_nulls(jsonb_build_object('expected_listing', listing_date, 'expected_allotment', allotment_date))
    ))->>'id')::uuid;
  ELSIF allotment_date IS DISTINCT FROM saved_allotment THEN
    PERFORM public.ipo_command(gen_random_uuid(), 'company', to_jsonb(company) || jsonb_build_object(
      'dates', jsonb_build_object('expected_allotment', allotment_date)
    ));
  END IF;

  -- The application command records a memo. It creates no debit or investment position.
  RETURN (public.ipo_command(p_request_id, 'application', jsonb_build_object(
    'company_id', company_id, 'applicant_account_id', demat_id, 'date', application_date,
    'lots', lot_count::integer, 'lot_size', lot_size, 'issue_price', issue_price,
    'funding_method', CASE holder_kind WHEN 'self' THEN 'direct' ELSE 'friend' END,
    'account_id', bank_id, 'portfolio_draft', p_draft
  ))->>'id')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_ipo_portfolio_application(
  p_application_id uuid, p_request_id uuid, p_draft jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  owner_id uuid := public.ipo_require_owner();
  app public.ipo_applications%ROWTYPE;
  company public.ipo_companies%ROWTYPE;
  previous public.ipo_events%ROWTYPE;
  edited public.ipo_applications%ROWTYPE;
  holder_kind text;
  new_holder_id uuid;
  new_name text := btrim(p_draft->>'company_name');
  new_classification text := p_draft->>'classification';
  new_date date := NULLIF(p_draft->>'application_date', '')::date;
  new_allotment date := NULLIF(p_draft->>'allotment_date', '')::date;
  new_listing date := NULLIF(p_draft->>'listing_date', '')::date;
  demat_id uuid := NULLIF(p_draft->>'demat_id', '')::uuid;
  bank_id uuid := NULLIF(p_draft->>'account_id', '')::uuid;
  lot_count numeric;
  shares numeric;
  price numeric;
  new_company_price numeric;
  new_company_shares integer;
  total numeric;
  prior_listing text;
  prior_allotment date;
  company_dates jsonb;
  edit_event_id uuid;
BEGIN
  IF NOT public.is_finance_workspace_owner() THEN
    RAISE EXCEPTION 'The IPO portfolio is available only to the workspace owner.';
  END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_draft) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Provide the edited application details.';
  END IF;
  IF COALESCE(length(new_name), 0) NOT BETWEEN 1 AND 120 OR COALESCE(new_classification, '') NOT IN ('Mainboard', 'SME') THEN
    RAISE EXCEPTION 'Enter the company name and classification.';
  END IF;
  IF new_date IS NULL OR new_date > (now() AT TIME ZONE 'Asia/Kolkata')::date OR new_listing < new_date THEN
    RAISE EXCEPTION 'Choose a valid application date and a listing date on or after it.';
  END IF;
  IF bank_id IS NULL OR demat_id IS NULL THEN
    RAISE EXCEPTION 'Choose the funding and demat accounts.';
  END IF;
  IF COALESCE(p_draft->>'issue_price', '') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
     OR COALESCE(p_draft->>'lot_size', '') !~ '^[0-9]{1,10}$'
     OR COALESCE(p_draft->>'lots', '') !~ '^[0-9]{1,10}$' THEN
    RAISE EXCEPTION 'Enter a valid issue price, shares per lot and number of lots.';
  END IF;
  lot_count := (p_draft->>'lots')::numeric;
  shares := (p_draft->>'lot_size')::numeric;
  price := (p_draft->>'issue_price')::numeric;
  IF price <= 0 OR shares < 1 OR lot_count < 1 OR shares * lot_count > 2147483647 THEN
    RAISE EXCEPTION 'Check the issue price and total number of shares.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ipo:' || owner_id::text, 0));
  SELECT * INTO previous FROM public.ipo_events WHERE user_id = owner_id AND request_id = p_request_id;
  IF FOUND THEN
    IF previous.command <> 'edit_application' OR previous.application_id IS DISTINCT FROM p_application_id
       OR (previous.payload->'portfolio_edit') IS DISTINCT FROM p_draft THEN
      RAISE EXCEPTION 'This request was already used for different details.';
    END IF;
    RETURN;
  END IF;

  SELECT * INTO app FROM public.ipo_applications WHERE id = p_application_id AND user_id = owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'IPO application unavailable.'; END IF;
  IF NOT public.ipo_application_can_change(app) THEN
    RAISE EXCEPTION 'This application has linked activity or was deleted.';
  END IF;
  SELECT * INTO company FROM public.ipo_companies WHERE id = app.company_id AND user_id = owner_id AND NOT archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'IPO company unavailable.'; END IF;
  total := lot_count * shares * price + app.adjustment;
  IF total <= 0 OR total >= 1000000000000 THEN
    RAISE EXCEPTION 'The edited application amount is outside the supported range.';
  END IF;

  SELECT p.designation, p.id INTO holder_kind, new_holder_id
  FROM public.ipo_applicant_accounts d
  JOIN public.ipo_applicants p ON p.id = d.applicant_id AND p.user_id = d.user_id
  WHERE d.id = demat_id AND d.user_id = owner_id
    AND (d.id = app.applicant_account_id OR (NOT d.archived AND NOT p.archived));
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active demat account.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id = bank_id AND a.user_id = owner_id
      AND (a.id = app.funding_account_id OR (
        a.is_active AND a.deleted_at IS NULL AND NOT a.is_liability
        AND NOT EXISTS (SELECT 1 FROM public.ipo_cash_accounts custody WHERE custody.account_id = a.id)
      ))
  ) THEN
    RAISE EXCEPTION 'Choose an active bank or cash account.';
  END IF;
  IF lot_count < company.minimum_lots THEN
    RAISE EXCEPTION 'The lot count is below the minimum for this IPO.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ipo_events e WHERE e.user_id = owner_id AND e.application_id = app.id
      AND NOT e.reversed AND e.command NOT IN ('application', 'edit_application', 'reverse') AND e.event_date < new_date
  ) THEN
    RAISE EXCEPTION 'The application date cannot be after its recorded activity.';
  END IF;

  prior_listing := COALESCE(NULLIF(company.dates->>'actual_listing', ''), NULLIF(company.dates->>'expected_listing', ''));
  prior_allotment := COALESCE(NULLIF(company.dates->>'actual_allotment', ''), NULLIF(company.dates->>'expected_allotment', ''))::date;
  IF NOT (p_draft ? 'allotment_date') THEN
    new_allotment := prior_allotment;
  END IF;
  IF new_allotment IS NOT NULL AND (
    NOT isfinite(new_allotment) OR new_allotment < new_date OR new_allotment > new_listing
  ) THEN
    RAISE EXCEPTION 'The allotment date must be on or after the application date and on or before the listing date.';
  END IF;

  company_dates := company.dates;
  IF prior_allotment IS DISTINCT FROM new_allotment THEN
    IF EXISTS (
      SELECT 1 FROM public.ipo_applications other
      WHERE other.user_id = owner_id AND other.company_id = company.id AND other.id <> app.id
        AND other.application_date > new_allotment AND NOT EXISTS (
          SELECT 1 FROM public.ipo_events e WHERE e.user_id = owner_id AND e.application_id = other.id AND e.command = 'delete_application'
        )
    ) THEN
      RAISE EXCEPTION 'The allotment date cannot precede another application for this IPO.';
    END IF;
    IF NULLIF(company.dates->>'actual_allotment', '') IS NOT NULL AND new_allotment <= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
      company_dates := company_dates || jsonb_build_object('actual_allotment', new_allotment);
    ELSE
      company_dates := company_dates || jsonb_build_object('actual_allotment', NULL::date, 'expected_allotment', new_allotment);
    END IF;
  END IF;
  IF prior_listing IS DISTINCT FROM new_listing::text THEN
    IF EXISTS (
      SELECT 1 FROM public.ipo_applications other
      WHERE other.user_id = owner_id AND other.company_id = company.id AND other.id <> app.id
        AND other.application_date > new_listing AND NOT EXISTS (
          SELECT 1 FROM public.ipo_events e WHERE e.user_id = owner_id AND e.application_id = other.id AND e.command = 'delete_application'
        )
    ) THEN
      RAISE EXCEPTION 'The listing date cannot precede another application for this listing.';
    END IF;
    IF NULLIF(company.dates->>'actual_listing', '') IS NOT NULL AND new_listing <= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
      company_dates := company_dates || jsonb_build_object('actual_listing', new_listing);
    ELSE
      company_dates := company_dates || jsonb_build_object('actual_listing', NULL::date, 'expected_listing', new_listing);
    END IF;
  END IF;
  IF (lower(company.name) <> lower(new_name) OR prior_listing IS DISTINCT FROM new_listing::text)
     AND EXISTS (
       SELECT 1 FROM public.ipo_companies other
       WHERE other.user_id = owner_id AND other.id <> company.id AND NOT other.archived
         AND lower(other.name) = lower(new_name)
         AND COALESCE(NULLIF(other.dates->>'actual_listing', ''), NULLIF(other.dates->>'expected_listing', ''))
           IS NOT DISTINCT FROM new_listing::text
     ) THEN
    RAISE EXCEPTION 'Another IPO already uses this company name and listing date.';
  END IF;

  new_company_price := company.issue_price;
  new_company_shares := company.lot_size;
  IF NOT EXISTS (
    SELECT 1 FROM public.ipo_applications other
    WHERE other.user_id = owner_id AND other.company_id = company.id AND other.id <> app.id
      AND NOT EXISTS (
        SELECT 1 FROM public.ipo_events e WHERE e.user_id = owner_id AND e.application_id = other.id AND e.command = 'delete_application'
      )
  ) THEN
    new_company_price := price;
    new_company_shares := shares::integer;
  END IF;

  UPDATE public.ipo_applications
  SET application_date = new_date, lots = lot_count::integer, lot_size = shares::integer, issue_price = price,
    applicant_account_id = demat_id, funding_account_id = bank_id,
    funding_method = CASE WHEN demat_id = app.applicant_account_id THEN app.funding_method
                          WHEN holder_kind = 'self' THEN 'direct' ELSE 'friend' END
  WHERE id = app.id AND user_id = owner_id
  RETURNING * INTO edited;
  INSERT INTO public.ipo_events(user_id, request_id, command, payload, application_id, company_id, applicant_id, event_date, amount, account_id, details)
  VALUES (owner_id, p_request_id, 'edit_application', jsonb_build_object('portfolio_edit', p_draft),
    app.id, company.id, new_holder_id, new_date, edited.amount, bank_id,
    jsonb_build_object('before_application', to_jsonb(app), 'result_id', app.id))
  RETURNING id INTO edit_event_id;
  INSERT INTO public.audit_events(user_id, entity_table, entity_id, entity_name, action, details)
  VALUES (owner_id, 'ipo_events', edit_event_id, new_name || ' · application', 'updated', jsonb_build_object(
    'previous', jsonb_build_object('Applied on', app.application_date, 'Allotment date', prior_allotment, 'Lots', app.lots, 'Amount (INR)', app.amount),
    'current', jsonb_build_object('Applied on', edited.application_date, 'Allotment date', new_allotment, 'Lots', edited.lots, 'Amount (INR)', edited.amount),
    'application_id', app.id
  ));
  IF company.name <> new_name OR company.classification <> new_classification OR company.dates <> company_dates
     OR company.issue_price <> new_company_price OR company.lot_size <> new_company_shares THEN
    PERFORM public.ipo_command(gen_random_uuid(), 'company', to_jsonb(company) || jsonb_build_object(
      'name', new_name, 'classification', new_classification, 'dates', company_dates,
      'issue_price', new_company_price, 'lot_size', new_company_shares
    ));
  END IF;
END;
$$;

COMMIT;
