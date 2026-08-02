import type { PedagogyDB } from './schema';
import { supabase } from '../lib/supabaseClient';

const SYNCED_TABLES = [
  'conversations',
  'messages',
  'tasks',
  'timetableBlocks',
  'artifacts',
  'preferences',
  'schoolCalendar',
] as const;

type SyncedTableName = (typeof SYNCED_TABLES)[number];

const PK_FIELD: Record<SyncedTableName, string> = {
  conversations: 'id',
  messages: 'id',
  tasks: 'id',
  timetableBlocks: 'id',
  artifacts: 'id',
  preferences: 'key',
  schoolCalendar: 'id',
};

interface HookState {
  username: string;
  suppress: boolean;
  attached: boolean;
}

const hookState = new WeakMap<PedagogyDB, HookState>();

function pk(table: SyncedTableName, row: Record<string, unknown>): string | null {
  const k = PK_FIELD[table];
  const v = row[k];
  return typeof v === 'string' ? v : null;
}

/** Rough byte size of a JSON-serialisable value (UTF-16 approximation). */
function approxSize(v: unknown): number {
  try { return JSON.stringify(v).length; } catch { return 0; }
}

/** Supabase upserts time out / 500 on very large payloads. Skip rows above this
 *  threshold — they remain only in local IndexedDB. Typical cause: messages
 *  with inline base64 attachments. */
const MAX_ROW_BYTES = 1_500_000;

/** Record IDs we've recently pushed ourselves — used to suppress realtime echoes
 *  that would otherwise overwrite locally-live data mid-stream. TTL ~5s. */
const recentPushes = new Map<string, number>();
const ECHO_TTL_MS = 5000;

function markPushed(table: SyncedTableName, id: string): void {
  recentPushes.set(`${table}:${id}`, Date.now());
  // Opportunistic cleanup
  if (recentPushes.size > 500) {
    const cutoff = Date.now() - ECHO_TTL_MS;
    for (const [k, t] of recentPushes) if (t < cutoff) recentPushes.delete(k);
  }
}

function isSelfEcho(table: string, id: string): boolean {
  const t = recentPushes.get(`${table}:${id}`);
  return !!t && Date.now() - t < ECHO_TTL_MS;
}

async function pushUpsert(username: string, table: SyncedTableName, row: Record<string, unknown>) {
  const id = pk(table, row);
  if (!id) return;
  if (approxSize(row) > MAX_ROW_BYTES) {
    console.warn('[sync] skipping oversize row:', table, id);
    return;
  }
  markPushed(table, id);
  const { error } = await supabase.from('user_records').upsert({
    username,
    table_name: table,
    record_id: id,
    data: row,
    deleted: false,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'username,table_name,record_id' });
  if (error) console.warn('[sync] upsert failed:', table, id, error.message);
}

async function pushDelete(username: string, table: SyncedTableName, id: string) {
  markPushed(table, id);
  const { error } = await supabase.from('user_records').upsert({
    username,
    table_name: table,
    record_id: id,
    data: { id },
    deleted: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'username,table_name,record_id' });
  if (error) console.warn('[sync] delete failed:', table, id, error.message);
}

const pullCursor = new WeakMap<PedagogyDB, string>();

const PAGE_SIZE = 500;

type SyncRow = { table_name: string; record_id: string; data: Record<string, unknown>; deleted: boolean; updated_at: string };

/** Pull rows for this user from Supabase and populate Dexie. Remote wins.
 *  Uses an incremental updated_at cursor per db+user for subsequent calls.
 *  Paginates in batches of PAGE_SIZE to avoid PostgREST's 1000-row default cap. */
