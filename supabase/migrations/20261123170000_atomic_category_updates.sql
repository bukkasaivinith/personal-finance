BEGIN;

CREATE OR REPLACE FUNCTION public.update_finance_category(
  p_category_id uuid,
  p_name text,
  p_emoji text,
  p_parent_id uuid,
  p_transaction_type_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  UPDATE public.categories
  SET name = p_name, emoji = p_emoji, parent_id = p_parent_id, updated_at = now()
  WHERE id = p_category_id AND user_id = caller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This category is no longer available. Refresh the page and try again.';
  END IF;

  DELETE FROM public.category_transaction_types
  WHERE category_id = p_category_id AND user_id = caller;

  INSERT INTO public.category_transaction_types (category_id, transaction_type_id, user_id)
  SELECT DISTINCT p_category_id, selected.type_id, caller
  FROM unnest(p_transaction_type_ids) AS selected(type_id);
END;
$$;

REVOKE ALL ON FUNCTION public.update_finance_category(uuid, text, text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_finance_category(uuid, text, text, uuid, uuid[]) TO authenticated;

COMMIT;
