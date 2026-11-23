BEGIN;

CREATE TABLE public.savings_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  amount numeric NOT NULL CHECK (amount BETWEEN 0.01 AND 999999999999.99 AND amount = round(amount, 2)),
  saved_on date NOT NULL CHECK (isfinite(saved_on) AND saved_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date),
  storage_type text NOT NULL CHECK (storage_type IN ('bank', 'cash', 'other')),
  storage_details text NOT NULL DEFAULT '' CHECK (length(storage_details) <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX savings_entries_owner_date_idx ON public.savings_entries (user_id, saved_on DESC, id DESC);
ALTER TABLE public.savings_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.savings_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.savings_entries TO authenticated;

CREATE POLICY savings_entries_owner_only ON public.savings_entries
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_finance_user_active(user_id))
  WITH CHECK (user_id = auth.uid() AND public.is_finance_user_active(user_id));

CREATE FUNCTION public.get_savings_balances()
RETURNS TABLE (storage_type text, balance numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  SELECT entry.storage_type, sum(entry.amount) AS balance
  FROM public.savings_entries entry
  WHERE entry.user_id = auth.uid()
  GROUP BY entry.storage_type;
$$;

REVOKE ALL ON FUNCTION public.get_savings_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_savings_balances() TO authenticated;

COMMIT;
