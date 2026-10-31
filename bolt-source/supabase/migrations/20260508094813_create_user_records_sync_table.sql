/*
  # Create user_records sync table

  1. New Tables
    - `user_records`
      - `username` (text) — the owning user's login name
      - `table_name` (text) — logical table: conversations, messages, tasks, timetableBlocks, artifacts, preferences, schoolCalendar
      - `record_id` (text) — the Dexie primary key (uid)
      - `data` (jsonb) — full serialized record
      - `updated_at` (timestamptz) — last write time (used for conflict resolution & incremental sync)
      - `deleted` (boolean) — tombstone flag for soft deletes so other browsers see deletions
      - Composite primary key on (username, table_name, record_id)

  2. Security
    - Enable RLS on `user_records`
    - This app does not use Supabase Auth sessions (user identity is held in localStorage and validated
      against `users_login` on login). To match the existing app's security model, we allow anon
      read/write but the app constrains queries by username. A future migration should migrate to
      proper Supabase Auth for stronger isolation.

  3. Indexes
    - Primary key already indexes (username, table_name, record_id)
    - Additional index on (username, updated_at) for incremental sync queries
*/

CREATE TABLE IF NOT EXISTS user_records (
  username text NOT NULL,
  table_name text NOT NULL,
  record_id text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (username, table_name, record_id)
);

CREATE INDEX IF NOT EXISTS user_records_username_updated_idx
  ON user_records (username, updated_at DESC);

ALTER TABLE user_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_records' AND policyname = 'Anon can select user_records') THEN
    CREATE POLICY "Anon can select user_records"
      ON user_records FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_records' AND policyname = 'Anon can insert user_records') THEN
    CREATE POLICY "Anon can insert user_records"
      ON user_records FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_records' AND policyname = 'Anon can update user_records') THEN
    CREATE POLICY "Anon can update user_records"
      ON user_records FOR UPDATE
      TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_records' AND policyname = 'Anon can delete user_records') THEN
    CREATE POLICY "Anon can delete user_records"
      ON user_records FOR DELETE
      TO anon, authenticated
      USING (true);
  END IF;
END $$;
