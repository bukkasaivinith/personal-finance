/*
  Privacy-preserving account-usage totals for platform administration.

  This function intentionally returns only record counts. It never returns
  financial amounts, balances, names, descriptions, dates, or individual rows.
*/

CREATE OR REPLACE FUNCTION public.list_platform_user_usage()
RETURNS TABLE(
  user_id uuid,
  transaction_count bigint,
  account_count bigint,
  category_count bigint,
  budget_count bigint,
  recurring_entry_count bigint,
  investment_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.';
  END IF;

  RETURN QUERY
  WITH transaction_totals AS (
    SELECT txn.user_id, count(*)::bigint AS total
    FROM public.transactions txn
    GROUP BY txn.user_id
  ),
  account_totals AS (
    SELECT acct.user_id, count(*)::bigint AS total
    FROM public.accounts acct
    WHERE acct.deleted_at IS NULL
    GROUP BY acct.user_id
  ),
  category_totals AS (
    SELECT cat.user_id, count(*)::bigint AS total
    FROM public.categories cat
    WHERE cat.deleted_at IS NULL
    GROUP BY cat.user_id
  ),
  budget_totals AS (
    SELECT budget.user_id, count(*)::bigint AS total
    FROM public.budgets budget
    GROUP BY budget.user_id
  ),
  recurring_totals AS (
    SELECT recurring.user_id, count(*)::bigint AS total
    FROM public.recurring_entries recurring
    GROUP BY recurring.user_id
  ),
  investment_totals AS (
    SELECT investment.user_id, count(*)::bigint AS total
    FROM public.investments investment
    GROUP BY investment.user_id
  )
  SELECT profile.id,
         COALESCE(transaction_totals.total, 0),
         COALESCE(account_totals.total, 0),
         COALESCE(category_totals.total, 0),
         COALESCE(budget_totals.total, 0),
         COALESCE(recurring_totals.total, 0),
         COALESCE(investment_totals.total, 0)
  FROM public.profiles profile
  LEFT JOIN transaction_totals ON transaction_totals.user_id = profile.id
  LEFT JOIN account_totals ON account_totals.user_id = profile.id
  LEFT JOIN category_totals ON category_totals.user_id = profile.id
  LEFT JOIN budget_totals ON budget_totals.user_id = profile.id
  LEFT JOIN recurring_totals ON recurring_totals.user_id = profile.id
  LEFT JOIN investment_totals ON investment_totals.user_id = profile.id
  WHERE profile.deleted_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_platform_user_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_platform_user_usage() TO authenticated;
