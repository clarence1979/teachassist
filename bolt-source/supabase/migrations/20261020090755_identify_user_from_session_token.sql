/*
# Identify the signed-in user from their session token

Plain-English summary: saved chats, files, timetables and preferences were never
reaching the cloud copy, so a second computer could not see work done on the first.
The rule that decides "whose data is this?" read the username from a request
setting the database server no longer provides, so it always saw a blank name and
refused every save and load. It also trusted a name the browser simply claimed.

This migration makes the rule look up the caller's sign-in session token (sent in
the `x-app-session` request header) and use the username that session belongs to.
Admins may additionally act on another user's data by naming them in the
`x-app-username` header (used by the admin "view as" switcher).

1. Modified Functions
- `public.app_username()` now:
  - reads request headers from `request.headers` (the current PostgREST format)
  - returns the username of a valid, unexpired session from `app_sessions`
  - for admins only, returns the `x-app-username` header value when provided
  - returns '' (matches nothing) when there is no valid session
  - is SECURITY DEFINER with an empty search_path so it can read the locked
    `app_sessions` / `users_login` tables without exposing them

2. Modified Policies
- `user_records`, `user_prefs`, `shared_blocks`: same ownership rules as before,
  rewritten to call the function once per query instead of once per row.

3. Important Notes
1. No tables, columns or rows are changed or removed.
2. Requests without a valid session token can no longer read or write anyone's data.
*/

CREATE OR REPLACE FUNCTION public.app_username()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_headers json;
  v_token text;
  v_requested text;
  v_user text;
  v_admin boolean;
BEGIN
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  IF v_headers IS NULL THEN
    RETURN '';
  END IF;

  v_token := v_headers ->> 'x-app-session';
  IF v_token IS NULL OR v_token = '' THEN
    RETURN '';
  END IF;

  SELECT u.username, u.is_admin INTO v_user, v_admin
  FROM public.app_sessions s
  JOIN public.users_login u ON u.username = s.username
  WHERE s.token = v_token AND s.expires_at > now();

  IF v_user IS NULL THEN
    RETURN '';
  END IF;

  v_requested := v_headers ->> 'x-app-username';
  IF coalesce(v_admin, false) AND v_requested IS NOT NULL AND v_requested <> '' THEN
    RETURN v_requested;
  END IF;

  RETURN v_user;
END;
$$;

DROP POLICY IF EXISTS "Users can select own records" ON public.user_records;
CREATE POLICY "Users can select own records" ON public.user_records FOR SELECT
  TO anon, authenticated USING (username = (SELECT public.app_username()));
DROP POLICY IF EXISTS "Users can insert own records" ON public.user_records;
CREATE POLICY "Users can insert own records" ON public.user_records FOR INSERT
  TO anon, authenticated WITH CHECK (username = (SELECT public.app_username()));
DROP POLICY IF EXISTS "Users can update own records" ON public.user_records;
CREATE POLICY "Users can update own records" ON public.user_records FOR UPDATE
  TO anon, authenticated USING (username = (SELECT public.app_username()))
  WITH CHECK (username = (SELECT public.app_username()));
DROP POLICY IF EXISTS "Users can delete own records" ON public.user_records;
CREATE POLICY "Users can delete own records" ON public.user_records FOR DELETE
  TO anon, authenticated USING (username = (SELECT public.app_username()));

DROP POLICY IF EXISTS "Users can select own prefs" ON public.user_prefs;
CREATE POLICY "Users can select own prefs" ON public.user_prefs FOR SELECT
  TO anon, authenticated USING (username = (SELECT public.app_username()));
DROP POLICY IF EXISTS "Users can insert own prefs" ON public.user_prefs;
CREATE POLICY "Users can insert own prefs" ON public.user_prefs FOR INSERT
  TO anon, authenticated WITH CHECK (username = (SELECT public.app_username()));
DROP POLICY IF EXISTS "Users can update own prefs" ON public.user_prefs;
CREATE POLICY "Users can update own prefs" ON public.user_prefs FOR UPDATE
  TO anon, authenticated USING (username = (SELECT public.app_username()))
  WITH CHECK (username = (SELECT public.app_username()));
DROP POLICY IF EXISTS "Users can delete own prefs" ON public.user_prefs;
CREATE POLICY "Users can delete own prefs" ON public.user_prefs FOR DELETE
  TO anon, authenticated USING (username = (SELECT public.app_username()));

DROP POLICY IF EXISTS "Owner can insert shared_blocks" ON public.shared_blocks;
CREATE POLICY "Owner can insert shared_blocks" ON public.shared_blocks FOR INSERT
  TO anon, authenticated WITH CHECK (owner_username = (SELECT public.app_username()));
DROP POLICY IF EXISTS "Owner can update shared_blocks" ON public.shared_blocks;
CREATE POLICY "Owner can update shared_blocks" ON public.shared_blocks FOR UPDATE
  TO anon, authenticated USING (owner_username = (SELECT public.app_username()))
  WITH CHECK (owner_username = (SELECT public.app_username()));
DROP POLICY IF EXISTS "Owner can delete shared_blocks" ON public.shared_blocks;
CREATE POLICY "Owner can delete shared_blocks" ON public.shared_blocks FOR DELETE
  TO anon, authenticated USING (owner_username = (SELECT public.app_username()));
