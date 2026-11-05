/*
# Add optional category emojis

Categories may have one optional emoji. The web app shows it in the category
picker, Setup list, and beside transactions that use the category.
*/

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS emoji text;

ALTER TABLE categories
  DROP CONSTRAINT IF EXISTS categories_emoji_length_check;

ALTER TABLE categories
  ADD CONSTRAINT categories_emoji_length_check
  CHECK (emoji IS NULL OR char_length(emoji) BETWEEN 1 AND 16);
