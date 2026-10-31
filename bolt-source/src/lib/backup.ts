import type { PedagogyDB } from '../db/schema';

export interface BackupBundle {
  version: 1;
  exportedAt: string;
  conversations: unknown[];
  messages: unknown[];
  tasks: unknown[];
  timetableBlocks: unknown[];
  artifacts: unknown[];
  preferences: unknown[];
  schoolCalendar: unknown[];
}

export async function exportAll(db: PedagogyDB): Promise<BackupBundle> {
  const [conversations, messages, tasks, timetableBlocks, artifacts, preferences, schoolCalendar] = await Promise.all([
    db.conversations.toArray(),
    db.messages.toArray(),
    db.tasks.toArray(),
    db.timetableBlocks.toArray(),
    db.artifacts.toArray(),
    db.preferences.toArray(),
    db.schoolCalendar.toArray(),
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    conversations, messages, tasks, timetableBlocks, artifacts, preferences, schoolCalendar,
  };
}

export interface ImportResult {
  conversations: number;
  messages: number;
  tasks: number;
  timetableBlocks: number;
  artifacts: number;
  preferences: number;
  schoolCalendar: number;
}

export async function importAll(
  db: PedagogyDB,
  bundle: BackupBundle,
  mode: 'merge' | 'replace' = 'merge',
): Promise<ImportResult> {
  if (bundle.version !== 1) throw new Error(`Unsupported backup version: ${bundle.version}`);

  if (mode === 'replace') {
    await Promise.all([
      db.conversations.clear(), db.messages.clear(), db.tasks.clear(),
      db.timetableBlocks.clear(), db.artifacts.clear(), db.preferences.clear(),
      db.schoolCalendar.clear(),
    ]);
  }

  const put = async <T>(tbl: { bulkPut: (rows: T[]) => Promise<unknown> }, rows: unknown): Promise<number> => {
    if (!Array.isArray(rows)) return 0;
    await tbl.bulkPut(rows as T[]);
    return rows.length;
  };

  const result: ImportResult = {
    conversations: await put(db.conversations, bundle.conversations),
    messages: await put(db.messages, bundle.messages),
    tasks: await put(db.tasks, bundle.tasks),
    timetableBlocks: await put(db.timetableBlocks, bundle.timetableBlocks),
    artifacts: await put(db.artifacts, bundle.artifacts),
    preferences: await put(db.preferences, bundle.preferences),
    schoolCalendar: await put(db.schoolCalendar, bundle.schoolCalendar),
  };
  return result;
}

export function downloadBackup(bundle: BackupBundle): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `pedagogy-backup-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
