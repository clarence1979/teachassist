/*
  # Add distinct usernames RPC

  1. New Function
    - `list_all_usernames()` — returns every distinct username that exists
      across `user_records` and `users_login`. The admin user switcher calls
      this instead of selecting from `user_records` directly, because a plain
      `SELECT username FROM user_records` gets truncated by PostgREST's
      default 1000-row cap when a single user has more than 1000 records.

  2. Security
    - Function is `SECURITY INVOKER` so RLS still applies.
    - Granted to `anon` and `authenticated` because this app does not use
      Supabase Auth — the existing `user_records` / `users_login` policies
      are already permissive for `anon`.
*/

CREATE OR REPLACE FUNCTION public.list_all_usernames()
RETURNS TABLE(username text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT username
  FROM (
    SELECT username FROM public.user_records WHERE username IS NOT NULL AND username <> 'default'
    UNION
    SELECT username FROM public.users_login WHERE username IS NOT NULL
  ) u
  ORDER BY username;
$$;

GRANT EXECUTE ON FUNCTION public.list_all_usernames() TO anon, authenticated;
