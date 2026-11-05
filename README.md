# Personal Finance

A Vite + React personal-finance app backed by Supabase Auth and a Supabase database.

## Run locally

1. Use Node.js 20.19 through 24.x.
2. Copy `.env.example` to `.env.local` and set the two values from **Supabase → Project Settings → API**.
3. Install and start the app:

   ```bash
   npm ci
   npm run dev
   ```

Run the production checks with:

```bash
npm run typecheck
npm run lint
npm run build
```

The build intentionally stops if either required environment variable is missing. This prevents a successful deployment that fails with a blank screen at runtime.

## Deploy to Vercel

1. Import this GitHub repository in Vercel. Vercel will use `npm run build` and publish `dist`.
2. In **Project Settings → Environment Variables**, add these for **Production**, **Preview**, and **Development**:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Your Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/publishable key |

   These values are deliberately browser-visible. Do not add `SUPABASE_SERVICE_ROLE_KEY` or any other server secret to a `VITE_` variable.
3. Deploy. Once Vercel supplies your production URL, copy it.
4. In **Supabase → Authentication → URL Configuration**, set the Site URL to that production URL and add these Redirect URLs:

   ```text
   https://your-production-domain.vercel.app
   https://your-production-domain.vercel.app/**
   https://*-your-team-or-account-slug.vercel.app/**
   ```

   Add any custom domain too. This is required for email confirmation and password-reset links, which return to the URL currently open in the browser.
5. Redeploy after changing environment variables, then test sign-up/sign-in, password reset, and a create/read transaction flow.

## Database migrations

The SQL migrations in `supabase/migrations` define the finance tables and audit trail. Apply any unapplied migrations to the same Supabase project before testing the deployed app.

## Security note

The included database policies are intentionally shared (`USING (true)`) for both anonymous and signed-in users. That means this codebase should be used as a single-user app unless the policies are changed to associate every row with `auth.uid()` before inviting other people.
