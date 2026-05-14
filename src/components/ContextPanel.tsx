import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, School, BookOpen, User, FileText, Plus, Trash2, Check, ChevronDown, Upload, Loader2, PanelRight, ChevronLeft,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../store/appStore';
import { useAdminDb } from '../db/DbContext';
import { supabase } from '../lib/supabaseClient';
import { parseFile } from '../lib/fileParsers';

// ─── Persistence ────────────────────────────────────────────────────────────
//
// Context data (classes / year levels / syllabi / reference files / active
// selections) is stored per-user in the central Supabase `user_records` table
// under table_name = 'preferences'. The client does NOT keep authoritative
// state in localStorage — every load/save is a round-trip to Supabase so the
// same account sees the same context on any device.

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

async function remoteLoad<T>(username: string, key: string, fallback: T): Promise<T> {
  if (!username || username === 'default') return fallback;
  const { data, error } = await supabase
    .from('user_records')
    .select('data, deleted')
    .eq('username', username)
    .eq('table_name', PREF_TABLE)
    .eq('record_id', key)
    .maybeSingle();
  if (error || !data || data.deleted) return fallback;
  const payload = data.data as { value?: T } | null;
  return (payload?.value as T) ?? fallback;
}

async function remoteSave(username: string, key: string, value: unknown): Promise<void> {
  if (!username || username === 'default') return;
  const { error } = await supabase.from('user_records').upsert({
    username,
    table_name: PREF_TABLE,
    record_id: key,
    data: { key, value },
    deleted: false,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'username,table_name,record_id' });
  if (error) console.warn('[context] save failed:', key, error.message);
}

interface ClassEntry { id: string; name: string; }
interface SyllabusEntry { id: string; name: string; }
interface ReferenceFile {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  /** Plain-text contents extracted at upload time (text, pdf, docx, md). Images are skipped. */
  text: string;
  addedAt: number;
}

