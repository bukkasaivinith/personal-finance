# IPO portfolio: features and usage

The feature lives in **Investments → IPO** on `main`. It uses the existing signed-in user's private Supabase workspace. It does not contact a broker, place an application, trade shares, or transfer real money. Record movements after they happen.

Complete [database setup](IPO-SETUP.md) before using it with saved records.

## What was added

- Portfolio, Calendar, Reports and Applicants sections inside Investments.
- Reusable self/friend profiles, multiple demat accounts per person, optional broker/account nicknames, renaming and archival without deleting history.
- Manual Mainboard/SME company records with issue price, lot size, minimum lots and optional opening and closing dates. Record each applicant's result later from their application. You can update actual company dates for the calendar under **Edit company**.
- Compact company rows show the company name and any realised profit or loss. Open a company to see its applications and recorded history.
- Application amounts calculated from lots × shares per lot × issue price, with an optional explained adjustment.
- Immediate application activity in Transactions, marked as a memo so it never creates a fictitious bank debit.
- Separate mandate, bank-block, block-release, actual prepayment, applicant funding and repayment records.
- Full, partial, unsuccessful, rejected and cancelled allotments. A positive allotment creates one linked investment and one capital debit atomically.
- Partial/final share sales, purchase/sale charges, exact cost allocation and realised profit/loss.
- Sale settlement to a bank or applicant account, partial receipts and partial repayments. Outstanding money stays visible until actually received.
- Accounts → IPO balances: remaining invested capital, funds pending receipt, prepayments awaiting result, blocked funds and expandable custody-account details. IPO holdings and custody are excluded from total assets/net position; genuine bank receipts return to the bank balance normally.
- The portfolio shows companies applied, applications, allotment outcomes, total realised profit, total realised loss and net profit or loss. Select All time, This week, This month or Custom range.
- Eight CSV exports: applications, companies, applicants, allotments, sales, profit, outstanding funds/repayments and calendar. Exports quote text and protect against spreadsheet formula injection.
- Detailed IPO history plus entries in the existing Activity log, including reasons and reversing movements for corrections.
- Database ownership checks, active-session checks, protected automatic records, atomic commands and duplicate-request protection.

## First application

1. Open **Investments → IPO → Add IPO** and enter the company name, issue price, shares per lot and minimum lots.
2. Select **Add demat application** for each application. Choose a saved demat account or enter the new holder's name and an account nickname. Enter the actual date, amount and funding account.
3. Check the calculated lots and total. Each amount must equal a whole number of lots at the issue price. Select **Save IPO**.
4. The company page opens with its applications. You can add another application later from this page. Application memos appear on Transactions.

## Choose the correct funding workflow

| What happened | What to record | Bank effect |
|---|---|---|
| ASBA/UPI funds are blocked but still in your bank | Block funds | None; shown as reserved |
| A block is released | Release block | None; funds were already in the account |
| Money actually left your bank before allotment | Actual prepayment | Transfer to IPO escrow |
| You sent money to a friend/applicant | Send funds | One transfer to that person's IPO custody |
| Allotment consumed money | Allotment result | One debit from bank, escrow or applicant custody |
| Unused actual prepayment was refunded | Actual refund | Escrow transfers back to your selected bank |
| A friend returned money | Applicant repayment | Custody transfers back to your bank |

One applicant's custody pool can fund several IPOs/demat accounts. Selecting friend funding on an application does not send money again. The funding-account selection records the intended source; the actual Send funds records determine which bank paid into the pool.

Blocked funds remain until you explicitly record their release. A failed allotment does not invent a refund or income. **Actual refund** is only for money that was prepaid; use **Release block** for ASBA funds.

## Allotment and sales

Once you know the result, open the company and choose **Enter results** beside the application. Enter allotted lots and non-allotted lots, then select **Save result**. The result uses the company allotment date from **Edit company**, or today in India if that date is blank. The two counts must add up to the lots applied for that demat account. The app converts allotted lots to shares using the application's saved lot size. Positive allotments appear automatically in the Investments overview with a **View IPO** button.

