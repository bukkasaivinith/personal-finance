# Single-owner workspace setup

This update limits the finance website and its database access to the existing verified account for `bukkasaivinith@gmail.com`. Signup and password recovery remain available. Signup creates an Auth account without granting access to the owner's finance records.

The update removes the workspace switcher, account sharing, invitation and member controls, sharing notifications, and the admin workspace. It also closes the corresponding database access. The migration keeps all users, financial records, and historical sharing and admin entries.

1. In Supabase **Authentication → Users**, confirm the owner's account already exists and its email is verified.
2. Apply `supabase/migrations/20261123100000_single_owner_workspace.sql` in the same database as the three IPO migrations. In **SQL Editor → New query**, paste the complete file and run it as one query. The transaction stops if there is no active, verified owner account.
3. Check that the migration bound the expected identity. This query should show one row with `bukkasaivinith@gmail.com` and a nonempty confirmation date.

   ```sql
   SELECT u.email, u.email_confirmed_at
   FROM public.finance_workspace_owner owner
   JOIN auth.users u ON u.id = owner.user_id;
   ```

4. After the query succeeds, deploy the updated website from `main`. The website requires the database access check added by the migration.
5. Sign in as the owner and check that the dashboard, IPO, and mobile transaction form load. Try signing in with an existing secondary account and verify that it sees the owner-only notice.

Deleting accounts is a separate operation. Review the exact account list and which records would be removed before confirming any deletion.