const DEFAULT_YEAR_LEVELS = [
  'Prep', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6',
  'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11', 'Year 12',
  'Undergraduate',
];

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ContextPanel() {
  const { contextPanelOpen, toggleContextPanel } = useAppStore();
  const { viewedAsUser } = useAdminDb();
  const username = viewedAsUser;

  const [classes, setClasses] = useState<ClassEntry[]>([]);
  const [yearLevels, setYearLevels] = useState<string[]>(DEFAULT_YEAR_LEVELS);
  const [syllabi, setSyllabi] = useState<SyllabusEntry[]>([]);
  const [files, setFiles] = useState<ReferenceFile[]>([]);
  const [activeClassId, setActiveClassId] = useState<string>('');
  const [activeYearLevel, setActiveYearLevel] = useState<string>('');
  const [activeSyllabusId, setActiveSyllabusId] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  // Load from Supabase whenever the panel opens or the user changes
  useEffect(() => {
    if (!contextPanelOpen || !username || username === 'default') return;
    let cancelled = false;
    setLoaded(false);
    (async () => {
      const [c, y, s, f, ac, ay, as] = await Promise.all([
        remoteLoad<ClassEntry[]>(username, PREF_KEYS.classes, []),
        remoteLoad<string[]>(username, PREF_KEYS.yearLevels, DEFAULT_YEAR_LEVELS),
        remoteLoad<SyllabusEntry[]>(username, PREF_KEYS.syllabi, []),
        remoteLoad<ReferenceFile[]>(username, PREF_KEYS.referenceFiles, []),
        remoteLoad<string>(username, PREF_KEYS.activeClassId, ''),
        remoteLoad<string>(username, PREF_KEYS.activeYearLevel, ''),
        remoteLoad<string>(username, PREF_KEYS.activeSyllabusId, ''),
      ]);
      if (cancelled) return;
      setClasses(c);
      setYearLevels(y.length ? y : DEFAULT_YEAR_LEVELS);
      setSyllabi(s);
      setFiles(f);
      setActiveClassId(ac);
      setActiveYearLevel(ay);
      setActiveSyllabusId(as);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [username, contextPanelOpen]);

  // Persist changes directly to Supabase
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.classes, classes); }, [username, classes, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.yearLevels, yearLevels); }, [username, yearLevels, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.syllabi, syllabi); }, [username, syllabi, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.referenceFiles, files); }, [username, files, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.activeClassId, activeClassId); }, [username, activeClassId, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.activeYearLevel, activeYearLevel); }, [username, activeYearLevel, loaded]);
  useEffect(() => { if (loaded) void remoteSave(username, PREF_KEYS.activeSyllabusId, activeSyllabusId); }, [username, activeSyllabusId, loaded]);

  // Collapsed icon-strip state
  if (!contextPanelOpen) {
    return (
      <aside className="w-10 shrink-0 bg-bg-panel border-l border-border flex flex-col items-center pt-2 gap-2 transition-all duration-200">
        <button
          onClick={toggleContextPanel}
          aria-label="Open context panel"
          title="Open Context panel"
          className="p-2 rounded-btn text-text-dim hover:text-accent-cyan hover:bg-bg-elevated transition-colors"
        >
          <PanelRight size={14} />
        </button>
        {/* Active indicator dots */}
        {activeClassId && (
          <div title="Class set" className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
        )}
        {activeYearLevel && (
          <div title="Year level set" className="w-1.5 h-1.5 rounded-full bg-accent-green" />
        )}
        {activeSyllabusId && (
          <div title="Syllabus set" className="w-1.5 h-1.5 rounded-full bg-accent-amber" />
        )}
        {files.length > 0 && (
          <div title={`${files.length} reference file(s)`} className="w-1.5 h-1.5 rounded-full bg-accent-red" />
        )}
      </aside>
    );
  }

  return (
    <aside className="w-72 shrink-0 bg-bg-panel border-l border-border flex flex-col h-full transition-all duration-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-rajdhani font-semibold text-sm text-text-primary">Context</span>
        <button
          onClick={toggleContextPanel}
          aria-label="Collapse context panel"
          title="Collapse"
          className="p-1 rounded-btn text-text-dim hover:text-accent-cyan transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <ClassSection
          classes={classes}
          activeId={activeClassId}
          onSetActive={setActiveClassId}
          onAdd={(name) => setClasses((cs) => [...cs, { id: newId('cls'), name }])}
          onRename={(id, name) => setClasses((cs) => cs.map((c) => c.id === id ? { ...c, name } : c))}
          onRemove={(id) => {
            setClasses((cs) => cs.filter((c) => c.id !== id));
            if (activeClassId === id) setActiveClassId('');
          }}
        />

        <YearLevelSection
          yearLevels={yearLevels}
          active={activeYearLevel}
          onSetActive={setActiveYearLevel}
          onAdd={(v) => setYearLevels((ys) => ys.includes(v) ? ys : [...ys, v])}
          onRemove={(v) => {
            setYearLevels((ys) => ys.filter((y) => y !== v));
            if (activeYearLevel === v) setActiveYearLevel('');
          }}
        />

        <SyllabusSection
          syllabi={syllabi}
          activeId={activeSyllabusId}
          onSetActive={setActiveSyllabusId}
          onAdd={(name) => setSyllabi((s) => [...s, { id: newId('syl'), name }])}
          onRename={(id, name) => setSyllabi((s) => s.map((x) => x.id === id ? { ...x, name } : x))}
          onRemove={(id) => {
            setSyllabi((s) => s.filter((x) => x.id !== id));
            if (activeSyllabusId === id) setActiveSyllabusId('');
          }}
        />

        <ReferenceFilesSection
          files={files}
          onAdd={(f) => setFiles((prev) => [...prev, f])}
          onRemove={(id) => setFiles((prev) => prev.filter((f) => f.id !== id))}
        />
      </div>
    </aside>
  );
}

// ─── Class section ──────────────────────────────────────────────────────────

