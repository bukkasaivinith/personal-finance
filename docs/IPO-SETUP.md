# IPO setup and verification

Branch: `main`. Repository: `C:\Users\vinith bukka\Documents\Codex\2026-11-06\can\work\personal-finance`.

The combined company and application form needs the latest IPO migration on your existing Supabase project.

## Apply the database changes

1. Use your existing Supabase project and take its normal backup/snapshot before changing production. Prefer a test database/branch for initial validation; do not point tests at personal production records.
2. Confirm that the existing repository migrations through `20261115160000_add_investment_tracking.sql` are already installed. In particular, the workspace isolation, single-device session and investment tracking functions must exist. Do not blindly replay all old migrations over an existing database.
3. In Supabase **SQL Editor**, open a new query. Paste the entire first file below, including `BEGIN` and `COMMIT`, and Run. Confirm success before the next file. Use a separate query for each file:

   1. `supabase/migrations/20261117100000_ipo_portfolio.sql`
   2. `supabase/migrations/20261117110000_ipo_commands.sql`
   3. `supabase/migrations/20261117120000_ipo_reads.sql`
   4. `supabase/migrations/20261123110000_ipo_company_applications.sql`

4. Run [IPO-VERIFY.sql](IPO-VERIFY.sql) in the SQL Editor and compare the results with its comments.
5. If the API still reports a missing IPO function after the migrations succeed, refresh its schema cache with `NOTIFY pgrst, 'reload schema';`, then refresh the app.
6. Run `main` locally or in your testing deployment using the existing project's frontend URL and public/anonymous key. No service-role key belongs in frontend configuration. Do not merge or publish to production until the validation below is complete.

SQL Editor runs are not automatically equivalent to a CLI migration-history entry. Keep a record of the successful filenames. If you later use Supabase CLI migrations, reconcile its migration history with those manual runs before running a push. These migrations are deliberately **not** intended to be replayed after success.

## What the migrations do

| File | Changes |
|---|---|
| `20261117100000_ipo_portfolio.sql` | Nine IPO domain tables plus an internal transaction authorization table; ownership constraints, RLS, indexes, transaction-to-event link, protected-write triggers, helpers and IPO activity-log entity support |
| `20261117110000_ipo_commands.sql` | Atomic, validated financial/profile commands; workspace lock, idempotency key, ledger posting, linked investment creation, sale cost allocation, receipts, reversals and audit entries |
| `20261117120000_ipo_reads.sql` | Private dashboard and finance-summary adapters, cleanup integration with the already-authorized account-deletion flow, and qualification of an ambiguous aggregate in the existing investment-settlement function |
| `20261123110000_ipo_company_applications.sql` | Saves a new company and its submitted demat applications in one transaction using the existing IPO commands |

For an existing IPO installation, apply only the new company-applications migration from this list.

Existing migration files were not rewritten. The settlement fix qualifies withdrawal column names without changing the ordinary settlement calculation. IPO allotment does not call the normal `record_investment` function, because that would create another capital debit.

## Validation after installation

Use test records in the test workspace. Record actual events through the UI; do not create raw IPO table rows manually.

1. Sign in and open **Investments → IPO**. An unused workspace should be empty. Create a self profile, demat account, company and application. Refresh and sign in again to verify persistence.
2. Check Transactions: application memo appears immediately. A block changes reserved amounts but does not change the posted bank balance. Record an allotment: exactly one capital debit and one linked investment must appear.
3. Sell part of the shares, then the rest. Confirm remaining shares/cost, profit/loss, charges, settlement and bank receipts. IPO holdings/custody must be separate on Accounts and excluded from total assets.
4. Fund a friend once, apply through two demat accounts, record a partial/unsuccessful allotment, unblock remaining funds and record partial repayments. Confirm that transfers do not realise profit again.
5. Test prepayment → unsuccessful allotment → partial refund → correction → correct refund. A mere ASBA release must never create refund income.
6. Sign in as an unrelated test user, a shared editor and the admin account. Verify private IPO tables/RPCs/portfolio data are inaccessible. Attempt modifying a linked transaction through ordinary finance actions; the database must reject it.
7. Replace the login session on another device. Confirm the older session cannot call IPO reads/writes.
8. From two independent authenticated database/API connections, submit the **same request UUID and payload** concurrently; both should return the same event. Repeat allotment with two different UUIDs; one must succeed and the other reject the existing result. Check receipt oversubscription similarly. This is the final live concurrency check; the local embedded database tests do not simulate independent server connections.
9. Check desktop/mobile calendar navigation, company forms, filtering and downloads in the deployed application. Reconfirm ordinary investment create, partial return and settlement.

