import { createClient } from '@supabase/supabase-js';

// A finance session survives refreshes in this browser tab but not closing the tab
// or browser. This is deliberately more private than the Supabase default
// localStorage session and avoids storing the session on shared devices.
const tabSessionStorage = {
  getItem: (key: string) => window.sessionStorage.getItem(key),
  setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
  removeItem: (key: string) => window.sessionStorage.removeItem(key),
};

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    storage: tabSessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
