import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

let _appUsername = '';

/** Call after login to attach the username header for RLS enforcement. */
export function setSupabaseUsername(username: string): void {
  _appUsername = username;
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: (url, options = {}) => {
      const headers = new Headers(options.headers);
      if (_appUsername) {
        headers.set('x-app-username', _appUsername);
      }
      return fetch(url, { ...options, headers });
    },
  },
});
