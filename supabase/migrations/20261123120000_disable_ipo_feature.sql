BEGIN;

-- Keep historical records, posted transactions and the finance compatibility read.
-- Disable public app access to the retired dashboard and its write commands.
SET LOCAL search_path = pg_catalog;

DO $$
DECLARE
  signature text;
  target regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.ipo_dashboard()',
    'public.ipo_command(uuid,text,jsonb)',
    'public.ipo_create_with_applications(uuid,jsonb,jsonb)'
  ] LOOP
    target := to_regprocedure(signature);
    IF target IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', target);
    END IF;
  END LOOP;
END;
$$;

COMMIT;
