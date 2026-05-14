/*
  # Enable realtime on user_records

  Adds the `user_records` table to the `supabase_realtime` publication so that
  the web app can receive postgres_changes events for cross-device sync. Also
  sets REPLICA IDENTITY FULL so DELETE payloads include the old row data
  (needed to know which record_id to remove on the receiving client).
*/

ALTER TABLE user_records REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_records;
  END IF;
END $$;
