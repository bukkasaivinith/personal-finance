-- Read-only checks after the three IPO migrations. Run in Supabase SQL Editor.
-- 1: Expect 10 tables, all with RLS. The internal context table has no browser privileges.
SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,
 has_table_privilege('authenticated',c.oid,'SELECT') AS browser_read,
 has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') AS browser_direct_write
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'ipo\_%' ESCAPE '\'
ORDER BY c.relname;

-- 2: Expect one owner-only SELECT policy for each of the nine domain tables;
-- no policies granting access to ipo_write_context.
SELECT tablename,policyname,cmd,roles,qual FROM pg_policies
WHERE schemaname='public' AND tablename LIKE 'ipo\_%' ESCAPE '\' ORDER BY tablename;

-- 3: Authenticated may execute only ipo_command, ipo_dashboard, ipo_finance_links.
-- Anon must have no execute permission. Helpers/trigger functions must be false for both.
SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 p.prosecdef AS security_definer,p.proconfig AS function_settings,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'ipo\_%' ESCAPE '\' ORDER BY p.proname;

-- 4: Expect these indexes, including one live allotment per application and unique request keys.
SELECT tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND (tablename LIKE 'ipo\_%' ESCAPE '\' OR indexname='ipo_transactions_event')
ORDER BY tablename,indexname;

-- 5: Expect zero rows: no oversold shares, over-allocated cost, or unbalanced final cost.
SELECT al.application_id,al.shares,al.cost,COALESCE(s.shares,0) AS sold_shares,COALESCE(s.cost,0) AS sold_cost
FROM public.ipo_allotments al
LEFT JOIN LATERAL(SELECT sum(shares) shares,sum(cost_basis) cost FROM public.ipo_sales WHERE application_id=al.application_id AND NOT voided) s ON true
WHERE NOT al.voided AND (COALESCE(s.shares,0)>al.shares OR COALESCE(s.cost,0)>al.cost OR (s.shares=al.shares AND s.cost<>al.cost));

-- 6: Expect zero rows: every live positive allotment has one opening debit of its exact cost.
SELECT al.application_id,al.investment_id,al.cost,count(t.id) AS debit_count,COALESCE(sum(t.amount),0) AS posted_cost
FROM public.ipo_allotments al LEFT JOIN public.transactions t ON t.ipo_event_id=al.event_id AND t.transaction_kind='expense'
WHERE NOT al.voided AND al.shares>0 GROUP BY al.application_id,al.investment_id,al.cost
HAVING al.investment_id IS NULL OR count(t.id)<>1 OR COALESCE(sum(t.amount),0)<>al.cost;

-- 7: Expect zero rows: unsettled sale proceeds cannot be negative.
SELECT s.id,s.net,COALESCE(sum(r.amount),0) AS received
FROM public.ipo_sales s LEFT JOIN public.ipo_settlements r ON r.sale_id=s.id AND r.kind='receipt' AND NOT r.voided
WHERE NOT s.voided GROUP BY s.id,s.net HAVING COALESCE(sum(r.amount),0)>s.net;

-- 8: Expect zero. Authorization is created and removed within the same transaction.
SELECT count(*) AS leftover_write_authorizations FROM public.ipo_write_context;
