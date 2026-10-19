/*
# Secure login and shared API keys

Plain-English summary: the login table (usernames, passwords, admin flags) and the
shared API key table were readable by anyone on the internet. This migration closes
both tables to direct access. Sign-in now happens through a protected database
function that checks the password and hands back a random session token; the shared
API keys are only released to a caller holding a valid, unexpired session token.

1. New Tables
- `app_sessions`
  - `token` (text, primary key) — random 64-char hex session token
  - `username` (text, references users_login) — who the session belongs to
  - `created_at` (timestamptz)
  - `expires_at` (timestamptz, default 30 days out)

2. Modified Tables
- `users_login`: passwords are now stored as bcrypt hashes. A trigger hashes any
  plain-text password on insert/update, so adding or resetting a user from the
  dashboard by typing a plain password still works. Existing rows are hashed.
- `secrets`: unchanged structure.

3. Security
- Removed "Anyone can read users_login for authentication" and "Anyone can read
  secrets" policies; revoked all anon/authenticated privileges on both tables.
- `app_sessions`: RLS enabled, no policies, no client privileges (server-only).
- New SECURITY DEFINER functions (fixed search_path), callable by anon:
  - `app_login(p_username, p_password)` → token + is_admin, or no row on failure
  - `app_session_info(p_token)` → username + is_admin for a valid token
  - `app_logout(p_token)` → deletes that session
  - `get_app_secrets(p_token)` → OPENAI_API_KEY / CLAUDE_API_KEY for a valid token only
- `list_all_usernames` becomes SECURITY DEFINER so it keeps working now that
  users_login is closed; it returns usernames only.

4. Important Notes
1. No data is deleted; existing passwords are converted to hashes in place.
2. Passwords can no longer be read back — reset by typing a new one in the dashboard.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DROP POLICY IF EXISTS "Anyone can read users_login for authentication" ON public.users_login;
DROP POLICY IF EXISTS "Anyone can read secrets" ON public.secrets;
REVOKE ALL ON public.users_login FROM anon, authenticated;
REVOKE ALL ON public.secrets FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.users_login_hash_password()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.password IS NOT NULL AND NEW.password !~ '^\$2[aby]\$' THEN
    NEW.password := extensions.crypt(NEW.password, extensions.gen_salt('bf'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_login_hash_password ON public.users_login;
CREATE TRIGGER users_login_hash_password
  BEFORE INSERT OR UPDATE OF password ON public.users_login
  FOR EACH ROW EXECUTE FUNCTION public.users_login_hash_password();

UPDATE public.users_login SET password = password WHERE password !~ '^\$2[aby]\$';

CREATE TABLE IF NOT EXISTS public.app_sessions (
  token text PRIMARY KEY,
  username text NOT NULL REFERENCES public.users_login(username) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX IF NOT EXISTS app_sessions_username_idx ON public.app_sessions(username);
ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_sessions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_login(p_username text, p_password text)
RETURNS TABLE(token text, is_admin boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users_login%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_user FROM public.users_login u WHERE u.username = p_username;
  -- compare against a dummy hash when the user is missing so timing doesn't reveal existence
  IF v_user.username IS NULL THEN
    PERFORM extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf'));
    RETURN;
  END IF;
  IF extensions.crypt(coalesce(p_password, ''), v_user.password) <> v_user.password THEN
    RETURN;
  END IF;

  DELETE FROM public.app_sessions s WHERE s.expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.app_sessions(token, username) VALUES (v_token, v_user.username);

  token := v_token;
  is_admin := v_user.is_admin;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_session_info(p_token text)
RETURNS TABLE(username text, is_admin boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.username, u.is_admin
  FROM public.app_sessions s
  JOIN public.users_login u ON u.username = s.username
  WHERE s.token = p_token AND s.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.app_logout(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.app_sessions WHERE token = p_token;
$$;

CREATE OR REPLACE FUNCTION public.get_app_secrets(p_token text)
RETURNS TABLE(key_name text, key_value text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.key_name, k.key_value
  FROM public.secrets k
  WHERE k.key_name IN ('OPENAI_API_KEY', 'CLAUDE_API_KEY')
    AND EXISTS (
      SELECT 1 FROM public.app_sessions s
      WHERE s.token = p_token AND s.expires_at > now()
    );
$$;

CREATE OR REPLACE FUNCTION public.list_all_usernames()
RETURNS TABLE(username text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT u.username
  FROM (
    SELECT r.username FROM public.user_records r WHERE r.username IS NOT NULL AND r.username <> 'default'
    UNION
    SELECT l.username FROM public.users_login l WHERE l.username IS NOT NULL
  ) u
  ORDER BY u.username;
$$;

REVOKE ALL ON FUNCTION public.app_login(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_session_info(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_logout(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_app_secrets(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.users_login_hash_password() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_login(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_session_info(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_logout(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_secrets(text) TO anon, authenticated;
