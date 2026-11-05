/*
# Store the local time a transaction was recorded

Existing transactions keep a NULL time so their original date-only history is
unchanged. New transactions save the local time selected in the app.
*/

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transaction_time time without time zone;

CREATE INDEX IF NOT EXISTS transactions_date_time_idx
  ON transactions (transaction_date DESC, transaction_time DESC NULLS LAST);
