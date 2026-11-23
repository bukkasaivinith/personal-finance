BEGIN;

-- Reuse the existing owner/session checks, workspace lock and ledger commands.
-- One database transaction saves the company and every submitted application.
CREATE FUNCTION public.ipo_create_with_applications(p_request_id uuid, p_company jsonb, p_applications jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
 company jsonb;
 application record;
 applicant_id uuid;
 demat_id uuid;
 applied numeric;
 lot_value numeric;
 lots integer;
BEGIN
 IF p_request_id IS NULL OR jsonb_typeof(p_company) IS DISTINCT FROM 'object'
    OR p_company ? 'id' OR jsonb_typeof(p_applications) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Provide a new company and its applications.';
 END IF;
 IF jsonb_array_length(p_applications) NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'Enter between 1 and 50 demat applications.';
 END IF;

 -- Store the whole submission on the first command to detect changed retry details.
 company := public.ipo_command(p_request_id, 'company',
    p_company || jsonb_build_object('submitted_applications', p_applications));
 lot_value := (p_company->>'issue_price')::numeric * (p_company->>'lot_size')::integer;

 FOR application IN
  SELECT draft, ordinal FROM jsonb_array_elements(p_applications) WITH ORDINALITY AS items(draft, ordinal)
 LOOP
  IF COALESCE(application.draft->>'amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN
   RAISE EXCEPTION 'Enter a valid applied amount in INR for application %.', application.ordinal;
  END IF;
  applied := (application.draft->>'amount')::numeric;
  IF mod(applied, lot_value) <> 0 OR applied / lot_value NOT BETWEEN 1 AND 2147483647
     OR applied / lot_value < (p_company->>'minimum_lots')::integer THEN
   RAISE EXCEPTION 'The applied amount for application % must match whole lots and meet the company minimum.', application.ordinal;
  END IF;
  lots := (applied / lot_value)::integer;

  demat_id := NULLIF(application.draft->>'applicant_account_id', '')::uuid;
  IF demat_id IS NULL THEN
   applicant_id := (public.ipo_command(
    md5(p_request_id::text || ':holder:' || application.ordinal)::uuid, 'applicant',
    jsonb_build_object('name', application.draft->>'holder_name', 'designation', application.draft->>'designation')
   )->>'id')::uuid;
   demat_id := (public.ipo_command(
    md5(p_request_id::text || ':demat:' || application.ordinal)::uuid, 'demat',
    jsonb_build_object('applicant_id', applicant_id, 'nickname', application.draft->>'nickname')
   )->>'id')::uuid;
  END IF;

  PERFORM public.ipo_command(
   md5(p_request_id::text || ':application:' || application.ordinal)::uuid, 'application',
   jsonb_build_object('company_id', company->>'id', 'applicant_account_id', demat_id,
    'date', application.draft->>'date', 'lots', lots, 'lot_size', p_company->'lot_size',
    'issue_price', p_company->'issue_price', 'funding_method', application.draft->>'funding_method',
    'account_id', application.draft->>'account_id')
  );
 END LOOP;

 RETURN company;
END $$;

REVOKE ALL ON FUNCTION public.ipo_create_with_applications(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ipo_create_with_applications(uuid, jsonb, jsonb) TO authenticated;

COMMIT;
