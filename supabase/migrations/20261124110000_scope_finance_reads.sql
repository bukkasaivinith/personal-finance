BEGIN;

-- Keep browser table grants explicit. Existing owner/session RLS remains in force.
REVOKE ALL ON TABLE
  public.transaction_types, public.categories, public.category_transaction_types,
  public.accounts, public.transactions, public.audit_events, public.budgets, public.recurring_entries,
  public.investments, public.investment_types, public.investment_value_updates, public.investment_withdrawals,
  public.profiles, public.active_user_sessions, public.finance_workspace_owner,
  public.workspace_members, public.account_shares, public.workspace_invitations, public.workspace_invitation_accounts,
  public.workspace_notifications, public.platform_administrators, public.platform_admin_activity_log,
  public.ipo_companies, public.ipo_applicants, public.ipo_applicant_accounts, public.ipo_cash_accounts,
  public.ipo_applications, public.ipo_events, public.ipo_allotments, public.ipo_sales, public.ipo_settlements,
  public.ipo_write_context, public.savings_entries, public.savings_locations, public.savings_movements,
  public.savings_accounts
FROM PUBLIC, anon;

CREATE INDEX IF NOT EXISTS finance_transactions_owner_cursor_idx ON public.transactions (user_id, id);

CREATE FUNCTION public.get_finance_transaction_page(
  p_owner_id uuid,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 1000,
  p_scheduled_only boolean DEFAULT false,
  p_transaction_id uuid DEFAULT NULL,
  p_recurring_entry_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid, name text, transaction_type_id uuid, transaction_type_name text,
  transaction_kind text, category_id uuid, category_name text, amount numeric,
  transaction_date date, transaction_time time, account_id uuid, account_name text,
  to_account_id uuid, to_account_name text, recurring_entry_id uuid, investment_id uuid,
  transaction_source text, visible_transfer_direction text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM public.require_current_single_device_session();
  IF p_owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'This workspace is unavailable.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT t.id, t.name, t.transaction_type_id, t.transaction_type_name,
    t.transaction_kind, t.category_id, t.category_name, t.amount,
    t.transaction_date, t.transaction_time, t.account_id, t.account_name,
    t.to_account_id, t.to_account_name, t.recurring_entry_id, t.investment_id,
    t.transaction_source, NULL::text
  FROM public.transactions AS t
  WHERE t.user_id = p_owner_id
    AND (p_after_id IS NULL OR t.id > p_after_id)
    AND (NOT COALESCE(p_scheduled_only, false) OR t.transaction_source = 'scheduled')
    AND (p_transaction_id IS NULL OR t.id = p_transaction_id)
    AND (p_recurring_entry_id IS NULL OR t.recurring_entry_id = p_recurring_entry_id)
  ORDER BY t.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);
END;
$$;

CREATE FUNCTION public.get_finance_transaction_usage(p_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.require_current_single_device_session();
  IF p_owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'This workspace is unavailable.' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'types', COALESCE(jsonb_object_agg(grouped.id, grouped.total) FILTER (WHERE grouped.is_type), '{}'::jsonb),
    'categories', COALESCE(jsonb_object_agg(grouped.id, grouped.total) FILTER (WHERE NOT grouped.is_type), '{}'::jsonb)
  ) INTO result
  FROM (
    SELECT CASE WHEN GROUPING(t.transaction_type_id) = 0 THEN t.transaction_type_id ELSE t.category_id END AS id,
      GROUPING(t.transaction_type_id) = 0 AS is_type, count(*) AS total
    FROM public.transactions AS t
    WHERE t.user_id = p_owner_id
    GROUP BY GROUPING SETS ((t.transaction_type_id), (t.category_id))
  ) AS grouped
  WHERE grouped.id IS NOT NULL;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_finance_transaction_page(uuid, uuid, integer, boolean, uuid, uuid),
  public.get_finance_transaction_usage(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.get_finance_transaction_page(uuid, uuid, integer, boolean, uuid, uuid),
  public.get_finance_transaction_usage(uuid)
TO authenticated;

COMMIT;
