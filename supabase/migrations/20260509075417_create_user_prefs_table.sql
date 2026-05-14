/*
  # Create user_prefs table for cross-device user preferences

  1. New Tables
    - `user_prefs`
      - `username` (text, PK part) — owning user
      - `key` (text, PK part) — e.g. `activeModel`, `activeProvider`
      - `value` (jsonb) — serialized preference
      - `updated_at` (timestamptz)

  2. Security
    - RLS enabled
    - Matches the existing app security model (no Supabase Auth sessions): anon can
      read/write but the app constrains queries by username.

  3. Notes
    - Used to remember a user's selected AI model/provider across devices so the
      UI doesn't revert to the hardcoded default on every new login.
*/

CREATE TABLE IF NOT EXISTS user_prefs (
  username text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (username, key)
);

CREATE INDEX IF NOT EXISTS user_prefs_username_idx ON user_prefs (username);

ALTER TABLE user_prefs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_prefs' AND policyname = 'Anon can select user_prefs') THEN
    CREATE POLICY "Anon can select user_prefs"
      ON user_prefs FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_prefs' AND policyname = 'Anon can insert user_prefs') THEN
    CREATE POLICY "Anon can insert user_prefs"
      ON user_prefs FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_prefs' AND policyname = 'Anon can update user_prefs') THEN
    CREATE POLICY "Anon can update user_prefs"
      ON user_prefs FOR UPDATE
      TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_prefs' AND policyname = 'Anon can delete user_prefs') THEN
    CREATE POLICY "Anon can delete user_prefs"
      ON user_prefs FOR DELETE
      TO anon, authenticated
      USING (true);
  END IF;
END $$;
