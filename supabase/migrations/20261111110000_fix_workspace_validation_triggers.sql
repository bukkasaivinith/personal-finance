/*
  Fixes the workspace-reference validation trigger introduced by
  20261110120000. Each table now has a dedicated trigger function, avoiding
  invalid field access when a category is being inserted.
*/

DROP TRIGGER IF EXISTS validate_category_workspace_references ON public.categories;
DROP TRIGGER IF EXISTS validate_budget_workspace_references ON public.budgets;
DROP TRIGGER IF EXISTS validate_recurring_workspace_references ON public.recurring_entries;
DROP FUNCTION IF EXISTS public.validate_finance_workspace_references();

CREATE OR REPLACE FUNCTION public.validate_category_workspace_references()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.user_id IS NULL AND NEW.user_id = auth.uid() THEN RETURN NEW; END IF;
  IF NEW.parent_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.categories WHERE id = NEW.parent_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'A category parent must belong to the same workspace.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_budget_workspace_references()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.user_id IS NULL AND NEW.user_id = auth.uid() THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE id = NEW.category_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'A budget category must belong to the same workspace.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_recurring_workspace_references()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.user_id IS NULL AND NEW.user_id = auth.uid() THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.transaction_types WHERE id = NEW.transaction_type_id AND user_id = NEW.user_id)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = NEW.account_id AND user_id = NEW.user_id)
     OR (NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categories WHERE id = NEW.category_id AND user_id = NEW.user_id))
     OR (NEW.to_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = NEW.to_account_id AND user_id = NEW.user_id)) THEN
    RAISE EXCEPTION 'A recurring entry can only reference records in the same workspace.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_category_workspace_references
  BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.validate_category_workspace_references();
CREATE TRIGGER validate_budget_workspace_references
  BEFORE INSERT OR UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.validate_budget_workspace_references();
CREATE TRIGGER validate_recurring_workspace_references
  BEFORE INSERT OR UPDATE ON public.recurring_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_recurring_workspace_references();

REVOKE EXECUTE ON FUNCTION public.validate_category_workspace_references() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_budget_workspace_references() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_recurring_workspace_references() FROM PUBLIC, anon, authenticated;
