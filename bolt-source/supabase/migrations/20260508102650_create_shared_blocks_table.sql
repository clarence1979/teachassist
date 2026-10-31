/*
  # Create shared_blocks table for public timetable block sharing

  1. New Tables
    - `shared_blocks`
      - `id` (text, primary key) — short random share token used as the public URL slug
      - `owner_username` (text) — app-level owner (app uses localStorage-based auth, so this
        is stored for filtering/revocation only, not for RLS enforcement)
      - `block_data` (jsonb) — snapshot of the timetable block (title, type, times, notes, location,
        subtype, color, recurrence flag text)
      - `artifacts_data` (jsonb) — array of artifact snapshots attached to the block
        (each has {id, type, title, mediaType, data, meta})
      - `created_at` (timestamptz) — creation time
      - `updated_at` (timestamptz) — last snapshot refresh
      - `revoked` (boolean) — whether the share link is disabled

  2. Security
    - RLS enabled
    - Anonymous SELECT allowed (these are deliberately public share links — that is the whole point)
      BUT only for rows where `revoked = false`
    - Anonymous INSERT/UPDATE/DELETE allowed because this app does not use Supabase Auth sessions
      (user identity is maintained in localStorage; see existing `user_records` table for the
      same pattern). Future work: migrate to Supabase Auth for per-user isolation.

  3. Indexes
    - Primary key on `id` is sufficient for lookups. Add index on `owner_username` for listing.
*/

CREATE TABLE IF NOT EXISTS shared_blocks (
  id text PRIMARY KEY,
  owner_username text NOT NULL DEFAULT '',
  block_data jsonb NOT NULL,
  artifacts_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS shared_blocks_owner_idx ON shared_blocks (owner_username);

ALTER TABLE shared_blocks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shared_blocks' AND policyname = 'Public can read non-revoked shared_blocks') THEN
    CREATE POLICY "Public can read non-revoked shared_blocks"
      ON shared_blocks FOR SELECT
      TO anon, authenticated
      USING (revoked = false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shared_blocks' AND policyname = 'Anon can insert shared_blocks') THEN
    CREATE POLICY "Anon can insert shared_blocks"
      ON shared_blocks FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shared_blocks' AND policyname = 'Anon can update shared_blocks') THEN
    CREATE POLICY "Anon can update shared_blocks"
      ON shared_blocks FOR UPDATE
      TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shared_blocks' AND policyname = 'Anon can delete shared_blocks') THEN
    CREATE POLICY "Anon can delete shared_blocks"
      ON shared_blocks FOR DELETE
      TO anon, authenticated
      USING (true);
  END IF;
END $$;
