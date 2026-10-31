/*
# Remove account types, add soft deletion and historical snapshots

Plain-English summary
Account types are removed. Accounts are now created directly, with a simple "is a credit or loan account" flag that still drives balance direction. Transaction types, categories and accounts can be deactivated or soft-deleted without losing any history. Each transaction records the names of the type, category and accounts as they were when it was saved, so renames and deletions never change past records.

1. Changed tables
- transaction_types: adds is_active, deleted_at, updated_at.
- categories: adds is_active, deleted_at, updated_at, and an optional parent_id.
- accounts: adds description, is_liability, is_active, deleted_at, updated_at. The account_type_id column is removed after its classification is copied into is_liability.
- transactions: adds historical name snapshots (transaction_type_name, transaction_kind, category_name, account_name, to_account_name).

2. Removed
- account_types table and the accounts.account_type_id link.

3. Name uniqueness
- Names must be unique among active (not soft-deleted) records only, so a deleted name can be reused and restored items never collide.

4. Integrity
- A BEFORE INSERT trigger on transactions fills the name snapshots from the live records, rejects inactive or deleted items, and checks that a category belongs to the chosen transaction type.

5. Security
- transactions stays insert-and-read only. Historical records cannot be edited or deleted through the API.
- transaction_types, categories and accounts allow read, insert and update. Permanent delete is granted only for unused records, enforced by the app and by foreign keys.
- category_transaction_types allows read, insert and delete.
- Every policy is scoped to anon and authenticated, matching the no-sign-in app.
*/

ALTER TABLE transaction_types
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES categories(id) ON DELETE RESTRICT;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_liability boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE accounts a
SET is_liability = (t.classification = 'liability')
FROM account_types t
WHERE t.id = a.account_type_id;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_account_type_id_fkey;
ALTER TABLE accounts DROP COLUMN IF EXISTS account_type_id;
DROP TABLE IF EXISTS account_types;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_description_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_description_check CHECK (description IS NULL OR char_length(description) <= 200);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transaction_type_name text,
  ADD COLUMN IF NOT EXISTS transaction_kind text,
  ADD COLUMN IF NOT EXISTS category_name text,
  ADD COLUMN IF NOT EXISTS account_name text,
  ADD COLUMN IF NOT EXISTS to_account_name text;

UPDATE transactions t SET transaction_type_name = tt.name, transaction_kind = tt.kind
FROM transaction_types tt WHERE tt.id = t.transaction_type_id;

UPDATE transactions t SET category_name = c.name
FROM categories c WHERE c.id = t.category_id;

UPDATE transactions t SET account_name = a.name
FROM accounts a WHERE a.id = t.account_id;

UPDATE transactions t SET to_account_name = a.name
FROM accounts a WHERE a.id = t.to_account_id;

ALTER TABLE transactions ALTER COLUMN transaction_type_name SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN transaction_kind SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN account_name SET NOT NULL;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transaction_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_transaction_kind_check
  CHECK (transaction_kind IN ('expense', 'income', 'transfer'));

DROP INDEX IF EXISTS transaction_types_name_key;
DROP INDEX IF EXISTS categories_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS transaction_types_active_name_key ON transaction_types (lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS categories_active_name_key ON categories (lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_active_name_key ON accounts (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories (parent_id);

CREATE OR REPLACE FUNCTION snapshot_transaction_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  tt record;
  cat record;
  acc record;
BEGIN
  SELECT name, kind INTO tt
  FROM transaction_types
  WHERE id = NEW.transaction_type_id AND deleted_at IS NULL AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That transaction type is no longer available.';
  END IF;
  NEW.transaction_type_name := tt.name;
  NEW.transaction_kind := tt.kind;

  IF NEW.category_id IS NULL THEN
    IF tt.kind <> 'transfer' THEN
      RAISE EXCEPTION 'Choose a category that fits this transaction type.';
    END IF;
    NEW.category_name := NULL;
  ELSE
    SELECT c.name INTO cat
    FROM categories c
    JOIN category_transaction_types l
      ON l.category_id = c.id AND l.transaction_type_id = NEW.transaction_type_id
    WHERE c.id = NEW.category_id AND c.deleted_at IS NULL AND c.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That category does not fit this transaction type.';
    END IF;
    NEW.category_name := cat.name;
  END IF;

  SELECT name INTO acc FROM accounts WHERE id = NEW.account_id AND deleted_at IS NULL AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That account is no longer available.';
  END IF;
  NEW.account_name := acc.name;

  IF tt.kind = 'transfer' THEN
    IF NEW.to_account_id IS NULL THEN
      RAISE EXCEPTION 'Choose the account to move money into.';
    END IF;
    SELECT name INTO acc FROM accounts WHERE id = NEW.to_account_id AND deleted_at IS NULL AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That account is no longer available.';
    END IF;
    NEW.to_account_name := acc.name;
  ELSE
    IF NEW.to_account_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only transfers can have a destination account.';
    END IF;
    NEW.to_account_name := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION snapshot_transaction_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS snapshot_transaction_history ON transactions;
CREATE TRIGGER snapshot_transaction_history
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION snapshot_transaction_history();

REVOKE ALL ON transactions, transaction_types, categories, accounts, category_transaction_types FROM anon, authenticated;
GRANT SELECT, INSERT ON transactions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON transaction_types, categories, accounts TO anon, authenticated;
GRANT SELECT, INSERT, DELETE ON category_transaction_types TO anon, authenticated;

DROP POLICY IF EXISTS shared_select_transactions ON transactions;
CREATE POLICY shared_select_transactions ON transactions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS shared_insert_transactions ON transactions;
CREATE POLICY shared_insert_transactions ON transactions FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS shared_select_transaction_types ON transaction_types;
CREATE POLICY shared_select_transaction_types ON transaction_types FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS shared_insert_transaction_types ON transaction_types;
CREATE POLICY shared_insert_transaction_types ON transaction_types FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS shared_update_transaction_types ON transaction_types;
CREATE POLICY shared_update_transaction_types ON transaction_types FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shared_delete_transaction_types ON transaction_types;
CREATE POLICY shared_delete_transaction_types ON transaction_types FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS shared_select_categories ON categories;
CREATE POLICY shared_select_categories ON categories FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS shared_insert_categories ON categories;
CREATE POLICY shared_insert_categories ON categories FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS shared_update_categories ON categories;
CREATE POLICY shared_update_categories ON categories FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shared_delete_categories ON categories;
CREATE POLICY shared_delete_categories ON categories FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS shared_select_accounts ON accounts;
CREATE POLICY shared_select_accounts ON accounts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS shared_insert_accounts ON accounts;
CREATE POLICY shared_insert_accounts ON accounts FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS shared_update_accounts ON accounts;
CREATE POLICY shared_update_accounts ON accounts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shared_delete_accounts ON accounts;
CREATE POLICY shared_delete_accounts ON accounts FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS shared_select_category_transaction_types ON category_transaction_types;
CREATE POLICY shared_select_category_transaction_types ON category_transaction_types FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS shared_insert_category_transaction_types ON category_transaction_types;
CREATE POLICY shared_insert_category_transaction_types ON category_transaction_types FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS shared_delete_category_transaction_types ON category_transaction_types;
CREATE POLICY shared_delete_category_transaction_types ON category_transaction_types FOR DELETE TO anon, authenticated USING (true);
