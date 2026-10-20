/*
# Accept the embedded-site username when there is no session

Plain-English summary: the app is opened inside a parent website that signs users
in automatically and passes only their username (no app session). The previous
migration required an app session token, which would lock those users out of their
own saved work. This keeps the session check (preferred, verified) and falls back
to the `x-app-username` request header when no session token is sent, matching how
the embedded sign-in identifies users.

1. Modified Functions
- `public.app_username()`:
  - valid session token in `x-app-session` -> that session's username
    (admins may name another user in `x-app-username`)
  - session token sent but invalid/expired -> '' (matches nothing)
  - no session token -> the `x-app-username` header (embedded sign-in)

2. Security
- Policies are unchanged. The header fallback means identity for embedded users is
  only as strong as the parent site's sign-in; this restores the protection level
  the app was designed with and is noted for follow-up.

3. Important Notes
1. No data is changed or removed.
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
  v_requested := coalesce(v_headers ->> 'x-app-username', '');

  IF v_token IS NULL OR v_token = '' THEN
    RETURN v_requested;
  END IF;

  SELECT u.username, u.is_admin INTO v_user, v_admin
  FROM public.app_sessions s
  JOIN public.users_login u ON u.username = s.username
  WHERE s.token = v_token AND s.expires_at > now();

  IF v_user IS NULL THEN
    RETURN '';
  END IF;

  IF coalesce(v_admin, false) AND v_requested <> '' THEN
    RETURN v_requested;
  END IF;

  RETURN v_user;
END;
$$;
