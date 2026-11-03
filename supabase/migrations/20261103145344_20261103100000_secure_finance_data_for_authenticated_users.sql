/*
# Secure personal finance data with authenticated ownership

Plain-English summary: converts the finance workspace from publicly shared data into private, authenticated data. Existing records are preserved and assigned once to the first authorized account that signs in. New records automatically belong to the signed-in account.

## Changed tables
- `transaction_types`: adds `user_id`, the authenticated owner.
- `categories`: adds `user_id`, the authenticated owner.
- `category_transaction_types`: adds `user_id`, matching the category owner.
- `accounts`: adds `user_id`, the authenticated owner.
- `transactions`: adds `user_id`, the authenticated owner.
- `audit_events`: adds `user_id`, the authenticated owner of the audited history.

## Security changes
- Anonymous Data API access is removed from all finance tables.
- Authenticated SELECT, INSERT, UPDATE, and DELETE access is restricted to rows owned by `auth.uid()` and only the operations the app needs.
- Ownership defaults to `auth.uid()` so the browser cannot choose another owner.
- Audit rows remain read-only to the app and are written by the existing privileged trigger.
- A privileged, non-public `claim_unowned_finance_data()` function assigns legacy NULL-owner rows to the first authorized signed-in account. It refuses to run if another owner is already present.

## Important notes
1. No financial records are deleted, renamed, or otherwise altered except for adding their owner assignment.
2. The application must call the claim function immediately after authentication and before loading finance data.
3. Public sign-up must remain disabled; create the initial authorized account through the Supabase project authentication administration process.
4. Password and session handling continue to be provided by Supabase Auth.
*/

ALTER TABLE transaction_types
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
ALTER TABLE category_transaction_types
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS transaction_types_user_idx ON transaction_types (user_id);
CREATE INDEX IF NOT EXISTS categories_user_idx ON categories (user_id);
CREATE INDEX IF NOT EXISTS category_transaction_types_user_idx ON category_transaction_types (user_id);
CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts (user_id);
CREATE INDEX IF NOT EXISTS transactions_user_idx ON transactions (user_id);
CREATE INDEX IF NOT EXISTS audit_events_user_idx ON audit_events (user_id);

CREATE OR REPLACE FUNCTION claim_unowned_finance_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  PERFORM pg_advisory_xact_lock(72492503);

  IF EXISTS (SELECT 1 FROM transaction_types WHERE user_id IS NOT NULL AND user_id <> auth.uid())
    OR EXISTS (SELECT 1 FROM categories WHERE user_id IS NOT NULL AND user_id <> auth.uid())
    OR EXISTS (SELECT 1 FROM category_transaction_types WHERE user_id IS NOT NULL AND user_id <> auth.uid())
    OR EXISTS (SELECT 1 FROM accounts WHERE user_id IS NOT NULL AND user_id <> auth.uid())
    OR EXISTS (SELECT 1 FROM transactions WHERE user_id IS NOT NULL AND user_id <> auth.uid())
    OR EXISTS (SELECT 1 FROM audit_events WHERE user_id IS NOT NULL AND user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'This workspace already belongs to another account';
  END IF;

  UPDATE transaction_types SET user_id = auth.uid() WHERE user_id IS NULL;
  UPDATE categories SET user_id = auth.uid() WHERE user_id IS NULL;
  UPDATE category_transaction_types SET user_id = auth.uid() WHERE user_id IS NULL;
  UPDATE accounts SET user_id = auth.uid() WHERE user_id IS NULL;
  UPDATE transactions SET user_id = auth.uid() WHERE user_id IS NULL;
  UPDATE audit_events SET user_id = auth.uid() WHERE user_id IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_unowned_finance_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_unowned_finance_data() TO authenticated;

REVOKE ALL ON transaction_types, categories, category_transaction_types, accounts, transactions, audit_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON transaction_types, categories, accounts TO authenticated;
GRANT SELECT, INSERT, DELETE ON category_transaction_types TO authenticated;
GRANT SELECT, INSERT ON transactions TO authenticated;
GRANT SELECT ON audit_events TO authenticated;

DROP POLICY IF EXISTS shared_select_transaction_types ON transaction_types;
DROP POLICY IF EXISTS shared_insert_transaction_types ON transaction_types;
DROP POLICY IF EXISTS shared_update_transaction_types ON transaction_types;
DROP POLICY IF EXISTS shared_delete_transaction_types ON transaction_types;
CREATE POLICY "select_own_transaction_types" ON transaction_types FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_transaction_types" ON transaction_types FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_transaction_types" ON transaction_types FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_transaction_types" ON transaction_types FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS shared_select_categories ON categories;
DROP POLICY IF EXISTS shared_insert_categories ON categories;
DROP POLICY IF EXISTS shared_update_categories ON categories;
DROP POLICY IF EXISTS shared_delete_categories ON categories;
CREATE POLICY "select_own_categories" ON categories FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_categories" ON categories FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_categories" ON categories FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_categories" ON categories FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS shared_select_category_transaction_types ON category_transaction_types;
DROP POLICY IF EXISTS shared_insert_category_transaction_types ON category_transaction_types;
DROP POLICY IF EXISTS shared_delete_category_transaction_types ON category_transaction_types;
CREATE POLICY "select_own_category_transaction_types" ON category_transaction_types FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_category_transaction_types" ON category_transaction_types FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_category_transaction_types" ON category_transaction_types FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS shared_select_accounts ON accounts;
DROP POLICY IF EXISTS shared_insert_accounts ON accounts;
DROP POLICY IF EXISTS shared_update_accounts ON accounts;
DROP POLICY IF EXISTS shared_delete_accounts ON accounts;
CREATE POLICY "select_own_accounts" ON accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_accounts" ON accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_accounts" ON accounts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_accounts" ON accounts FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS shared_select_transactions ON transactions;
DROP POLICY IF EXISTS shared_insert_transactions ON transactions;
CREATE POLICY "select_own_transactions" ON transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_transactions" ON transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS shared_select_audit_events ON audit_events;
CREATE POLICY "select_own_audit_events" ON audit_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
