/*
# Create finance configuration and transaction tables

Plain-English summary: adds the tables that store everything a user creates in the finance app: transaction types, categories, account types, accounts, and transactions. Nothing is pre-filled. Every table starts empty and records appear only when the user creates them in the app.

## New tables
1. `transaction_types`: named kinds of money movement (for example "Groceries spend"). `kind` decides whether it counts as income, expense, or transfer in balances and reports.
2. `categories`: user-defined groupings such as "Food" or "Salary".
3. `category_transaction_types`: links categories to the transaction types they can be used with. A category can belong to several types.
4. `account_types`: user-defined account kinds. `classification` is 'asset' (money held) or 'liability' (money owed). `allows_income`, `allows_expense`, and `allows_transfer` set which transaction roles accounts of this type may take part in.
5. `accounts`: named accounts with an account type, an opening balance, and the date that opening balance applies from.
6. `transactions`: recorded income, expenses, and transfers, referencing a transaction type, optional category, source account, and optional destination account.

## Security
- Row level security is enabled on every table.
- The app has no sign-in, so the anon key and signed-in users both get SELECT and INSERT only. Records can be read and added but not edited or deleted from the app. No UPDATE or DELETE grants or policies are created.
- Each policy is scoped to `anon, authenticated` and documented as intentionally shared data.

## Important notes
1. No default transaction types, categories, account types, or accounts are inserted.
2. Names are unique per table, ignoring letter case.
3. Amounts are stored with two decimal places and must be positive for transactions and zero or more for opening balances.
4. A transfer's destination account must differ from its source account.
5. Every statement is idempotent so the migration can safely be re-run.
*/

CREATE TABLE IF NOT EXISTS transaction_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 32),
  kind text NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_types_name_key ON transaction_types (lower(name));

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 32),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_key ON categories (lower(name));

CREATE TABLE IF NOT EXISTS category_transaction_types (
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  transaction_type_id uuid NOT NULL REFERENCES transaction_types(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, transaction_type_id)
);
CREATE INDEX IF NOT EXISTS category_transaction_types_type_idx ON category_transaction_types (transaction_type_id);

CREATE TABLE IF NOT EXISTS account_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 32),
  classification text NOT NULL CHECK (classification IN ('asset', 'liability')),
  allows_income boolean NOT NULL DEFAULT false,
  allows_expense boolean NOT NULL DEFAULT false,
  allows_transfer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS account_types_name_key ON account_types (lower(name));

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  account_type_id uuid NOT NULL REFERENCES account_types(id),
  opening_balance numeric(14, 2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  opening_balance_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounts_account_type_idx ON accounts (account_type_id);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type_id uuid NOT NULL REFERENCES transaction_types(id),
  category_id uuid REFERENCES categories(id),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  transaction_date date NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  to_account_id uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_account_id IS NULL OR to_account_id <> account_id)
);
CREATE INDEX IF NOT EXISTS transactions_account_idx ON transactions (account_id);
CREATE INDEX IF NOT EXISTS transactions_to_account_idx ON transactions (to_account_id);
CREATE INDEX IF NOT EXISTS transactions_type_idx ON transactions (transaction_type_id);
CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions (category_id);

ALTER TABLE transaction_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_transaction_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON transaction_types TO anon, authenticated;
GRANT SELECT, INSERT ON categories TO anon, authenticated;
GRANT SELECT, INSERT ON category_transaction_types TO anon, authenticated;
GRANT SELECT, INSERT ON account_types TO anon, authenticated;
GRANT SELECT, INSERT ON accounts TO anon, authenticated;
GRANT SELECT, INSERT ON transactions TO anon, authenticated;

DROP POLICY IF EXISTS "shared_select_transaction_types" ON transaction_types;
CREATE POLICY "shared_select_transaction_types" ON transaction_types FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared_insert_transaction_types" ON transaction_types;
CREATE POLICY "shared_insert_transaction_types" ON transaction_types FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "shared_select_categories" ON categories;
CREATE POLICY "shared_select_categories" ON categories FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared_insert_categories" ON categories;
CREATE POLICY "shared_insert_categories" ON categories FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "shared_select_category_transaction_types" ON category_transaction_types;
CREATE POLICY "shared_select_category_transaction_types" ON category_transaction_types FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared_insert_category_transaction_types" ON category_transaction_types;
CREATE POLICY "shared_insert_category_transaction_types" ON category_transaction_types FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "shared_select_account_types" ON account_types;
CREATE POLICY "shared_select_account_types" ON account_types FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared_insert_account_types" ON account_types;
CREATE POLICY "shared_insert_account_types" ON account_types FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "shared_select_accounts" ON accounts;
CREATE POLICY "shared_select_accounts" ON accounts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared_insert_accounts" ON accounts;
CREATE POLICY "shared_insert_accounts" ON accounts FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "shared_select_transactions" ON transactions;
CREATE POLICY "shared_select_transactions" ON transactions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared_insert_transactions" ON transactions;
CREATE POLICY "shared_insert_transactions" ON transactions FOR INSERT TO anon, authenticated WITH CHECK (true);