To sell, choose **Sell shares** and enter quantity, price, sale charges and date. The app recognises profit/loss on the shares sold and retains the remaining shares at cost. A reference listing price is informational and does not create profit. The linked investment stays active until all shares are sold.

After selling, use **Record receipt** next to that sale when the money actually arrives. Choose your bank or applicant custody. If an applicant receives it, your bank does not increase yet. Record **Applicant repayment** when they transfer money back; each partial repayment reduces what remains with them.

Example: 100 shares cost ₹14,700 and sell for ₹20,000 net. Realised profit is ₹5,300. If Rahul receives ₹20,000 and returns ₹12,000, ₹8,000 remains in his custody and the profit stays ₹5,300. Do not record a second manual investment or duplicate bank transfer for these same events.

## Accounts and totals

Accounts shows normal bank/cash/card balances separately from IPO balances. The IPO section distinguishes:

- **Capital invested:** cost of unsold shares, excluding cost already allocated to sales.
- **Funds pending receipt:** funds in applicant custody + unsettled sale proceeds + actual refunds due. These are separate locations, so the same money is not added twice.
- **Prepayments awaiting result:** prepaid cash awaiting allotment, excluding refunds already classified as due.
- **Blocked funds:** still held in a bank or applicant account, shown for information and not added again to the IPO amounts.

IPO custody and holdings are not included in the site's total assets/net position. Blocked money still physically in your bank remains in its posted balance, with the amount available after blocks shown underneath. Actual receipts into your bank increase its balance once.

IPO cash movements remain visible in Transactions and existing cash-flow views. Those views describe ledger movements; **IPO Reports** is the view for realised share-sale profit. The separate IPO application-activity table contains memos, not income/expense entries.

## Reports and calendar

The Portfolio summary counts companies and applications by application date, outcomes by allotment date and profit or loss by sale date. The company rows show all-time realised results. Portfolio/Reports filters combine company/applicant search, applicant, application start/end dates, classification, status, allotment result, funding and outstanding/holding state. Use the date pickers to select a month, year or custom application period. Profit reports additionally filter by **sale date** and group daily, monthly or yearly.

Company and applicant reports use the matching applications. A friend's balance is a shared funding pool across IPOs; it is labelled as a whole-person pool instead of pretending to allocate it to a particular company. People funded before their first application are included in the unfiltered outstanding report.

The calendar shows application, allotment and listing dates. Use previous/next, Today or Jump to month. Select a date to see the companies, then select a company to open it. Record the actual listing in **Edit company** or **Record activity**. Previous expected dates are kept in saved records and hidden from the IPO page.

## Corrections and history

Profiles and company details can be edited; archive them to stop using them without erasing their history. An application can be corrected before allotment once blocks/prepayments are cleared. Its date cannot move past existing activity.

After financial activity, open **Recorded history → event → Reverse with reason**, then enter the correct replacement. Corrections retain the original and reversing ledger entries. Reverse newer dependent activity first; the current implementation deliberately requires newest-first across the IPO workspace to protect pooled funds and cost allocation. Reversing an allotment retires its linked investment from the active display while preserving its history.

Automatic IPO transactions, custody accounts and linked investments cannot be independently edited/deleted through ordinary finance actions. Repeated Save requests with the same request key return the original result. A completely new form submission is a new command, so check history before deliberately re-entering a saved cash movement.

## Availability

No extra API key, market feed or payment integration is required. There are no automatic trades, refunds, allotments or payments. Shared viewers/editors and platform administrators cannot open another person's private IPO portfolio. Existing selected-bank sharing remains intact; a shared bank's cash movements retain the existing sharing/redaction rules, while IPO profiles and custody accounts stay private.

The local tests and responsive preview were verified. Live Supabase migration, authenticated browser integration, true simultaneous database connections and production deployment remain separate setup checks described in [IPO-SETUP.md](IPO-SETUP.md).
