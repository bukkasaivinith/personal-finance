BEGIN;

CREATE OR REPLACE FUNCTION public.save_ipo_demat_account(
  p_holder_name text, p_nickname text, p_designation text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  owner_id uuid := public.ipo_require_owner();
  holder_name text := btrim(p_holder_name);
  account_nickname text := COALESCE(NULLIF(btrim(p_nickname), ''), 'Demat');
  holder_id uuid;
  demat_id uuid;
BEGIN
  IF NOT public.is_finance_workspace_owner() THEN
    RAISE EXCEPTION 'Demat accounts are available only to the workspace owner.';
  END IF;
  IF COALESCE(length(holder_name), 0) NOT BETWEEN 1 AND 80 OR length(account_nickname) > 80
     OR COALESCE(p_designation, '') NOT IN ('self', 'friend') THEN
    RAISE EXCEPTION 'Enter a valid account holder name, nickname and holder type.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ipo:' || owner_id::text, 0));
  SELECT d.id INTO demat_id
  FROM public.ipo_applicant_accounts d
  JOIN public.ipo_applicants p ON p.id = d.applicant_id AND p.user_id = d.user_id
  WHERE d.user_id = owner_id AND NOT d.archived AND NOT p.archived
    AND lower(p.name) = lower(holder_name) AND p.designation = p_designation
    AND lower(d.nickname) = lower(account_nickname)
  ORDER BY d.id LIMIT 1;
  IF demat_id IS NOT NULL THEN
    RETURN demat_id;
  END IF;

  SELECT p.id INTO holder_id
  FROM public.ipo_applicants p
  WHERE p.user_id = owner_id AND NOT p.archived
    AND lower(p.name) = lower(holder_name) AND p.designation = p_designation
  ORDER BY p.created_at, p.id LIMIT 1;
  IF holder_id IS NULL THEN
    holder_id := (public.ipo_command(gen_random_uuid(), 'applicant', jsonb_build_object(
      'name', holder_name, 'designation', p_designation
    ))->>'id')::uuid;
  END IF;

  RETURN (public.ipo_command(gen_random_uuid(), 'demat', jsonb_build_object(
    'applicant_id', holder_id, 'nickname', account_nickname
  ))->>'id')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_ipo_demat_account(p_demat_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  owner_id uuid := public.ipo_require_owner();
  demat public.ipo_applicant_accounts%ROWTYPE;
BEGIN
  IF NOT public.is_finance_workspace_owner() THEN
    RAISE EXCEPTION 'Demat accounts are available only to the workspace owner.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ipo:' || owner_id::text, 0));
  SELECT * INTO demat FROM public.ipo_applicant_accounts
  WHERE id = p_demat_id AND user_id = owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demat account unavailable.';
  END IF;
  IF NOT demat.archived THEN
    -- Preserve references and labels on earlier applications.
    PERFORM public.ipo_command(gen_random_uuid(), 'demat', to_jsonb(demat) || '{"archived":true}'::jsonb);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_ipo_portfolio_applications(
  p_request_id uuid, p_draft jsonb, p_allocations jsonb, p_total_lots integer
)
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  owner_id uuid := public.ipo_require_owner();
  allocation record;
  allocated_lots numeric;
  demat_count bigint;
  shares_per_lot numeric;
  issue_price numeric;
  lot_cost numeric;
  draft jsonb;
  application_ids uuid[] := '{}';
BEGIN
  IF NOT public.is_finance_workspace_owner() THEN
    RAISE EXCEPTION 'The IPO portfolio is available only to the workspace owner.';
  END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_draft) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_allocations) IS DISTINCT FROM 'array'
     OR COALESCE(p_total_lots, 0) < 1 THEN
    RAISE EXCEPTION 'Enter the total lots and assign them to demat accounts.';
  END IF;

  IF COALESCE(p_draft->>'issue_price', '') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
     OR COALESCE(p_draft->>'lot_size', '') !~ '^[0-9]{1,10}$' THEN
    RAISE EXCEPTION 'Enter a valid issue price and shares per lot.';
  END IF;
  shares_per_lot := (p_draft->>'lot_size')::numeric;
  issue_price := (p_draft->>'issue_price')::numeric;
  lot_cost := shares_per_lot * issue_price;
  IF lot_cost <= 0 OR p_total_lots * shares_per_lot > 2147483647 OR p_total_lots * lot_cost >= 1000000000000 THEN
    RAISE EXCEPTION 'Check the price, shares and total number of lots.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_allocations) AS items(entry)
    WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object'
      OR COALESCE(entry->>'lots', '') !~ '^[0-9]{1,10}$'
      OR COALESCE(entry->>'demat_id', '') = ''
  ) THEN
    RAISE EXCEPTION 'Choose a demat account and enter whole lots for each allocation.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_allocations) AS items(entry)
    WHERE (entry->>'lots')::numeric NOT BETWEEN 1 AND p_total_lots
  ) THEN
    RAISE EXCEPTION 'Each demat account needs at least one lot.';
  END IF;
  SELECT COALESCE(sum((entry->>'lots')::numeric), 0), count(DISTINCT (entry->>'demat_id')::uuid)
  INTO allocated_lots, demat_count
  FROM jsonb_array_elements(p_allocations) AS items(entry);
  IF demat_count <> jsonb_array_length(p_allocations) THEN
    RAISE EXCEPTION 'Choose each demat account only once.';
  END IF;
  IF allocated_lots <> p_total_lots THEN
    RAISE EXCEPTION 'The assigned lots must add up to the total entered.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ipo:' || owner_id::text, 0));
  FOR allocation IN
    SELECT entry, ordinal FROM jsonb_array_elements(p_allocations) WITH ORDINALITY AS items(entry, ordinal)
  LOOP
    draft := (p_draft - 'holder_name' - 'designation') || jsonb_build_object(
      'demat_id', allocation.entry->>'demat_id',
      'amount', round(lot_cost * (allocation.entry->>'lots')::integer, 2)::text
    );
    -- The first application also records the complete allocation for idempotent batch retries.
    IF allocation.ordinal = 1 THEN
      draft := draft || jsonb_build_object('portfolio_allocations', p_allocations, 'total_lots', p_total_lots);
    END IF;
    application_ids := array_append(application_ids, public.save_ipo_portfolio_application(
      md5(p_request_id::text || ':demat:' || allocation.ordinal)::uuid, draft
    ));
  END LOOP;
  RETURN application_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.save_ipo_demat_account(text, text, text), public.archive_ipo_demat_account(uuid),
  public.save_ipo_portfolio_applications(uuid, jsonb, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_ipo_demat_account(text, text, text), public.archive_ipo_demat_account(uuid),
  public.save_ipo_portfolio_applications(uuid, jsonb, jsonb, integer) TO authenticated;

COMMIT;
