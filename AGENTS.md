# Persisting user records

- Use Supabase as the source of truth for user records in new and existing features. Create, edit, and delete actions must write to the database before the UI reports success. Reloading must show the persisted result.
- Use the existing authenticated APIs and owner-scoped row-level security. For a direct update or delete of one row, check that the database affected that row. Treat a missing or inaccessible row as an error unless the operation explicitly supports an idempotent retry.
- Keep related writes atomic. Update or remove linked records and recompute derived views according to their actual relationships. Preserve the existing archive and audit behavior for records that need to remain traceable.
- Verify edits and deletions through the feature's normal entry points, including persistence after a fresh read and what happens when the database rejects the write.
