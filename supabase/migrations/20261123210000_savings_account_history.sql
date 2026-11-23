BEGIN;

CREATE TABLE public.savings_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80 AND lower(btrim(name)) NOT IN ('bank', 'cash', 'other')),
  UNIQUE (id, user_id)
);

CREATE UNIQUE INDEX savings_locations_owner_name_idx ON public.savings_locations (user_id, lower(btrim(name)));
ALTER TABLE public.savings_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.savings_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.savings_locations TO authenticated;
CREATE POLICY savings_locations_owner_only ON public.savings_locations
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_finance_user_active(user_id))
  WITH CHECK (user_id = auth.uid() AND public.is_finance_user_active(user_id));

ALTER TABLE public.savings_entries
  ADD CONSTRAINT savings_entries_id_user_id_key UNIQUE (id, user_id),
  ADD COLUMN location_id uuid CHECK (location_id IS NULL OR storage_type = 'other'),
  ADD CONSTRAINT savings_entries_location_fk FOREIGN KEY (location_id, user_id)
    REFERENCES public.savings_locations(id, user_id) ON DELETE SET NULL (location_id);

CREATE INDEX savings_entries_location_idx ON public.savings_entries(location_id, user_id) WHERE location_id IS NOT NULL;

CREATE TABLE public.savings_movements (
  id uuid PRIMARY KEY,
  savings_entry_id uuid NOT NULL,
  user_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('deposit', 'withdrawal')),
  amount numeric NOT NULL CHECK (amount BETWEEN 0.01 AND 999999999999.99 AND amount = round(amount, 2)),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 140),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (savings_entry_id, user_id) REFERENCES public.savings_entries(id, user_id) ON DELETE CASCADE
);

CREATE INDEX savings_movements_entry_recent_idx
  ON public.savings_movements (savings_entry_id, recorded_at DESC, id DESC);
ALTER TABLE public.savings_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.savings_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.savings_movements TO authenticated;

CREATE POLICY savings_movements_owner_read ON public.savings_movements
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_finance_user_active(user_id));

CREATE VIEW public.savings_accounts WITH (security_invoker = true) AS
SELECT entry.id, entry.user_id, entry.name, entry.amount, entry.saved_on, entry.storage_type, entry.storage_details, entry.location_id,
  entry.amount + COALESCE(activity.change, 0) AS balance,
  COALESCE(activity.last_recorded, entry.created_at) AS last_activity_at
FROM public.savings_entries entry
LEFT JOIN LATERAL (
  SELECT sum(CASE movement.direction WHEN 'deposit' THEN movement.amount ELSE -movement.amount END) AS change,
    max(movement.recorded_at) AS last_recorded
  FROM public.savings_movements movement
  WHERE movement.savings_entry_id = entry.id AND movement.user_id = entry.user_id
) activity ON true;

REVOKE ALL ON TABLE public.savings_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.savings_accounts TO authenticated;

CREATE OR REPLACE FUNCTION public.get_savings_balances()
RETURNS TABLE (storage_type text, balance numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  SELECT account.storage_type, sum(account.balance) AS balance
  FROM public.savings_accounts account
  WHERE account.user_id = auth.uid()
  GROUP BY account.storage_type;
$$;

CREATE FUNCTION public.check_savings_opening_amount()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.amount IS DISTINCT FROM OLD.amount AND EXISTS (
    SELECT 1
    FROM (
      SELECT sum(CASE movement.direction WHEN 'deposit' THEN movement.amount ELSE -movement.amount END)
        OVER (ORDER BY movement.recorded_at, movement.id ROWS UNBOUNDED PRECEDING) AS change
      FROM public.savings_movements movement
      WHERE movement.savings_entry_id = OLD.id AND movement.user_id = OLD.user_id
    ) history
    WHERE NEW.amount + history.change < 0
  ) THEN
    RAISE EXCEPTION 'That opening amount would make a past savings balance negative.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER savings_opening_amount_check BEFORE UPDATE OF amount ON public.savings_entries
  FOR EACH ROW EXECUTE FUNCTION public.check_savings_opening_amount();

CREATE FUNCTION public.record_savings_movement(
  p_savings_entry_id uuid, p_request_id uuid, p_direction text, p_amount numeric, p_note text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  account public.savings_accounts%ROWTYPE;
  movement public.savings_movements%ROWTYPE;
  clean_note text := btrim(COALESCE(p_note, ''));
BEGIN
  IF caller IS NULL OR public.is_finance_user_active(caller) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sign in again to update your savings.';
  END IF;
  IF p_request_id IS NULL OR p_direction IS NULL OR p_direction NOT IN ('deposit', 'withdrawal') THEN
    RAISE EXCEPTION 'Choose whether to add or withdraw savings.';
  END IF;
  IF p_amount IS NULL OR p_amount NOT BETWEEN 0.01 AND 999999999999.99 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Enter a positive amount with up to two decimal places.';
  END IF;
  IF length(clean_note) > 140 THEN RAISE EXCEPTION 'Keep the note to 140 characters or fewer.'; END IF;

  -- Serialize balance checks and movements for this account. Account edits and deletes also take this row lock.
  PERFORM 1 FROM public.savings_entries WHERE id = p_savings_entry_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This savings account is no longer available.'; END IF;
  SELECT * INTO STRICT account FROM public.savings_accounts WHERE id = p_savings_entry_id AND user_id = caller;

  SELECT * INTO movement FROM public.savings_movements WHERE id = p_request_id AND user_id = caller;
  IF FOUND THEN
    IF movement.savings_entry_id <> p_savings_entry_id OR movement.direction <> p_direction
       OR movement.amount <> p_amount OR movement.note <> clean_note THEN
      RAISE EXCEPTION 'This request was already used for a different savings entry.';
    END IF;
  ELSE
    IF p_direction = 'withdrawal' AND p_amount > account.balance THEN
      RAISE EXCEPTION 'The withdrawal exceeds the available savings balance.';
    END IF;
    INSERT INTO public.savings_movements (id, savings_entry_id, user_id, direction, amount, note, recorded_at)
    VALUES (p_request_id, p_savings_entry_id, caller, p_direction, p_amount, clean_note,
      GREATEST(clock_timestamp(), account.last_activity_at + interval '1 microsecond'))
    RETURNING * INTO movement;
    SELECT * INTO STRICT account FROM public.savings_accounts WHERE id = p_savings_entry_id AND user_id = caller;
  END IF;

  RETURN jsonb_build_object('account', to_jsonb(account) - 'user_id', 'movement', to_jsonb(movement) - 'user_id');
END;
$$;

REVOKE ALL ON FUNCTION public.record_savings_movement(uuid, uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_savings_movement(uuid, uuid, text, numeric, text) TO authenticated;

COMMIT;
