# IPO implementation and verification record

Work branch: `ipo` (based on `b1ac5bc`). Do not merge or deploy automatically.

## Verified integration points

- `record_investment` immediately inserts an expense. IPO allotment must insert a linked investment directly inside its own atomic RPC, never call that function.
- `get_workspace_transactions` is the ledger read path; `signedBalance` derives balances from its posted entries. IPO cash moves use this same ledger.
- `investment_withdrawals` models capital-first withdrawals, not share cost allocation. IPO sales need their own immutable sale records and cumulative pro-rata purchase-cost allocation.
- `is_current_single_device_session`, `is_finance_user_active`, and workspace owner checks apply to IPO RPCs and table reads. Existing investment operations are owner-only; IPO follows that rule.
- The existing main Investments screen is retained, with navigation and read-only IPO-linked cards added.

## Stages

1. Add normalized IPO entities, immutable event history, idempotent commands, custody account links, and protection triggers.
2. Implement direct blocks, direct prepayment, pooled friend funding, allotment, unblocking/refunds, partial share sales, settlement and repayments. Use actual finance transactions for every cash movement.
3. Add reusable applicant/account forms, company/application detail, calendar, filters, reports and CSV export.
4. Exercise database workflows locally, UI calculations, ownership, repeated requests and failures; run existing checks.
5. Deliver SQL execution/verification instructions and a user guide. Production migration and deployment remain manual.

## Accounting decisions

An application or ASBA block is an informational event, displayed alongside ledger entries without contributing to balances. A payment to a friend is a transfer to a clearly labelled custodial account belonging economically to this workspace. Direct prepayments use an IPO escrow account. Allotment consumes cash exactly once and creates an investment without a second debit. A share sale recognises proceeds in an unsettled proceeds account; actual settlement transfers those proceeds to a bank or friend custody account. Repayments are transfers, never new profit. Historical corrections use explicit reversals and retain the original event.

The later requested Accounts presentation is implemented: IPO custody and shareholding cost are separate from normal total assets/net position. The Accounts page displays their invested and pending-receipt balances in a dedicated section. Posted bank balances continue to reflect genuine debits/receipts. Expected-date fields were removed from the company form; previously saved date history is retained.

## Verification — 23 November 2026

- `npm.cmd run test:ipo`: **19 passed**, including full migration execution, isolated PostgreSQL accounting, cross-user/shared-editor/admin restrictions, invalid session claims, idempotent replay, protected financial rows, historical date checks, manual verification-query syntax and ordinary investment partial-return/settlement compatibility.
- `npm.cmd run test:athlete`: **98 passed** (all existing project test files).
- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: zero errors; one existing `react-refresh/only-export-components` warning in `src/components/transaction-pickers.tsx`.
- Production build: passed using placeholder Supabase configuration; existing large-bundle warnings remain. The build was not deployed.
- Browser checks: actual IPO components rendered against isolated sample data; portfolio, reports, calendar date selection, narrow layouts, form date-picker visibility, Accounts separation and actual-date-only company inputs checked. No browser console errors were observed. Saves in the visual fixture were disabled.
- No existing production records were altered. All database test records existed only in the isolated test instance.

The embedded PostgreSQL tests are not a live Supabase or true multi-connection concurrency test. The authenticated deployment checks in [IPO-SETUP.md](IPO-SETUP.md) remain manual before production acceptance. The environment used Node 26; deployment should follow the repository's supported Node engine range.

## Exact file inventory

All paths below are relative to `C:\Users\vinith bukka\Documents\Codex\2026-11-06\can\work\personal-finance`.

### Added

- `supabase/migrations/20261117100000_ipo_portfolio.sql`
- `supabase/migrations/20261117110000_ipo_commands.sql`
- `supabase/migrations/20261117120000_ipo_reads.sql`
- `src/lib/ipo.ts`
- `src/lib/ipo-api.ts`
- `src/components/ipo-view.tsx`
- `src/components/ipo-form.tsx`
- `src/components/ipo-calendar.tsx`
- `src/components/ipo.css`
- `tests/ipo-database.test.mjs`
- `tests/ipo-model.test.mjs`
- `docs/IPO-IMPLEMENTATION.md`
- `docs/IPO-GUIDE.md`
- `docs/IPO-SETUP.md`
- `docs/IPO-VERIFY.sql`

### Updated

- `src/App.tsx`: IPO-linked finance data, Accounts summary and investment navigation/refresh.
- `src/lib/finance.ts`: IPO metadata and separation from general asset totals/manual account selectors.
- `src/lib/finance-api.ts`: private IPO adapter for accounts, investments and transaction memos.
- `src/components/investments-view.tsx`: IPO subpage and protected linked-investment display.
- `src/components/finance-views.tsx`: immediate IPO memos and separate Accounts IPO balances.
- `src/components/planning-views.tsx`: IPO activity-log filter.
- `src/components/mobile-app.tsx`: excludes managed custody from manual transaction selectors.
- `src/components/workspace-settings.tsx`: excludes private custody from account-sharing choices.
- `package.json`: `test:ipo` script and isolated PostgreSQL test dependency.
- `package-lock.json`: lockfile for that test dependency.

The user's pre-existing `.pnpm-store/` and `pnpm-workspace.yaml` were left untouched. Local visual-preview fixtures are outside the repository and are not part of the production app.
