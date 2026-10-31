/*
  # Fix app_username function search_path security

  1. Security Changes
    - Recreates `public.app_username()` with an explicit immutable `search_path`
      set to empty string, preventing search_path manipulation attacks.
*/

CREATE OR REPLACE FUNCTION public.app_username()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    current_setting('request.header.x-app-username', true),
    ''
  );
$$;
