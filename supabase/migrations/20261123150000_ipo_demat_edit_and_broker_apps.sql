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
    'id', a.id, 'company_id', c.id, 'company', c.name, 'demat_account_id', d.id,
    'application_date', a.application_date,
    'listing_date', COALESCE(NULLIF(c.dates->>'actual_listing', ''), NULLIF(c.dates->>'expected_listing', '')),
    'holder', p.name, 'demat', d.nickname, 'broker', d.broker, 'amount', a.amount, 'issue_price', a.issue_price,
    'lot_size', a.lot_size, 'lots', a.lots
  ) ORDER BY a.application_date DESC, a.created_at DESC, a.id), '[]'::jsonb)
  INTO applications
  FROM public.ipo_applications a
  JOIN public.ipo_companies c ON c.id = a.company_id
  JOIN public.ipo_applicant_accounts d ON d.id = a.applicant_account_id
  JOIN public.ipo_applicants p ON p.id = d.applicant_id
  WHERE a.user_id = owner_id AND NOT c.archived;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', d.id, 'holder', p.name, 'demat', d.nickname, 'designation', p.designation, 'broker', d.broker
  ) ORDER BY p.name, d.nickname, d.broker, d.id), '[]'::jsonb)
  INTO demat_accounts
  FROM public.ipo_applicant_accounts d
  JOIN public.ipo_applicants p ON p.id = d.applicant_id
  WHERE d.user_id = owner_id AND NOT d.archived AND NOT p.archived;

  RETURN jsonb_build_object('applications', applications, 'demat_accounts', demat_accounts);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_ipo_demat_account(
  p_holder_name text, p_nickname text, p_designation text, p_broker text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  owner_id uuid := public.ipo_require_owner();
  new_holder_name text := btrim(p_holder_name);
  new_nickname text := COALESCE(NULLIF(btrim(p_nickname), ''), 'Demat');
  new_broker text := COALESCE(btrim(p_broker), '');
  holder_id uuid;
  demat_id uuid;
BEGIN
  IF NOT public.is_finance_workspace_owner() THEN
    RAISE EXCEPTION 'Demat accounts are available only to the workspace owner.';
  END IF;
  IF COALESCE(length(new_holder_name), 0) NOT BETWEEN 1 AND 80 OR length(new_nickname) > 80
     OR length(new_broker) > 80 OR COALESCE(p_designation, '') NOT IN ('self', 'friend') THEN
    RAISE EXCEPTION 'Enter a valid account holder, nickname and broker app.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ipo:' || owner_id::text, 0));
  SELECT d.id INTO demat_id
  FROM public.ipo_applicant_accounts d
  JOIN public.ipo_applicants p ON p.id = d.applicant_id AND p.user_id = d.user_id
  WHERE d.user_id = owner_id AND NOT d.archived AND NOT p.archived
    AND lower(p.name) = lower(new_holder_name) AND p.designation = p_designation
    AND lower(d.nickname) = lower(new_nickname) AND lower(d.broker) = lower(new_broker)
  ORDER BY d.id LIMIT 1;
  IF demat_id IS NOT NULL THEN
    RETURN demat_id;
  END IF;

  SELECT p.id INTO holder_id
  FROM public.ipo_applicants p
  WHERE p.user_id = owner_id AND NOT p.archived
    AND lower(p.name) = lower(new_holder_name) AND p.designation = p_designation
  ORDER BY p.created_at, p.id LIMIT 1;
  IF holder_id IS NULL THEN
    holder_id := (public.ipo_command(gen_random_uuid(), 'applicant', jsonb_build_object(
      'name', new_holder_name, 'designation', p_designation
    ))->>'id')::uuid;
  END IF;

  RETURN (public.ipo_command(gen_random_uuid(), 'demat', jsonb_build_object(
    'applicant_id', holder_id, 'nickname', new_nickname, 'broker', new_broker
  ))->>'id')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_ipo_demat_account(
  p_demat_id uuid, p_holder_name text, p_nickname text, p_designation text, p_broker text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  owner_id uuid := public.ipo_require_owner();
  new_holder_name text := btrim(p_holder_name);
  new_nickname text := COALESCE(NULLIF(btrim(p_nickname), ''), 'Demat');
  new_broker text := COALESCE(btrim(p_broker), '');
  demat public.ipo_applicant_accounts%ROWTYPE;
  holder public.ipo_applicants%ROWTYPE;
BEGIN
  IF NOT public.is_finance_workspace_owner() THEN
    RAISE EXCEPTION 'Demat accounts are available only to the workspace owner.';
  END IF;
  IF COALESCE(length(new_holder_name), 0) NOT BETWEEN 1 AND 80 OR length(new_nickname) > 80
     OR length(new_broker) > 80 OR COALESCE(p_designation, '') NOT IN ('self', 'friend') THEN
    RAISE EXCEPTION 'Enter a valid account holder, nickname and broker app.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ipo:' || owner_id::text, 0));
  SELECT * INTO demat FROM public.ipo_applicant_accounts
  WHERE id = p_demat_id AND user_id = owner_id AND NOT archived;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demat account unavailable.';
  END IF;
  SELECT * INTO holder FROM public.ipo_applicants
  WHERE id = demat.applicant_id AND user_id = owner_id AND NOT archived;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demat account holder unavailable.';
  END IF;

  IF (lower(holder.name) <> lower(new_holder_name) OR holder.designation <> p_designation)
     AND EXISTS (
       SELECT 1 FROM public.ipo_applicants other
       WHERE other.user_id = owner_id AND other.id <> holder.id AND NOT other.archived
         AND lower(other.name) = lower(new_holder_name) AND other.designation = p_designation
     ) THEN
    RAISE EXCEPTION 'An existing holder already uses that name and holder type.';
  END IF;

  IF (lower(demat.nickname) <> lower(new_nickname) OR lower(demat.broker) <> lower(new_broker)) AND EXISTS (
    SELECT 1 FROM public.ipo_applicant_accounts other
    WHERE other.user_id = owner_id AND other.applicant_id = holder.id
      AND other.id <> demat.id AND NOT other.archived AND lower(other.nickname) = lower(new_nickname)
      AND lower(other.broker) = lower(new_broker)
  ) THEN
    RAISE EXCEPTION 'This holder already has a demat account with that nickname and broker app.';
  END IF;

  -- Keep the existing holder and demat IDs, including all application and ledger links.
  IF holder.name <> new_holder_name OR holder.designation <> p_designation THEN
    PERFORM public.ipo_command(gen_random_uuid(), 'applicant', to_jsonb(holder) || jsonb_build_object(
      'name', new_holder_name, 'designation', p_designation
    ));
  END IF;
  IF demat.nickname <> new_nickname OR demat.broker <> new_broker THEN
    PERFORM public.ipo_command(gen_random_uuid(), 'demat', to_jsonb(demat) || jsonb_build_object(
      'nickname', new_nickname, 'broker', new_broker
    ));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ipo_portfolio(), public.save_ipo_demat_account(text, text, text, text),
  public.update_ipo_demat_account(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ipo_portfolio(), public.save_ipo_demat_account(text, text, text, text),
  public.update_ipo_demat_account(uuid, text, text, text, text) TO authenticated;

COMMIT;
