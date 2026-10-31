/*
# Audit trail for transaction types, categories and accounts

1. New Tables
- `audit_events`: one row per important change to a transaction type, category or account.
  - `id` (uuid, primary key)
  - `entity_table` (text): which list changed (transaction_types, categories or accounts)
  - `entity_id` (uuid): the item that changed. Kept even after a permanent delete.
  - `entity_name` (text): the item's name at the time of the change
  - `action` (text): created, renamed, deactivated, activated, deleted, restored, updated or permanently_deleted
  - `created_at` (timestamptz)

2. Triggers
- Each change to transaction_types, categories and accounts writes a row to audit_events automatically, so the app cannot skip logging.
- Writes are performed by a privileged trigger function. Client roles cannot insert, update or delete audit rows.

3. Security
- RLS enabled on audit_events.
- anon and authenticated may only SELECT. The table is intentionally shared, matching the rest of this single-user app.
- The trigger function is not callable by client roles (EXECUTE revoked from PUBLIC, anon and authenticated).

4. Notes
- Audit rows are never deleted by the app, so history of removed items remains visible.
- No existing data is modified.
*/

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_table text NOT NULL CHECK (entity_table IN ('transaction_types', 'categories', 'accounts')),
  entity_id uuid NOT NULL,
  entity_name text NOT NULL DEFAULT '',
  action text NOT NULL CHECK (action IN ('created', 'renamed', 'deactivated', 'activated', 'deleted', 'restored', 'updated', 'permanently_deleted')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON audit_events TO anon, authenticated;

DROP POLICY IF EXISTS "shared_select_audit_events" ON audit_events;
CREATE POLICY "shared_select_audit_events" ON audit_events FOR SELECT
  TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION record_item_audit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  change_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_events (entity_table, entity_id, entity_name, action)
    VALUES (TG_TABLE_NAME, NEW.id, NEW.name, 'created');
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_events (entity_table, entity_id, entity_name, action)
    VALUES (TG_TABLE_NAME, OLD.id, OLD.name, 'permanently_deleted');
    RETURN OLD;
  END IF;

  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    change_action := 'deleted';
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    change_action := 'restored';
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    change_action := CASE WHEN NEW.is_active THEN 'activated' ELSE 'deactivated' END;
  ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
    change_action := 'renamed';
  ELSE
    change_action := 'updated';
  END IF;

  INSERT INTO audit_events (entity_table, entity_id, entity_name, action)
  VALUES (TG_TABLE_NAME, NEW.id, NEW.name, change_action);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_item_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS transaction_types_audit ON transaction_types;
CREATE TRIGGER transaction_types_audit
  AFTER INSERT OR UPDATE OR DELETE ON transaction_types
  FOR EACH ROW EXECUTE FUNCTION record_item_audit();

DROP TRIGGER IF EXISTS categories_audit ON categories;
CREATE TRIGGER categories_audit
  AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION record_item_audit();

DROP TRIGGER IF EXISTS accounts_audit ON accounts;
CREATE TRIGGER accounts_audit
  AFTER INSERT OR UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION record_item_audit();
