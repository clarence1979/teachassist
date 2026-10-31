/**
 * Standalone body of the context panel — used by the mobile sheet in TopBar.
 * Contains its own data-loading logic so it works independently of ContextPanel.
 */
import { useEffect, useState } from 'react';
import { School, BookOpen, User, FileText, Plus, Trash2, Check, ChevronDown, Upload, Loader2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useAdminDb } from '../db/DbContext';
import { supabase, USERNAME_HEADER } from '../lib/supabaseClient';
import { parseFile } from '../lib/fileParsers';
import { useMemo, useRef } from 'react';

const PREF_TABLE = 'preferences';
const PREF_KEYS = {
  classes: 'context.classes',
  yearLevels: 'context.yearLevels',
  syllabi: 'context.syllabi',
  referenceFiles: 'context.referenceFiles',
  activeClassId: 'context.activeClassId',
  activeYearLevel: 'context.activeYearLevel',
  activeSyllabusId: 'context.activeSyllabusId',
} as const;

const DEFAULT_YEAR_LEVELS = [
  'Prep', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6',
  'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11', 'Year 12', 'Undergraduate',
];

async function remoteLoad<T>(username: string, key: string, fallback: T): Promise<T> {
  if (!username || username === 'default') return fallback;
  const { data, error } = await supabase
    .from('user_records')
    .select('data, deleted')
    .eq('username', username)
    .eq('table_name', PREF_TABLE)
    .eq('record_id', key)
    .setHeader(USERNAME_HEADER, username)
    .maybeSingle();
  if (error || !data || data.deleted) return fallback;
  const payload = data.data as { value?: T } | null;
  return (payload?.value as T) ?? fallback;
}

async function remoteSave(username: string, key: string, value: unknown): Promise<void> {
  if (!username || username === 'default') return;
  await supabase.from('user_records').upsert({
    username,
    table_name: PREF_TABLE,
    record_id: key,
    data: { key, value },
    deleted: false,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'username,table_name,record_id' }).setHeader(USERNAME_HEADER, username);
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

interface ClassEntry { id: string; name: string; }
interface SyllabusEntry { id: string; name: string; }
interface ReferenceFile { id: string; name: string; mediaType: string; size: number; text: string; addedAt: number; }

export function ContextPanelBody() {
  const { viewedAsUser } = useAdminDb();
  const username = viewedAsUser;

  const [classes, setClasses] = useState<ClassEntry[]>([]);
  const [yearLevels, setYearLevels] = useState<string[]>(DEFAULT_YEAR_LEVELS);
  const [syllabi, setSyllabi] = useState<SyllabusEntry[]>([]);
  const [files, setFiles] = useState<ReferenceFile[]>([]);
  const [activeClassId, setActiveClassId] = useState('');
  const [activeYearLevel, setActiveYearLevel] = useState('');
  const [activeSyllabusId, setActiveSyllabusId] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!username || username === 'default') return;
    let cancelled = false;
    setLoaded(false);
    (async () => {
      const [c, y, s, f, ac, ay, as_] = await Promise.all([
        remoteLoad<ClassEntry[]>(username, PREF_KEYS.classes, []),
        remoteLoad<string[]>(username, PREF_KEYS.yearLevels, DEFAULT_YEAR_LEVELS),
        remoteLoad<SyllabusEntry[]>(username, PREF_KEYS.syllabi, []),
        remoteLoad<ReferenceFile[]>(username, PREF_KEYS.referenceFiles, []),
        remoteLoad<string>(username, PREF_KEYS.activeClassId, ''),
        remoteLoad<string>(username, PREF_KEYS.activeYearLevel, ''),
        remoteLoad<string>(username, PREF_KEYS.activeSyllabusId, ''),
      ]);
      if (cancelled) return;
      setClasses(c); setYearLevels(y.length ? y : DEFAULT_YEAR_LEVELS);
      setSyllabi(s); setFiles(f);
      setActiveClassId(ac); setActiveYearLevel(ay); setActiveSyllabusId(as_);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [username]);

  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.classes, classes); }, [username, classes, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.yearLevels, yearLevels); }, [username, yearLevels, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.syllabi, syllabi); }, [username, syllabi, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.referenceFiles, files); }, [username, files, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.activeClassId, activeClassId); }, [username, activeClassId, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.activeYearLevel, activeYearLevel); }, [username, activeYearLevel, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.activeSyllabusId, activeSyllabusId); }, [username, activeSyllabusId, loaded]);

  return (
    <div className="p-4 space-y-5">
      <Section icon={<School size={13} className="text-text-dim" />} title="Active Class">
        <SimpleDropdown
          value={activeClassId}
          options={classes.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="No class selected"
          onChange={setActiveClassId}
        />
      </Section>

      <Section icon={<User size={13} className="text-text-dim" />} title="Year Level">
        <SimpleDropdown
          value={activeYearLevel}
          options={yearLevels.map((y) => ({ value: y, label: y }))}
          placeholder="Not set"
          onChange={setActiveYearLevel}
        />
      </Section>

      <Section icon={<BookOpen size={13} className="text-text-dim" />} title="Syllabus">
        <SimpleDropdown
          value={activeSyllabusId}
          options={syllabi.map((s) => ({ value: s.id, label: s.name }))}
          placeholder="Not attached"
          onChange={setActiveSyllabusId}
        />
      </Section>

      <Section icon={<FileText size={13} className="text-text-dim" />} title="Reference Files">
        <RefFiles files={files} onAdd={(f) => setFiles((p) => [...p, f])} onRemove={(id) => setFiles((p) => p.filter((f) => f.id !== id))} />
      </Section>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </section>
  );
}

