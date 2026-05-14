import { supabase } from './supabaseClient';

/** Remote key/value store for per-user preferences that must follow the user
 *  across devices (active AI model, provider, etc.). */

export async function loadUserPrefs(
  username: string,
): Promise<Record<string, unknown>> {
  if (!username || username === 'default') return {};
  const { data, error } = await supabase
    .from('user_prefs')
    .select('key, value')
    .eq('username', username);
  if (error || !data) return {};
  const out: Record<string, unknown> = {};
  for (const row of data as Array<{ key: string; value: unknown }>) {
    out[row.key] = row.value;
  }
  return out;
}

export async function saveUserPref(
  username: string,
  key: string,
  value: unknown,
): Promise<void> {
  if (!username || username === 'default') return;
  const { error } = await supabase.from('user_prefs').upsert(
    {
      username,
      key,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'username,key' },
  );
  if (error) console.warn('[userPrefs] save failed:', key, error.message);
}
