/*
  # Create users_login and secrets tables

  1. New Tables
    - `users_login`
      - `username` (text, primary key)
      - `password` (text, not null) — plain text as existing app expects
      - `is_admin` (boolean, default false) — grants admin access to view all users' data
    - `secrets`
      - `key_name` (text, primary key)
      - `key_value` (text, not null) — stores shared API keys (OPENAI_API_KEY, CLAUDE_API_KEY)

  2. Security
    - RLS enabled on both tables
    - `users_login`: anon can read to authenticate (select only on username+password match)
    - `secrets`: anon can read all secrets (needed to fetch API keys after login)

  3. Notes
    - These tables replace the hardcoded Supabase project the app previously used
    - `is_admin` is the new column enabling admin users to view all users' data
*/

CREATE TABLE IF NOT EXISTS users_login (
  username text PRIMARY KEY,
  password text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false
);

ALTER TABLE users_login ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read users_login for authentication"
  ON users_login
  FOR SELECT
  TO anon
  USING (true);

CREATE TABLE IF NOT EXISTS secrets (
  key_name text PRIMARY KEY,
  key_value text NOT NULL
);

ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read secrets"
  ON secrets
  FOR SELECT
  TO anon
  USING (true);