function SimpleDropdown({ value, options, placeholder, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = useMemo(() => options.find((o) => o.value === value), [options, value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'w-full flex items-center justify-between gap-2 bg-bg-elevated border border-border rounded-btn px-3 py-2.5 text-xs text-left transition-colors',
          current ? 'text-text-primary' : 'text-text-dim',
          open ? 'border-accent-cyan' : 'hover:border-text-dim',
        )}
      >
        <span className="truncate">{current?.label ?? placeholder}</span>
        <ChevronDown size={12} className={clsx('shrink-0 text-text-dim transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-bg-elevated border border-border rounded shadow-xl max-h-48 overflow-auto">
          {value && (
            <button onClick={() => { onChange(''); setOpen(false); }} className="w-full text-left px-3 py-2 text-[11px] text-text-dim hover:text-text-primary hover:bg-bg-panel transition-colors">
              Clear selection
            </button>
          )}
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={clsx(
                'w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center gap-2',
                o.value === value ? 'text-accent-cyan bg-bg-panel' : 'text-text-secondary hover:text-text-primary hover:bg-bg-panel',
              )}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {o.value === value && <Check size={11} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RefFiles({ files, onAdd, onRemove }: {
  files: ReferenceFile[];
  onAdd: (f: ReferenceFile) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (list: FileList | null) => {
    if (!list) return;
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        const parsed = await parseFile(file);
        if (parsed.kind !== 'file') { setError(`Skipped "${file.name}" — images not supported.`); continue; }
        onAdd({ id: newId('ref'), name: parsed.name, mediaType: parsed.mediaType, size: parsed.size, text: parsed.data, addedAt: Date.now() });
      }
    } catch (e) {
      setError((e as Error).message || 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" multiple accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(e) => handleFiles(e.target.files)} />
      <button onClick={() => inputRef.current?.click()} disabled={busy} className="w-full border border-dashed border-border rounded-btn px-3 py-3 text-xs text-text-dim hover:border-accent-cyan hover:text-text-secondary transition-colors text-left flex items-center gap-2 disabled:opacity-50">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
        {busy ? 'Uploading…' : '+ Upload file'}
      </button>
      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-2 py-2 rounded-btn bg-bg-elevated border border-border text-xs">
              <FileText size={11} className="text-accent-cyan shrink-0" />
              <span className="flex-1 truncate text-text-secondary">{f.name}</span>
              <span className="font-mono text-[9px] text-text-dim shrink-0">{formatBytes(f.size)}</span>
              <button onClick={() => onRemove(f.id)} className="p-0.5 text-text-dim hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
