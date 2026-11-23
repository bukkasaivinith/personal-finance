import { createClient } from '@supabase/supabase-js';

// A finance session survives refreshes in this browser tab but not closing the tab
// or browser. This is deliberately more private than the Supabase default
// localStorage session and avoids storing the session on shared devices.
const tabSessionStorage = {
  getItem: (key: string) => window.sessionStorage.getItem(key),
  setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
  removeItem: (key: string) => window.sessionStorage.removeItem(key),
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const authStorageKey = 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';

export const supabase = createClient(supabaseUrl, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  auth: {
    storage: tabSessionStorage,
    storageKey: authStorageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function clearFinanceTabSession(): void {
  for (const suffix of ['', '-user', '-code-verifier']) tabSessionStorage.removeItem(authStorageKey + suffix);
}
