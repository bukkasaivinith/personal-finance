BEGIN;

ALTER TABLE public.savings_entries
  ADD COLUMN IF NOT EXISTS emoji text CHECK (char_length(emoji) BETWEEN 1 AND 16);

CREATE OR REPLACE VIEW public.savings_accounts WITH (security_invoker = true) AS
SELECT entry.id, entry.user_id, entry.name, entry.amount, entry.saved_on, entry.storage_type, entry.storage_details, entry.location_id,
  entry.amount + COALESCE(activity.change, 0) AS balance,
  COALESCE(activity.last_recorded, entry.created_at) AS last_activity_at,
  entry.emoji
FROM public.savings_entries entry
LEFT JOIN LATERAL (
  SELECT sum(CASE movement.direction WHEN 'deposit' THEN movement.amount ELSE -movement.amount END) AS change,
    max(movement.recorded_at) AS last_recorded
  FROM public.savings_movements movement
  WHERE movement.savings_entry_id = entry.id AND movement.user_id = entry.user_id
) activity ON true;

COMMIT;