function ClassSection({
  classes, activeId, onSetActive, onAdd, onRename, onRemove,
}: {
  classes: ClassEntry[];
  activeId: string;
  onSetActive: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  return (
    <section>
      <SectionHeader Icon={School} title="Active Class" />
      <Dropdown
        placeholder="No class selected"
        value={activeId}
        options={classes.map((c) => ({ value: c.id, label: c.name }))}
        onChange={onSetActive}
        onManage={() => setManageOpen(true)}
        manageLabel="Manage classes"
      />
      {manageOpen && (
        <ManageListModal
          title="Classes"
          items={classes.map((c) => ({ id: c.id, label: c.name }))}
          onAdd={(name) => onAdd(name)}
          onRename={(id, name) => onRename(id, name)}
          onRemove={onRemove}
          onClose={() => setManageOpen(false)}
          placeholder="e.g. 8B Digital Tech"
        />
      )}
    </section>
  );
}

// ─── Year level section ─────────────────────────────────────────────────────

function YearLevelSection({
  yearLevels, active, onSetActive, onAdd, onRemove,
}: {
  yearLevels: string[];
  active: string;
  onSetActive: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  return (
    <section>
      <SectionHeader Icon={User} title="Year Level" />
      <Dropdown
        placeholder="Not set"
        value={active}
        options={yearLevels.map((y) => ({ value: y, label: y }))}
        onChange={onSetActive}
        onManage={() => setManageOpen(true)}
        manageLabel="Manage year levels"
      />
      {manageOpen && (
        <ManageListModal
          title="Year levels"
          items={yearLevels.map((y) => ({ id: y, label: y }))}
          onAdd={(name) => onAdd(name)}
          onRename={() => {/* year levels are value-keyed, rename is equivalent to remove+add */}}
          onRemove={onRemove}
          onClose={() => setManageOpen(false)}
          placeholder="e.g. Year 13"
          disableRename
        />
      )}
    </section>
  );
}

// ─── Syllabus section ───────────────────────────────────────────────────────

function SyllabusSection({
  syllabi, activeId, onSetActive, onAdd, onRename, onRemove,
}: {
  syllabi: SyllabusEntry[];
  activeId: string;
  onSetActive: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  return (
    <section>
      <SectionHeader Icon={BookOpen} title="Syllabus" />
      <Dropdown
        placeholder="Not attached"
        value={activeId}
        options={syllabi.map((s) => ({ value: s.id, label: s.name }))}
        onChange={onSetActive}
        onManage={() => setManageOpen(true)}
        manageLabel="Manage syllabi"
      />
      {manageOpen && (
        <ManageListModal
          title="Syllabi"
          items={syllabi.map((s) => ({ id: s.id, label: s.name }))}
          onAdd={onAdd}
          onRename={onRename}
          onRemove={onRemove}
          onClose={() => setManageOpen(false)}
          placeholder="e.g. VCE Biology Unit 3"
        />
      )}
    </section>
  );
}

// ─── Reference files section ────────────────────────────────────────────────

function ReferenceFilesSection({
  files, onAdd, onRemove,
}: {
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
        if (parsed.kind !== 'file') {
          setError(`Skipped "${file.name}" — images are not supported as reference files. Attach them to a message instead.`);
          continue;
        }
        onAdd({
          id: newId('ref'),
          name: parsed.name,
          mediaType: parsed.mediaType,
          size: parsed.size,
          text: parsed.data,
          addedAt: Date.now(),
        });
      }
    } catch (e) {
      setError((e as Error).message || 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <section>
      <SectionHeader Icon={FileText} title="Reference Files" />
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="w-full border border-dashed border-border rounded-btn px-3 py-2 text-xs text-text-dim hover:border-accent-cyan hover:text-text-secondary transition-colors text-left flex items-center gap-2 disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
        {busy ? 'Uploading…' : '+ Upload file'}
      </button>
      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-btn bg-bg-elevated border border-border text-xs"
            >
              <FileText size={11} className="text-accent-cyan shrink-0" />
              <span className="flex-1 truncate text-text-secondary" title={f.name}>{f.name}</span>
              <span className="font-mono text-[9px] text-text-dim shrink-0">
                {formatBytes(f.size)}
              </span>
              <button
                onClick={() => onRemove(f.id)}
                aria-label={`Remove ${f.name}`}
                className="p-0.5 text-text-dim hover:text-red-400 transition-colors"
              >
                <Trash2 size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Shared UI ──────────────────────────────────────────────────────────────

function SectionHeader({ Icon, title }: { Icon: typeof School; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon size={13} className="text-text-dim" />
      <span className="text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider">
        {title}
      </span>
    </div>
  );
}

interface DropdownOption { value: string; label: string; }

function Dropdown({
  value, options, placeholder, onChange, onManage, manageLabel,
}: {
  value: string;
  options: DropdownOption[];
  placeholder: string;
  onChange: (v: string) => void;
  onManage?: () => void;
  manageLabel?: string;
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
        aria-expanded={open}
        aria-haspopup="listbox"
        className={clsx(
          'w-full flex items-center justify-between gap-2 bg-bg-elevated border border-border rounded-btn px-3 py-2 text-xs text-left transition-colors',
          current ? 'text-text-primary' : 'text-text-dim',
          open ? 'border-accent-cyan' : 'hover:border-text-dim',
        )}
      >
        <span className="truncate">{current?.label ?? placeholder}</span>
        <ChevronDown size={12} className={clsx('shrink-0 text-text-dim transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-bg-elevated border border-border rounded shadow-xl max-h-64 overflow-auto">
          {options.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-text-dim italic">Nothing added yet.</div>
          )}
          {value && (
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-text-dim hover:text-text-primary hover:bg-bg-panel transition-colors"
            >
              Clear selection
            </button>
          )}
          <ul role="listbox">
            {options.map((o) => (
              <li key={o.value}>
                <button
                  role="option"
                  aria-selected={o.value === value}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={clsx(
                    'w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2',
                    o.value === value
                      ? 'text-accent-cyan bg-bg-panel'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-panel',
                  )}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.value === value && <Check size={11} className="shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
          {onManage && (
            <div className="border-t border-border">
              <button
                onClick={() => { setOpen(false); onManage(); }}
                className="w-full text-left px-3 py-2 text-[11px] text-accent-cyan hover:bg-bg-panel transition-colors font-rajdhani font-semibold uppercase tracking-wider"
              >
                {manageLabel ?? 'Manage'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ManageItem { id: string; label: string; }

function ManageListModal({
  title, items, onAdd, onRename, onRemove, onClose, placeholder, disableRename,
}: {
  title: string;
  items: ManageItem[];
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  placeholder?: string;
  disableRename?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const submitNew = () => {
    const v = draft.trim();
    if (!v) return;
    onAdd(v);
    setDraft('');
  };

  const startEdit = (item: ManageItem) => {
    setEditingId(item.id);
    setEditDraft(item.label);
  };
  const commitEdit = () => {
    if (!editingId) return;
    const v = editDraft.trim();
    if (v) onRename(editingId, v);
    setEditingId(null);
    setEditDraft('');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-bg-panel border border-border rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-elevated">
          <h3 className="font-rajdhani font-bold text-sm text-text-primary uppercase tracking-wide">
            Manage {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-text-dim hover:text-accent-cyan transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitNew()}
              placeholder={placeholder ?? `Add ${title.toLowerCase()}`}
              className="input flex-1"
              autoFocus
            />
            <button
              onClick={submitNew}
              disabled={!draft.trim()}
              className="px-3 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 transition-colors flex items-center gap-1"
            >
              <Plus size={12} /> Add
            </button>
          </div>

          {items.length === 0 ? (
            <p className="text-xs text-text-dim italic">Nothing here yet.</p>
          ) : (
            <ul className="space-y-1">
              {items.map((item) => {
                const isEditing = editingId === item.id;
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-btn bg-bg-elevated border border-border"
                  >
                    {isEditing ? (
                      <input
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit();
                          if (e.key === 'Escape') { setEditingId(null); setEditDraft(''); }
                        }}
                        onBlur={commitEdit}
                        autoFocus
                        className="input flex-1 !py-1 text-xs"
                      />
                    ) : (
                      <span className="flex-1 truncate text-xs text-text-primary" title={item.label}>
                        {item.label}
                      </span>
                    )}
                    {!disableRename && !isEditing && (
                      <button
                        onClick={() => startEdit(item)}
                        aria-label={`Rename ${item.label}`}
                        className="text-[10px] font-rajdhani font-semibold uppercase tracking-wider text-text-dim hover:text-accent-cyan transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => onRemove(item.id)}
                      aria-label={`Remove ${item.label}`}
                      className="p-0.5 text-text-dim hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
