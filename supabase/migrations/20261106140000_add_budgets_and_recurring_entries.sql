/*
# Add monthly budgets and recurring transaction templates

Budgets set one monthly limit per category. Recurring entries store a reusable
transaction template. Recording one creates an ordinary transaction and moves
the entry's next date forward by its selected frequency.
*/

CREATE TABLE IF NOT EXISTS budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id)
);

CREATE TABLE IF NOT EXISTS recurring_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  transaction_type_id uuid NOT NULL REFERENCES transaction_types(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  next_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_account_id IS NULL OR to_account_id <> account_id)
);

CREATE INDEX IF NOT EXISTS recurring_entries_next_date_idx ON recurring_entries (next_date) WHERE is_active;

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON budgets, recurring_entries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON budgets, recurring_entries TO anon, authenticated;

DROP POLICY IF EXISTS shared_select_budgets ON budgets;
CREATE POLICY shared_select_budgets ON budgets FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS shared_insert_budgets ON budgets;
CREATE POLICY shared_insert_budgets ON budgets FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS shared_update_budgets ON budgets;
CREATE POLICY shared_update_budgets ON budgets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shared_delete_budgets ON budgets;
CREATE POLICY shared_delete_budgets ON budgets FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS shared_select_recurring_entries ON recurring_entries;
CREATE POLICY shared_select_recurring_entries ON recurring_entries FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS shared_insert_recurring_entries ON recurring_entries;
CREATE POLICY shared_insert_recurring_entries ON recurring_entries FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS shared_update_recurring_entries ON recurring_entries;
CREATE POLICY shared_update_recurring_entries ON recurring_entries FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shared_delete_recurring_entries ON recurring_entries;
CREATE POLICY shared_delete_recurring_entries ON recurring_entries FOR DELETE TO anon, authenticated USING (true);