The SQL Editor normally runs with elevated privileges, so querying tables there does **not** prove RLS works. Use actual signed-in test users for authorization tests. The local database tests separately set the `authenticated` role and simulate session claims.

## Accounting reconciliation

- Applied amount = lots × shares per lot × issue price + explained adjustment. It is cumulative application activity, not money currently invested.
- Allotted cost = allotted shares × application issue price + purchase charges.
- Remaining holding cost = allotted cost − allocated sale costs.
- Each sale's cost = rounded cumulative proportional cost through that sale − previously allocated cost. This leaves no rounding remainder after the final sale.
- Realised profit/loss = net sale proceeds − allocated cost; neither listing prices nor repayments realise more profit.
- Unsettled proceeds = sale proceeds − recorded receipts.
- Applicant custody = funds sent + sale receipts into applicant custody − allotted cost paid from custody − repayments. Blocks affect availability, not the posted balance.
- Escrow = outstanding actual prepayments. Refunds due are part of escrow, not another asset added on top.
- Pending receipt on Accounts = applicant custody + unsettled sale proceeds + refunds due. Prepayments still awaiting an allotment result are shown separately.
- Normal total assets/net position exclude all IPO-managed custody accounts and shareholding cost. Actual bank debits/receipts remain counted once; a block still in the bank remains in its posted balance.
- Memo events post no ledger rows. Reversals post inverse ledger movements and preserve original rows. Do not delete original ledger rows to reconcile balances.

## Failure and recovery

Each migration is wrapped in a transaction. If it fails before COMMIT, its changes roll back. Save the complete error, use `ROLLBACK;` if the editor says its transaction is aborted, fix the cause and rerun **that failed file**. If file 1 succeeded but file 2 failed, do not rerun file 1.

If tables/functions already exist, first determine whether that file already completed. Do not drop tables or remove constraints to make a rerun pass. An installed version should receive a new forward migration when it needs changes.

Before production use, a pre-migration snapshot is the clean rollback point. Once IPO financial events exist, preserve the schema and ledger; stop new IPO writes and fix forward or restore a complete consistent backup during a planned recovery. Do not drop IPO tables or revert the frontend to a version that permits ordinary editing of linked IPO investments. Reversals inside the IPO UI are the supported way to correct saved financial data.

## Local checks and limits

Run from the repository with Node compatible with its existing `>=20.19 <25` engine range:

```powershell
npm.cmd install
npm.cmd run test:ipo
npm.cmd run test:athlete
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

The IPO database tests apply the entire migration history to an isolated PGlite PostgreSQL instance with a Supabase auth/session fixture. They exercise accounting, permissions, replay handling, rollback, corrections, cleanup and the ordinary investment workflow. Model tests cover totals, filters, calendar dates and CSV escaping. They create no production records.

Browser verification uses the real UI components with isolated sample records and disabled saves. This checks layout/interactions, not a logged-in connection to your live Supabase project. No claim is made that the live migration, production login, true multi-connection race test or production deployment has completed. See [IPO-IMPLEMENTATION.md](IPO-IMPLEMENTATION.md) for the final check results and file inventory.
