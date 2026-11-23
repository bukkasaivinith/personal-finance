BEGIN;

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
    'id', a.id, 'company_id', c.id, 'company', c.name,
    'application_date', a.application_date,
    'listing_date', COALESCE(NULLIF(c.dates->>'actual_listing', ''), NULLIF(c.dates->>'expected_listing', '')),
    'holder', p.name, 'demat', d.nickname, 'amount', a.amount, 'issue_price', a.issue_price,
    'lot_size', a.lot_size, 'lots', a.lots
  ) ORDER BY a.application_date DESC, a.created_at DESC, a.id), '[]'::jsonb)
  INTO applications
  FROM public.ipo_applications a
  JOIN public.ipo_companies c ON c.id = a.company_id
  JOIN public.ipo_applicant_accounts d ON d.id = a.applicant_account_id
  JOIN public.ipo_applicants p ON p.id = d.applicant_id
  WHERE a.user_id = owner_id AND NOT c.archived;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', d.id, 'holder', p.name, 'demat', d.nickname, 'designation', p.designation
  ) ORDER BY p.name, d.nickname, d.id), '[]'::jsonb)
  INTO demat_accounts
  FROM public.ipo_applicant_accounts d
  JOIN public.ipo_applicants p ON p.id = d.applicant_id
  WHERE d.user_id = owner_id AND NOT d.archived AND NOT p.archived;

  RETURN jsonb_build_object('applications', applications, 'demat_accounts', demat_accounts);
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
  ELSE
    company_id := (public.ipo_command(gen_random_uuid(), 'company', jsonb_build_object(
      'name', company_name, 'classification', classification,
      'issue_price', issue_price, 'lot_size', lot_size, 'minimum_lots', 1,
      'dates', jsonb_strip_nulls(jsonb_build_object('expected_listing', listing_date))
    ))->>'id')::uuid;
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

REVOKE ALL ON FUNCTION public.get_ipo_portfolio(), public.save_ipo_portfolio_application(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ipo_portfolio(), public.save_ipo_portfolio_application(uuid, jsonb)
  TO authenticated;

COMMIT;
