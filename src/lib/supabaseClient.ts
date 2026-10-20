import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

let _appUsername = '';
let _sessionToken = '';

/** Database access rules read the owner from this header; set it per request when writing for a specific user. */
export const USERNAME_HEADER = 'x-app-username';
/** Verified identity: the database resolves the username from this session token when present. */
const SESSION_HEADER = 'x-app-session';

/** Call after login to attach the username header for RLS enforcement. */
export function setSupabaseUsername(username: string): void {
  _appUsername = username;
}

/** Call after login / session restore; pass '' on logout. */
export function setSupabaseSession(token: string): void {
  _sessionToken = token;
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: (url, options = {}) => {
      const headers = new Headers(options.headers);
      if (_appUsername && !headers.has(USERNAME_HEADER)) headers.set(USERNAME_HEADER, _appUsername);
      if (_sessionToken) headers.set(SESSION_HEADER, _sessionToken);
      return fetch(url, { ...options, headers });
    },
  },
});
