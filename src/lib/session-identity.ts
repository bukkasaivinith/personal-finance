// Group mounted UI by session across access-token refreshes. Authorization stays in Supabase.
export function browserSessionId(token: string): string | null {
  try {
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims.session_id === 'string' && claims.session_id ? claims.session_id : null;
  } catch {
    return null;
  }
}
