/*
# Keep existing transaction labels in sync with renamed setup items

The app originally kept a snapshot of the type, category and account names in
each transaction. That prevented past rows changing on rename. This migration
updates the existing snapshots once, then keeps them in sync whenever a type,
category or account is renamed. Updating an income/expense type's kind also
updates the kind saved with its existing transactions.
*/

UPDATE transactions t
SET transaction_type_name = tt.name,
    transaction_kind = tt.kind
FROM transaction_types tt
WHERE t.transaction_type_id = tt.id
  AND (t.transaction_type_name IS DISTINCT FROM tt.name OR t.transaction_kind IS DISTINCT FROM tt.kind);

UPDATE transactions t
SET category_name = c.name
FROM categories c
WHERE t.category_id = c.id
  AND t.category_name IS DISTINCT FROM c.name;

UPDATE transactions t
SET account_name = a.name
FROM accounts a
WHERE t.account_id = a.id
  AND t.account_name IS DISTINCT FROM a.name;

UPDATE transactions t
SET to_account_name = a.name
FROM accounts a
WHERE t.to_account_id = a.id
  AND t.to_account_name IS DISTINCT FROM a.name;

CREATE OR REPLACE FUNCTION sync_transaction_type_labels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    UPDATE transactions
    SET transaction_type_name = NEW.name,
        transaction_kind = NEW.kind
    WHERE transaction_type_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sync_category_labels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE transactions SET category_name = NEW.name WHERE category_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sync_account_labels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE transactions
    SET account_name = NEW.name
    WHERE account_id = NEW.id;

    UPDATE transactions
    SET to_account_name = NEW.name
    WHERE to_account_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_transaction_type_labels() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sync_category_labels() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sync_account_labels() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_transaction_type_labels_on_update ON transaction_types;
CREATE TRIGGER sync_transaction_type_labels_on_update
  AFTER UPDATE OF name, kind ON transaction_types
  FOR EACH ROW EXECUTE FUNCTION sync_transaction_type_labels();

DROP TRIGGER IF EXISTS sync_category_labels_on_update ON categories;
CREATE TRIGGER sync_category_labels_on_update
  AFTER UPDATE OF name ON categories
  FOR EACH ROW EXECUTE FUNCTION sync_category_labels();

DROP TRIGGER IF EXISTS sync_account_labels_on_update ON accounts;
CREATE TRIGGER sync_account_labels_on_update
  AFTER UPDATE OF name ON accounts
  FOR EACH ROW EXECUTE FUNCTION sync_account_labels();
