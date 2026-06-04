/*
  # Fix RLS policies — restrict by username header

  1. Security Changes
    - Creates a helper function `app_username()` that reads the custom
      `x-app-username` header from the request context. This allows
      row-level security to verify that the caller owns the data they
      are trying to access, even without Supabase Auth sessions.
    - Drops the always-true INSERT/UPDATE/DELETE policies on:
      - `user_records`
      - `user_prefs`
      - `shared_blocks`
    - Replaces them with restrictive policies that check ownership:
      - `user_records`: username must match the request header
      - `user_prefs`: username must match the request header
      - `shared_blocks`: owner_username must match the request header
    - SELECT policies: user_records and user_prefs restricted to own rows;
      shared_blocks keeps existing public-read-if-not-revoked policy.

  2. Important Notes
    - The app does not use Supabase Auth; identity is conveyed via a
      custom `x-app-username` header set on every Supabase client request.
    - The helper function returns '' if no header is set, which means
      no rows will match — safe default (deny-all when header is absent).
    - The existing "Anon can select user_records" and "Anon can select user_prefs"
      policies (USING true) are also replaced with username-scoped versions.
*/

-- Helper function to extract username from request headers
CREATE OR REPLACE FUNCTION public.app_username()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    current_setting('request.header.x-app-username', true),
    ''
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE: user_records
-- ═══════════════════════════════════════════════════════════════════════

-- Drop old permissive policies
DROP POLICY IF EXISTS "Anon can select user_records" ON user_records;
DROP POLICY IF EXISTS "Anon can insert user_records" ON user_records;
DROP POLICY IF EXISTS "Anon can update user_records" ON user_records;
DROP POLICY IF EXISTS "Anon can delete user_records" ON user_records;

-- New restrictive policies scoped by username
CREATE POLICY "Users can select own records"
  ON user_records FOR SELECT
  TO anon, authenticated
  USING (username = public.app_username());

CREATE POLICY "Users can insert own records"
  ON user_records FOR INSERT
  TO anon, authenticated
  WITH CHECK (username = public.app_username());

CREATE POLICY "Users can update own records"
  ON user_records FOR UPDATE
  TO anon, authenticated
  USING (username = public.app_username())
  WITH CHECK (username = public.app_username());

CREATE POLICY "Users can delete own records"
  ON user_records FOR DELETE
  TO anon, authenticated
  USING (username = public.app_username());

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE: user_prefs
-- ═══════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Anon can select user_prefs" ON user_prefs;
DROP POLICY IF EXISTS "Anon can insert user_prefs" ON user_prefs;
DROP POLICY IF EXISTS "Anon can update user_prefs" ON user_prefs;
DROP POLICY IF EXISTS "Anon can delete user_prefs" ON user_prefs;

CREATE POLICY "Users can select own prefs"
  ON user_prefs FOR SELECT
  TO anon, authenticated
  USING (username = public.app_username());

CREATE POLICY "Users can insert own prefs"
  ON user_prefs FOR INSERT
  TO anon, authenticated
  WITH CHECK (username = public.app_username());

CREATE POLICY "Users can update own prefs"
  ON user_prefs FOR UPDATE
  TO anon, authenticated
  USING (username = public.app_username())
  WITH CHECK (username = public.app_username());

CREATE POLICY "Users can delete own prefs"
  ON user_prefs FOR DELETE
  TO anon, authenticated
  USING (username = public.app_username());

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE: shared_blocks
-- ═══════════════════════════════════════════════════════════════════════

-- Keep the existing SELECT policy (public read for non-revoked) — it is already
-- properly restricted to revoked = false.
DROP POLICY IF EXISTS "Anon can insert shared_blocks" ON shared_blocks;
DROP POLICY IF EXISTS "Anon can update shared_blocks" ON shared_blocks;
DROP POLICY IF EXISTS "Anon can delete shared_blocks" ON shared_blocks;

CREATE POLICY "Owner can insert shared_blocks"
  ON shared_blocks FOR INSERT
  TO anon, authenticated
  WITH CHECK (owner_username = public.app_username());

CREATE POLICY "Owner can update shared_blocks"
  ON shared_blocks FOR UPDATE
  TO anon, authenticated
  USING (owner_username = public.app_username())
  WITH CHECK (owner_username = public.app_username());

CREATE POLICY "Owner can delete shared_blocks"
  ON shared_blocks FOR DELETE
  TO anon, authenticated
  USING (owner_username = public.app_username());
