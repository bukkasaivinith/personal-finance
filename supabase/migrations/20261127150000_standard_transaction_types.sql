BEGIN;

ALTER TABLE public.transaction_types
  ADD COLUMN is_standard boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT standard_transaction_types_are_active
    CHECK (NOT is_standard OR (is_active AND deleted_at IS NULL AND user_id IS NOT NULL));

CREATE UNIQUE INDEX transaction_types_standard_owner_kind_idx
  ON public.transaction_types (user_id, kind) WHERE is_standard;

CREATE FUNCTION public.initialize_finance_standard_types(p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  fixed record;
  standard_id uuid;
BEGIN
  IF (SELECT count(*) FROM public.transaction_types WHERE user_id = p_owner_id AND is_standard) = 3 THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 6112715));

  FOR fixed IN SELECT * FROM (VALUES
    ('income', 'Income'), ('expense', 'Expense'), ('transfer', 'Transfer between accounts')
  ) AS kinds(kind, name) LOOP
    SELECT id INTO standard_id FROM public.transaction_types
    WHERE user_id = p_owner_id AND kind = fixed.kind AND is_standard;
    IF FOUND THEN CONTINUE; END IF;

    UPDATE public.transaction_types SET is_standard = true
    WHERE user_id = p_owner_id AND kind = fixed.kind AND lower(name) = lower(fixed.name)
      AND is_active AND deleted_at IS NULL
    RETURNING id INTO standard_id;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.transaction_types
        WHERE user_id = p_owner_id AND lower(name) = lower(fixed.name) AND deleted_at IS NULL) THEN
        fixed.name := fixed.name || ' · ' || gen_random_uuid()::text;
      END IF;
      INSERT INTO public.transaction_types (user_id, kind, name, is_standard)
      VALUES (p_owner_id, fixed.kind, fixed.name, true)
      RETURNING id INTO standard_id;
    END IF;

    -- Retain old associations for scheduled entries and historical records while
    -- exposing each category under the corresponding fixed kind for new entries.
    IF fixed.kind <> 'transfer' THEN
      INSERT INTO public.category_transaction_types (category_id, transaction_type_id, user_id)
      SELECT link.category_id, standard_id, p_owner_id
      FROM public.category_transaction_types AS link
      JOIN public.transaction_types AS previous ON previous.id = link.transaction_type_id
      WHERE link.user_id = p_owner_id AND previous.user_id = p_owner_id AND previous.kind = fixed.kind
      ON CONFLICT (category_id, transaction_type_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_finance_standard_types(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.open_finance_workspace()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM public.require_current_single_device_session();
  PERFORM public.claim_unowned_finance_data();
  PERFORM public.initialize_finance_standard_types(auth.uid());
END;
$$;

CREATE FUNCTION public.set_finance_standard_category_types(p_category_id uuid, p_transaction_type_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  PERFORM 1 FROM public.categories WHERE id = p_category_id AND user_id = caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This category is no longer available.'; END IF;
  IF COALESCE(cardinality(p_transaction_type_ids), 0) NOT BETWEEN 1 AND 2 OR EXISTS (
    SELECT 1 FROM unnest(p_transaction_type_ids) AS requested(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.transaction_types AS type
      WHERE type.id = requested.id AND type.user_id = caller AND type.is_standard AND type.kind IN ('income', 'expense')
    )
  ) THEN
    RAISE EXCEPTION 'Choose Income, Expense, or both for this category.';
  END IF;

  DELETE FROM public.category_transaction_types AS link
  USING public.transaction_types AS type
  WHERE link.category_id = p_category_id AND link.user_id = caller
    AND type.id = link.transaction_type_id AND type.is_standard;

  INSERT INTO public.category_transaction_types (category_id, transaction_type_id, user_id)
  SELECT DISTINCT p_category_id, requested.id, caller
  FROM unnest(p_transaction_type_ids) AS requested(id);
END;
$$;

CREATE FUNCTION public.create_finance_category(p_name text, p_emoji text, p_parent_id uuid, p_transaction_type_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  category_id uuid;
BEGIN
  INSERT INTO public.categories (name, emoji, parent_id, user_id)
  VALUES (p_name, p_emoji, p_parent_id, auth.uid()) RETURNING id INTO category_id;
  PERFORM public.set_finance_standard_category_types(category_id, p_transaction_type_ids);
  RETURN category_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_finance_category(
  p_category_id uuid, p_name text, p_emoji text, p_parent_id uuid, p_transaction_type_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE public.categories SET name = p_name, emoji = p_emoji, parent_id = p_parent_id, updated_at = now()
  WHERE id = p_category_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'This category is no longer available.'; END IF;
  PERFORM public.set_finance_standard_category_types(p_category_id, p_transaction_type_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.set_finance_standard_category_types(uuid, uuid[]),
  public.create_finance_category(text, text, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_finance_standard_category_types(uuid, uuid[]),
  public.create_finance_category(text, text, uuid, uuid[]) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.transaction_types FROM authenticated;
COMMIT;
