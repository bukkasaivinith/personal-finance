const modelOrigins = ['https://huggingface.co', 'https://*.huggingface.co', 'https://*.hf.co'];

function isPublicKey(key: string): boolean {
  if (/^sb_publishable_[\w-]+$/.test(key)) return true;
  const pieces = key.split('.');
  if (pieces.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(pieces[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'anon';
  } catch {
    return false;
  }
}

export function browserConfig(env: Record<string, string>, development: boolean) {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    throw new Error('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before starting the app.');
  }
  let api: URL;
  try { api = new URL(env.VITE_SUPABASE_URL); }
  catch { throw new Error('VITE_SUPABASE_URL must be a valid HTTPS origin.'); }
  const local = development && api.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname);
  if ((!local && api.protocol !== 'https:') || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
    throw new Error('VITE_SUPABASE_URL must be an HTTPS origin without credentials or a path.');
  }
  if (!isPublicKey(env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error('VITE_SUPABASE_ANON_KEY must contain a publishable key or a legacy anon key.');
  }
  return {
    url: api.origin,
    key: env.VITE_SUPABASE_ANON_KEY,
    connectPolicy: ['connect-src', "'self'", api.origin, api.origin.replace(/^http/, 'ws'), ...modelOrigins].join(' '),
  };
}