export async function pullFromSupabase(db: PedagogyDB, username: string): Promise<void> {
  if (!username || username === 'default') return;

  // If local IndexedDB looks empty but we have a stale cursor, drop the cursor
  // so we do a full pull. This recovers from browser storage wipes.
  const existingCursor = pullCursor.get(db);
  if (existingCursor) {
    const localCount = await db.timetableBlocks.count().catch(() => 0);
    if (localCount === 0) pullCursor.delete(db);
  }

  const since = pullCursor.get(db);
  const upserts = new Map<SyncedTableName, Array<Record<string, unknown>>>();
  const deletes = new Map<SyncedTableName, string[]>();
  let maxUpdatedAt = since ?? '';

  let offset = 0;
  while (true) {
    let q = supabase
      .from('user_records')
      .select('table_name, record_id, data, deleted, updated_at')
      .eq('username', username)
      .order('updated_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (since) q = q.gt('updated_at', since);
    const { data, error } = await q;

    if (error) {
      console.warn('[sync] pull failed:', error.message);
      return;
    }
    if (!data || data.length === 0) break;

    for (const row of data as SyncRow[]) {
      const t = row.table_name as SyncedTableName;
      if (!SYNCED_TABLES.includes(t)) continue;
      if (row.updated_at && row.updated_at > maxUpdatedAt) maxUpdatedAt = row.updated_at;
      if (row.deleted) {
        if (!deletes.has(t)) deletes.set(t, []);
        deletes.get(t)!.push(row.record_id);
      } else {
        if (!upserts.has(t)) upserts.set(t, []);
        upserts.get(t)!.push(row.data);
      }
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (maxUpdatedAt) pullCursor.set(db, maxUpdatedAt);

  const state = hookState.get(db);
  if (state) state.suppress = true;
  try {
    for (const [table, rows] of upserts) {
      await (db as unknown as Record<string, { bulkPut: (r: unknown[]) => Promise<unknown> }>)[table].bulkPut(rows);
    }
    for (const [table, ids] of deletes) {
      await (db as unknown as Record<string, { bulkDelete: (ids: string[]) => Promise<unknown> }>)[table].bulkDelete(ids);
    }
  } finally {
    if (state) state.suppress = false;
  }
}

/**
 * Register Dexie hooks that mirror mutations to Supabase. Safe to call repeatedly —
 * hooks are only attached once per db instance, and subsequent calls just update
 * which username to push under.
 */
export function configureSync(db: PedagogyDB, username: string): void {
  let state = hookState.get(db);
  if (!state) {
    state = { username, suppress: false, attached: false };
    hookState.set(db, state);
  } else {
    state.username = username;
  }
  if (state.attached) return;
  state.attached = true;

  const s = state;

  for (const table of SYNCED_TABLES) {
    const t = (db as unknown as Record<string, {
      hook: (event: 'creating' | 'updating' | 'deleting', cb: (...args: unknown[]) => void) => void;
    }>)[table];
    if (!t) continue;

    t.hook('creating', (_pkey: unknown, obj: unknown) => {
      if (s.suppress || !s.username || s.username === 'default') return;
      pushUpsert(s.username, table, obj as Record<string, unknown>).catch(() => {});
    });
    t.hook('updating', (mods: unknown, _pkey: unknown, obj: unknown) => {
      if (s.suppress || !s.username || s.username === 'default') return;
      const merged = { ...(obj as Record<string, unknown>), ...(mods as Record<string, unknown>) };
      pushUpsert(s.username, table, merged).catch(() => {});
    });
    t.hook('deleting', (pkey: unknown) => {
      if (s.suppress || !s.username || s.username === 'default') return;
      const id = typeof pkey === 'string' ? pkey : String(pkey);
      pushDelete(s.username, table, id).catch(() => {});
    });
  }
}

/**
 * Push every local row for a user to Supabase, but ONLY for records that do not
 * already exist on the remote. This prevents a stale local copy from overwriting
 * newer changes made on another device.
 *
 * Call AFTER pullFromSupabase so that remote rows have been materialised locally;
 * at that point any local row whose id is not on the remote is truly local-only
 * and safe to push.
 */
export async function pushLocalOnly(db: PedagogyDB, username: string): Promise<void> {
  if (!username || username === 'default') return;

  const remoteIds = new Map<SyncedTableName, Set<string>>();
  let idOffset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('user_records')
      .select('table_name, record_id')
      .eq('username', username)
      .order('table_name', { ascending: true })
      .order('record_id', { ascending: true })
      .range(idOffset, idOffset + PAGE_SIZE - 1);
    if (error) {
      console.warn('[sync] pushLocalOnly: remote index fetch failed:', error.message);
      return;
    }
    for (const r of (data ?? []) as Array<{ table_name: string; record_id: string }>) {
      const t = r.table_name as SyncedTableName;
      if (!SYNCED_TABLES.includes(t)) continue;
      if (!remoteIds.has(t)) remoteIds.set(t, new Set());
      remoteIds.get(t)!.add(r.record_id);
    }
    if (!data || data.length < PAGE_SIZE) break;
    idOffset += PAGE_SIZE;
  }

  for (const table of SYNCED_TABLES) {
    const rows = await (db as unknown as Record<string, { toArray: () => Promise<unknown[]> }>)[table].toArray();
    if (!rows.length) continue;
    const known = remoteIds.get(table) ?? new Set<string>();
    const payload = (rows as Array<Record<string, unknown>>)
      .map((r) => {
        const id = pk(table, r);
        if (!id) return null;
        if (known.has(id)) return null;
        if (approxSize(r) > MAX_ROW_BYTES) {
          console.warn('[sync] pushLocalOnly: skipping oversize row:', table, id);
          return null;
        }
        return {
          username,
          table_name: table,
          record_id: id,
          data: r,
          deleted: false,
          updated_at: new Date().toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (!payload.length) continue;
    const { error: upErr } = await supabase.from('user_records').upsert(payload, {
      onConflict: 'username,table_name,record_id',
    });
    if (upErr) console.warn('[sync] pushLocalOnly upsert failed:', table, upErr.message);
  }
}

/** Deprecated alias — use pushLocalOnly. */
export const pushAll = pushLocalOnly;

/**
 * Reconcile local IndexedDB with Supabase: delete any local row whose id is
 * NOT present in the remote. Used to clean up stale/polluted local data after
 * the server-side source of truth has been purged. Runs with sync hooks
 * suppressed so deletions are not mirrored back to Supabase.
 */
export async function reconcileLocalWithRemote(db: PedagogyDB, username: string): Promise<void> {
  if (!username || username === 'default') return;

  const remoteIds = new Map<SyncedTableName, Set<string>>();
  for (const t of SYNCED_TABLES) remoteIds.set(t, new Set());

  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('user_records')
      .select('table_name, record_id')
      .eq('username', username)
      .eq('deleted', false)
      .order('table_name', { ascending: true })
      .order('record_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.warn('[sync] reconcile: remote index fetch failed:', error.message);
      return;
    }
    for (const r of (data ?? []) as Array<{ table_name: string; record_id: string }>) {
      const t = r.table_name as SyncedTableName;
      if (!SYNCED_TABLES.includes(t)) continue;
      remoteIds.get(t)!.add(r.record_id);
    }
    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Safety: if the remote returned zero IDs across ALL tables, the query likely
  // failed silently (e.g. RLS header mismatch, network issue). Never wipe local
  // data based on an empty remote snapshot.
  let totalRemote = 0;
  for (const ids of remoteIds.values()) totalRemote += ids.size;
  if (totalRemote === 0) {
    console.info('[sync] reconcile: remote returned 0 IDs — skipping deletion to protect local data');
    return;
  }

  const state = hookState.get(db);
  if (state) state.suppress = true;
  try {
    for (const table of SYNCED_TABLES) {
      const tbl = (db as unknown as Record<string, {
        toArray: () => Promise<unknown[]>;
        bulkDelete: (ids: string[]) => Promise<unknown>;
      }>)[table];
      if (!tbl) continue;
      const rows = (await tbl.toArray()) as Array<Record<string, unknown>>;
      const known = remoteIds.get(table) ?? new Set<string>();
      const toDelete: string[] = [];
      for (const row of rows) {
        const id = pk(table, row);
        if (!id || known.has(id)) continue;
        // An oversize row legitimately lives only locally because we never push
        // it to Supabase; don't mistake that for staleness.
        if (approxSize(row) > MAX_ROW_BYTES) continue;
        toDelete.push(id);
      }
      if (toDelete.length) {
        await tbl.bulkDelete(toDelete);
        console.info(`[sync] reconciled ${table}: removed ${toDelete.length} stale local row(s)`);
      }
    }
  } finally {
    if (state) state.suppress = false;
  }
}

// ─── Realtime & polling ───────────────────────────────────────────────────────

const pollTimers = new WeakMap<PedagogyDB, number>();

/**
 * Poll Supabase for remote changes at the given interval. Pass 0 to stop.
 * Uses an `updated_at` cursor so we only pull rows newer than the last sync.
 */
export function setSyncPollInterval(db: PedagogyDB, username: string, intervalMs: number): void {
  const existing = pollTimers.get(db);
  if (existing) {
    window.clearInterval(existing);
    pollTimers.delete(db);
  }
  if (!intervalMs || !username || username === 'default') return;
  const id = window.setInterval(() => {
    pullFromSupabase(db, username).catch(() => {});
  }, intervalMs);
  pollTimers.set(db, id);
}

/**
 * Subscribe to Supabase realtime changes for this user. Returns a cleanup function.
 * On INSERT/UPDATE/DELETE we apply the change directly to Dexie (with sync suppression
 * so we don't echo back to Supabase).
 */
export function subscribeRemoteChanges(db: PedagogyDB, username: string): () => void {
  if (!username || username === 'default') return () => {};

  const channel = supabase
    .channel(`user_records_${username}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_records', filter: `username=eq.${username}` },
      async (payload) => {
        const row = (payload.new ?? payload.old) as
          | { table_name: string; record_id: string; data: Record<string, unknown>; deleted: boolean }
          | undefined;
        if (!row) return;
        const t = row.table_name as SyncedTableName;
        if (!SYNCED_TABLES.includes(t)) return;
        // Drop our own recent writes echoing back — they're already local.
        if (isSelfEcho(t, row.record_id)) return;

        const state = hookState.get(db);
        if (state) state.suppress = true;
        try {
          const tbl = (db as unknown as Record<string, {
            put: (v: unknown) => Promise<unknown>;
            delete: (k: string) => Promise<unknown>;
          }>)[t];
          if (!tbl) return;
          if (payload.eventType === 'DELETE' || row.deleted) {
            await tbl.delete(row.record_id);
          } else {
            await tbl.put(row.data);
          }
        } finally {
          if (state) state.suppress = false;
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
