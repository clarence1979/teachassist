import { useState, useMemo, useRef, useCallback } from 'react';

// Web Speech API types (not in lib.dom.d.ts for all targets)
interface SpeechRecognitionResultItem { transcript: string; }
interface SpeechRecognitionResult { [i: number]: SpeechRecognitionResultItem; }
interface SpeechRecognitionResultList { [i: number]: SpeechRecognitionResult; }
interface SpeechRecognitionEvt extends Event { results: SpeechRecognitionResultList; }
interface SR {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEvt) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
}
interface SRConstructor { new(): SR; }
type WindowWithSpeech = Window & { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor; };
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CheckSquare, Plus, Mic, MicOff, Sparkles, X, Trash2,
  Tag, Calendar, Clock, Filter, List, LayoutGrid,
  AlertTriangle, Edit3, Check, Loader2, Info,
  CheckCircle2, Circle, ArrowRight, Zap,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDb } from '../db/DbContext';
import { tasksRepo } from '../db/repos';
import { useCredentials } from '../contexts/CredentialsContext';
import { useAppStore } from '../store/appStore';
import { complete } from '../lib/llm';
import type { Task } from '../db/schema';

// ─── Constants ────────────────────────────────────────────────────────────────

type ViewMode = 'list' | 'kanban' | 'eisenhower';

const PRIORITY_LABELS: Record<number, string> = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low', 5: 'Someday' };
const PRIORITY_COLORS: Record<number, { text: string; bg: string; border: string; dot: string }> = {
  1: { text: 'text-red-400',       bg: 'bg-red-500/10',       border: 'border-red-500/40',      dot: 'bg-red-400' },
  2: { text: 'text-accent-amber',  bg: 'bg-accent-amber/10',  border: 'border-accent-amber/40', dot: 'bg-accent-amber' },
  3: { text: 'text-accent-cyan',   bg: 'bg-accent-cyan/10',   border: 'border-accent-cyan/40',  dot: 'bg-accent-cyan' },
  4: { text: 'text-accent-green',  bg: 'bg-accent-green/10',  border: 'border-accent-green/40', dot: 'bg-accent-green' },
  5: { text: 'text-text-dim',      bg: 'bg-bg-elevated',      border: 'border-border',          dot: 'bg-text-dim' },
};

const STATUS_LABELS: Record<Task['status'], string> = {
  inbox: 'Inbox', scheduled: 'Scheduled', 'in-progress': 'In Progress', done: 'Done',
};
const STATUS_COLORS: Record<Task['status'], string> = {
  inbox: 'text-text-secondary', scheduled: 'text-accent-cyan', 'in-progress': 'text-accent-amber', done: 'text-accent-green',
};
const STATUS_ICONS: Record<Task['status'], typeof Circle> = {
  inbox: Circle, scheduled: Calendar, 'in-progress': ArrowRight, done: CheckCircle2,
};
const STATUS_CYCLE: Task['status'][] = ['inbox', 'in-progress', 'done', 'scheduled'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDeadline(ts: number): string {
  const diffDays = Math.ceil((ts - Date.now()) / 86400000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays < 7) return `In ${diffDays}d`;
  return new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function deadlineCls(ts: number): string {
  const d = Math.ceil((ts - Date.now()) / 86400000);
  if (d < 0) return 'text-red-400';
  if (d <= 1) return 'text-accent-amber';
  if (d <= 3) return 'text-accent-cyan';
  return 'text-text-dim';
}

function toDateInput(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toISOString().slice(0, 10);
}

function parseDateInput(s: string): number | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d.getTime();
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) return text;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start);
}

// ─── AI helpers ───────────────────────────────────────────────────────────────

async function parseTaskNL(text: string, provider: 'anthropic' | 'openai', model: string, apiKey: string): Promise<Partial<Task>> {
  const today = new Date().toISOString().slice(0, 10);
  const { text: raw } = await complete({
    provider, model, apiKey,
    system: `You are a task parser. Today is ${today}. Output ONLY valid JSON, no prose.`,
    messages: [{
      role: 'user',
      content: `Parse this task description into JSON fields:\n"${text}"\n\nReturn JSON with optional fields:\n- title: string\n- description: string\n- deadline: string (YYYY-MM-DD, infer from "by Friday" etc relative to today)\n- estimatedDurationMin: number\n- priority: 1-5 (1=critical, 3=medium, 5=someday)\n- tags: string[]\n\nAlways include title.`,
    }],
    maxTokens: 400, temperature: 0.1,
  });
  try {
    const p = JSON.parse(extractJson(raw));
    const result: Partial<Task> = {};
    if (p.title) result.title = String(p.title);
    if (p.description) result.description = String(p.description);
    if (p.deadline) { const d = new Date(p.deadline); if (!isNaN(d.getTime())) result.deadline = d.getTime(); }
    if (p.estimatedDurationMin) result.estimatedDurationMin = Number(p.estimatedDurationMin);
    if (p.priority >= 1 && p.priority <= 5) result.priority = p.priority as Task['priority'];
    if (Array.isArray(p.tags)) result.tags = p.tags.map(String);
    return result;
  } catch { return { title: text.trim() }; }
}

async function reprioritiseTasks(tasks: Task[], apiKey: string): Promise<Array<{ id: string; priority: number; rationale: string }>> {
  const today = new Date().toISOString();
  const list = tasks.map((t) => ({
    id: t.id, title: t.title, priority: t.priority, status: t.status,
    deadline: t.deadline ? new Date(t.deadline).toISOString().slice(0, 10) : null,
    estimatedDurationMin: t.estimatedDurationMin, tags: t.tags,
  }));
  const { text: raw } = await complete({
    provider: 'openai', model: 'gpt-4o-mini', apiKey,
    system: `You are an expert teacher workload prioritisation assistant. Today is ${today}.\n\nPrioritisation algorithm:\n- Weight = (deadline_proximity × importance_weight) / estimated_duration\n- deadline_proximity: overdue=10, today=8, 1d=6, 3d=4, 1w=2, >1w=1\n- importance_weight: marking/assessment=5, lesson prep=4, admin=3, personal=2\n- Cognitively heavy tasks (planning, creating) go earlier; admin tasks later\n- Flag overdue items as critical\n\nOutput ONLY a JSON array: [{id, priority (1-5), rationale (one short sentence)}]`,
    messages: [{ role: 'user', content: `Re-prioritise these ${tasks.length} tasks:\n${JSON.stringify(list, null, 2)}` }],
    maxTokens: 2000, temperature: 0.3,
  });
  const s = raw.indexOf('['), e = raw.lastIndexOf(']');
  if (s === -1 || e === -1) throw new Error('No JSON array in AI response');
  return JSON.parse(raw.slice(s, e + 1));
}

// ─── Task form ────────────────────────────────────────────────────────────────

function TaskForm({ initial, onSave, onCancel }: { initial?: Partial<Task>; onSave: (t: Partial<Task>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [priority, setPriority] = useState<Task['priority']>(initial?.priority ?? 3);
  const [status, setStatus] = useState<Task['status']>(initial?.status ?? 'inbox');
  const [deadline, setDeadline] = useState(toDateInput(initial?.deadline));
  const [duration, setDuration] = useState(String(initial?.estimatedDurationMin ?? 30));
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [recurrence, setRecurrence] = useState(initial?.recurrence ?? '');

  const addTag = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags((p) => [...p, t]);
    setTagInput('');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), description: description.trim() || undefined, priority, status, deadline: parseDateInput(deadline), estimatedDurationMin: parseInt(duration) || 30, tags, recurrence: recurrence.trim() || undefined });
  };

  return (
    <form onSubmit={submit} className="space-y-3 p-4 bg-bg-panel border border-border rounded-lg shadow-xl">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title *" className="input text-sm py-2 font-semibold" required />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="input text-sm py-2 resize-none" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1">Priority</div>
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as Task['priority'])} className="input text-xs py-1.5">
            {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>{p} — {PRIORITY_LABELS[p]}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1">Status</div>
          <select value={status} onChange={(e) => setStatus(e.target.value as Task['status'])} className="input text-xs py-1.5">
            {(Object.keys(STATUS_LABELS) as Task['status'][]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1">Deadline</div>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input text-xs py-1.5" />
        </div>
        <div>
          <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1">Est. duration (min)</div>
          <input type="number" min={1} max={480} value={duration} onChange={(e) => setDuration(e.target.value)} className="input text-xs py-1.5" />
        </div>
      </div>
      <div>
        <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1">Tags</div>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {tags.map((t) => (
            <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-bg-elevated border border-border text-text-secondary">
              {t}<button type="button" onClick={() => setTags((a) => a.filter((x) => x !== t))} className="text-text-dim hover:text-red-400 transition-colors"><X size={9} /></button>
            </span>
          ))}
        </div>
        <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={addTag} placeholder="Add tag, press Enter…" className="input text-xs py-1.5" />
      </div>
      <div>
        <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1">Recurrence (RRULE, optional)</div>
        <input value={recurrence} onChange={(e) => setRecurrence(e.target.value)} placeholder="FREQ=WEEKLY;BYDAY=MO" className="input text-xs py-1.5 font-mono" />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Cancel</button>
        <button type="submit" disabled={!title.trim()} className="flex-1 px-3 py-2 rounded-btn bg-accent-green text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"><Check size={13} />Save</button>
      </div>
    </form>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({ task, selected, onSelect, onEdit, onDelete, onStatusCycle }: {
  task: Task; selected: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void; onStatusCycle: () => void;
}) {
  const pc = PRIORITY_COLORS[task.priority];
  const StatusIcon = STATUS_ICONS[task.status];
  const [showTip, setShowTip] = useState(false);

  return (
    <div className={clsx('group flex items-start gap-3 px-4 py-3 border-b border-border transition-colors', selected ? 'bg-accent-green/5' : 'hover:bg-bg-elevated')}>
      <button onClick={onSelect} className="shrink-0 mt-0.5 text-text-dim hover:text-accent-green transition-colors">
        {selected ? <CheckSquare size={14} className="text-accent-green" /> : <div className="w-[14px] h-[14px] border border-border rounded" />}
      </button>
      <button onClick={onStatusCycle} className={clsx('shrink-0 mt-0.5 transition-colors hover:brightness-125', STATUS_COLORS[task.status])}>
        <StatusIcon size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={clsx('text-sm font-rajdhani font-semibold leading-snug', task.status === 'done' && 'line-through text-text-dim')}>{task.title}</span>
          {task.aiRationale && (
            <div className="relative">
              <button onMouseEnter={() => setShowTip(true)} onMouseLeave={() => setShowTip(false)} className="p-0.5 text-accent-cyan hover:brightness-125 transition-colors">
                <Info size={11} />
              </button>
              {showTip && (
                <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2.5 bg-bg-elevated border border-border rounded-lg text-[11px] text-text-secondary leading-relaxed shadow-2xl pointer-events-none">
                  <div className="flex items-center gap-1 mb-1 text-accent-cyan font-mono text-[9px] uppercase tracking-wider"><Sparkles size={8} />AI rationale</div>
                  {task.aiRationale}
                </div>
              )}
            </div>
          )}
        </div>
        {task.description && <p className="text-[11px] text-text-dim mt-0.5 line-clamp-1">{task.description}</p>}
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <span className={clsx('flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border', pc.text, pc.bg, pc.border)}>
            <span className={clsx('w-1.5 h-1.5 rounded-full', pc.dot)} />{PRIORITY_LABELS[task.priority]}
          </span>
          {task.deadline && (
            <span className={clsx('flex items-center gap-1 text-[10px] font-mono', deadlineCls(task.deadline))}>
              <Calendar size={9} />{fmtDeadline(task.deadline)}
            </span>
          )}
          {task.estimatedDurationMin > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-text-dim">
              <Clock size={9} />{task.estimatedDurationMin >= 60 ? `${(task.estimatedDurationMin / 60).toFixed(1)}h` : `${task.estimatedDurationMin}m`}
            </span>
          )}
          {task.tags.slice(0, 3).map((t) => (
            <span key={t} className="px-1.5 py-0.5 rounded text-[9px] bg-bg-elevated border border-border text-text-dim">{t}</span>
          ))}
          {task.tags.length > 3 && <span className="text-[9px] text-text-dim font-mono">+{task.tags.length - 3}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={onEdit} className="p-1.5 rounded text-text-dim hover:text-accent-cyan hover:bg-accent-cyan/10 transition-colors"><Edit3 size={13} /></button>
        <button onClick={onDelete} className="p-1.5 rounded text-text-dim hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

// ─── Kanban card ──────────────────────────────────────────────────────────────

function KanbanCard({ task, onEdit, onDelete, onStatusChange }: {
  task: Task; onEdit: () => void; onDelete: () => void; onStatusChange: (s: Task['status']) => void;
}) {
  const pc = PRIORITY_COLORS[task.priority];
  return (
    <div className={clsx('group relative p-3 rounded-lg border bg-bg-panel transition-all hover:-translate-y-0.5 hover:shadow-md cursor-default', pc.border)}>
      <div className={clsx('absolute top-0 left-0 right-0 h-0.5 rounded-t-lg', pc.dot)} />
      <div className="text-sm font-rajdhani font-semibold text-text-primary leading-snug mb-2">{task.title}</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {task.deadline && <span className={clsx('text-[9px] font-mono flex items-center gap-0.5', deadlineCls(task.deadline))}><Calendar size={8} />{fmtDeadline(task.deadline)}</span>}
        {task.estimatedDurationMin > 0 && <span className="text-[9px] font-mono text-text-dim flex items-center gap-0.5"><Clock size={8} />{task.estimatedDurationMin}m</span>}
      </div>
      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.tags.slice(0, 2).map((t) => <span key={t} className="px-1.5 py-0.5 rounded text-[9px] bg-bg-elevated border border-border text-text-dim">{t}</span>)}
          {task.tags.length > 2 && <span className="text-[9px] text-text-dim">+{task.tags.length - 2}</span>}
        </div>
      )}
      <div className="flex items-center justify-between gap-1">
        <select value={task.status} onChange={(e) => onStatusChange(e.target.value as Task['status'])} className="text-[9px] font-mono bg-transparent border-none text-text-dim focus:outline-none cursor-pointer hover:text-text-primary transition-colors" onClick={(e) => e.stopPropagation()}>
          {(Object.keys(STATUS_LABELS) as Task['status'][]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="p-0.5 text-text-dim hover:text-accent-cyan transition-colors"><Edit3 size={11} /></button>
          <button onClick={onDelete} className="p-0.5 text-text-dim hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
        </div>
      </div>
    </div>
  );
}

// ─── Eisenhower matrix ────────────────────────────────────────────────────────

function EisenhowerMatrix({ tasks, onEdit, onDelete }: { tasks: Task[]; onEdit: (t: Task) => void; onDelete: (id: string) => void }) {
  const quadrants = useMemo(() => {
    const ui: Task[] = [], nui: Task[] = [], uni: Task[] = [], nuni: Task[] = [];
    for (const t of tasks) {
      const daysLeft = t.deadline ? Math.ceil((t.deadline - Date.now()) / 86400000) : 999;
      const urgent = daysLeft <= 3 || t.priority <= 2;
      const important = t.priority <= 3;
      if (urgent && important) ui.push(t);
      else if (!urgent && important) nui.push(t);
      else if (urgent && !important) uni.push(t);
      else nuni.push(t);
    }
    return [
      { label: 'DO FIRST', sub: 'Urgent + Important', color: 'border-red-500/40 bg-red-500/5', hcolor: 'text-red-400', tasks: ui },
      { label: 'SCHEDULE', sub: 'Not Urgent + Important', color: 'border-accent-cyan/40 bg-accent-cyan/5', hcolor: 'text-accent-cyan', tasks: nui },
      { label: 'DELEGATE', sub: 'Urgent + Not Important', color: 'border-accent-amber/40 bg-accent-amber/5', hcolor: 'text-accent-amber', tasks: uni },
      { label: 'ELIMINATE', sub: 'Not Urgent + Not Important', color: 'border-border bg-bg-elevated/30', hcolor: 'text-text-dim', tasks: nuni },
    ];
  }, [tasks]);

  return (
    <div className="grid grid-cols-2 gap-4" style={{ minHeight: 480 }}>
      {quadrants.map((q) => (
        <div key={q.label} className={clsx('rounded-lg border p-3 flex flex-col overflow-hidden', q.color)}>
          <div className="shrink-0 mb-3">
            <div className={clsx('font-orbitron text-xs font-bold tracking-widest', q.hcolor)}>{q.label}</div>
            <div className="text-[10px] font-mono text-text-dim">{q.sub} · {q.tasks.length} task{q.tasks.length !== 1 ? 's' : ''}</div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            {q.tasks.length === 0 && <div className="text-[10px] text-text-dim font-mono italic">Empty</div>}
            {q.tasks.map((t) => (
              <div key={t.id} className="group flex items-start gap-2 p-2.5 rounded bg-bg-panel border border-border">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-rajdhani font-semibold text-text-primary leading-snug">{t.title}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {t.deadline && <span className={clsx('text-[9px] font-mono', deadlineCls(t.deadline))}>{fmtDeadline(t.deadline)}</span>}
                    {t.estimatedDurationMin > 0 && <span className="text-[9px] font-mono text-text-dim">{t.estimatedDurationMin}m</span>}
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => onEdit(t)} className="p-0.5 text-text-dim hover:text-accent-cyan transition-colors"><Edit3 size={10} /></button>
                  <button onClick={() => onDelete(t.id)} className="p-0.5 text-text-dim hover:text-red-400 transition-colors"><Trash2 size={10} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function TodoView() {
  const db = useDb();
  const { getKey } = useCredentials();
  const { activeProvider, activeModel } = useAppStore();
  const tasks = useLiveQuery(() => tasksRepo.list(db), [db]) ?? [];

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<Set<Task['status']>>(new Set());
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const [filterPriority, setFilterPriority] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [quickAdd, setQuickAdd] = useState('');
  const [quickParsing, setQuickParsing] = useState(false);
  const [reprioritising, setReprioritising] = useState(false);
  const [reprioritiseError, setReprioritiseError] = useState('');
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [showBulkTag, setShowBulkTag] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SR | null>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) for (const tag of t.tags) s.add(tag);
    return [...s].sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    let list = [...tasks];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || t.tags.some((tag) => tag.includes(q)));
    }
    if (filterStatus.size > 0) list = list.filter((t) => filterStatus.has(t.status));
    if (filterTags.size > 0) list = list.filter((t) => t.tags.some((tag) => filterTags.has(tag)));
    if (filterPriority !== null) list = list.filter((t) => t.priority === filterPriority);
    return list;
  }, [tasks, search, filterStatus, filterTags, filterPriority]);

  const activeFilters = filterStatus.size + filterTags.size + (filterPriority !== null ? 1 : 0);

  const toggleSelect = useCallback((id: string) => setSelected((p) => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  }), []);

  const handleQuickAdd = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !quickAdd.trim()) return;
    const text = quickAdd.trim();
    setQuickAdd('');
    const apiKey = getKey(activeProvider);
    let parsed: Partial<Task> = { title: text };
    if (apiKey) {
      setQuickParsing(true);
      try { parsed = await parseTaskNL(text, activeProvider, activeModel, apiKey); } catch { /* fallback */ }
      setQuickParsing(false);
    }
    await tasksRepo.create(db, {
      title: parsed.title ?? text, description: parsed.description,
      priority: parsed.priority ?? 3, status: 'inbox', deadline: parsed.deadline,
      estimatedDurationMin: parsed.estimatedDurationMin ?? 30,
      tags: parsed.tags ?? [], scheduledBlocks: [], source: apiKey ? 'ai-suggested' : 'manual',
    });
  };

  const w = typeof window !== 'undefined' ? window as unknown as WindowWithSpeech : null;
  const hasSpeech = !!w && !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);

  const toggleVoice = useCallback(() => {
    const SRClass = w?.SpeechRecognition ?? w?.webkitSpeechRecognition;
    if (!SRClass) return;
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const r = new SRClass();
    r.lang = 'en-AU'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (ev) => {
      setQuickAdd(ev.results[0][0].transcript);
      setIsListening(false);
      quickInputRef.current?.focus();
    };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    recognitionRef.current = r; r.start(); setIsListening(true);
  }, [isListening, w]);

  const handleReprioritise = async () => {
    const apiKey = getKey('openai');
    if (!apiKey) { setReprioritiseError('OpenAI API key required. Add it in Settings.'); return; }
    const activeTasks = tasks.filter((t) => t.status !== 'done');
    if (!activeTasks.length) return;
    setReprioritising(true); setReprioritiseError('');
    try {
      const results = await reprioritiseTasks(activeTasks, apiKey);
      for (const r of results) {
        if (r.id && r.priority >= 1 && r.priority <= 5) {
          await tasksRepo.update(db, r.id, { priority: r.priority as Task['priority'], aiRationale: r.rationale });
        }
      }
    } catch (e) { setReprioritiseError((e as Error).message); }
    setReprioritising(false);
  };

  const cycleStatus = (task: Task) => {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(task.status) + 1) % STATUS_CYCLE.length];
    tasksRepo.update(db, task.id, { status: next });
  };

  const handleDelete = async (id: string) => {
    await tasksRepo.remove(db, id);
    setSelected((p) => { const n = new Set(p); n.delete(id); return n; });
    if (editingId === id) setEditingId(null);
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} task(s)?`)) return;
    await tasksRepo.bulkRemove(db, [...selected]);
    setSelected(new Set());
  };

  const handleBulkStatusChange = async (status: Task['status']) => {
    await tasksRepo.bulkUpdate(db, [...selected], { status });
    setSelected(new Set());
  };

  const handleBulkTag = async () => {
    const tag = bulkTagInput.trim().toLowerCase();
    if (!tag) return;
    for (const id of selected) {
      const task = await tasksRepo.get(db, id);
      if (task && !task.tags.includes(tag)) await tasksRepo.update(db, id, { tags: [...task.tags, tag] });
    }
    setBulkTagInput(''); setShowBulkTag(false);
  };

  const handleSaveEdit = async (id: string, patch: Partial<Task>) => {
    await tasksRepo.update(db, id, patch);
    setEditingId(null);
  };

  const handleSaveNew = async (data: Partial<Task>) => {
    await tasksRepo.create(db, {
      title: data.title ?? '', description: data.description,
      priority: data.priority ?? 3, status: data.status ?? 'inbox',
      deadline: data.deadline, estimatedDurationMin: data.estimatedDurationMin ?? 30,
      tags: data.tags ?? [], scheduledBlocks: [], source: 'manual', recurrence: data.recurrence,
    });
    setShowAddForm(false);
  };

  const countByStatus = useMemo(() => {
    const m: Partial<Record<Task['status'], number>> = {};
    for (const t of filtered) m[t.status] = (m[t.status] ?? 0) + 1;
    return m;
  }, [filtered]);

  return (
    <div className="flex-1 min-h-0 flex flex-col grid-bg">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border bg-bg-elevated">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start gap-4 mb-4">
            <div className="p-3 rounded-btn bg-bg-panel border border-border">
              <CheckSquare size={22} className="text-accent-green" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-orbitron text-2xl font-bold text-text-primary tracking-wide">TO-DO</h1>
                <span className="font-mono text-[10px] text-text-dim tracking-widest px-2 py-0.5 border border-border rounded">
                  {tasks.filter((t) => t.status !== 'done').length} active
                </span>
              </div>
              <p className="text-text-secondary text-sm mt-0.5 font-inter">AI-parsed quick-add · OpenAI prioritisation</p>
            </div>
            <div className="flex-1" />
            <button
              onClick={handleReprioritise}
              disabled={reprioritising || tasks.filter((t) => t.status !== 'done').length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-btn border border-accent-amber/40 text-accent-amber bg-accent-amber/5 hover:bg-accent-amber/10 text-xs font-rajdhani font-bold uppercase tracking-wider transition-colors disabled:opacity-40"
            >
              {reprioritising ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              Re-prioritise with AI
            </button>
          </div>

          {reprioritiseError && (
            <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-btn text-xs text-red-400">
              <AlertTriangle size={12} className="shrink-0" />{reprioritiseError}
              <button onClick={() => setReprioritiseError('')} className="ml-auto p-0.5 hover:brightness-125"><X size={12} /></button>
            </div>
          )}

          {/* Quick-add */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 relative">
              <input
                ref={quickInputRef}
                value={quickAdd}
                onChange={(e) => setQuickAdd(e.target.value)}
                onKeyDown={handleQuickAdd}
                placeholder={quickParsing ? 'Parsing with AI…' : 'Quick-add: "Mark Year 9 essays by Friday — 2 hrs" → Enter'}
                disabled={quickParsing}
                className="input pr-20 text-sm py-2.5"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {quickParsing && <Loader2 size={13} className="text-accent-cyan animate-spin" />}
                {hasSpeech && (
                  <button onClick={toggleVoice} title="Voice input" className={clsx('p-1.5 rounded transition-colors', isListening ? 'text-red-400 bg-red-500/10' : 'text-text-dim hover:text-accent-cyan')}>
                    {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                  </button>
                )}
              </div>
            </div>
            <button onClick={() => setShowAddForm((s) => !s)} className={clsx('flex items-center gap-1.5 px-3 py-2.5 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', showAddForm ? 'border-accent-green text-accent-green bg-accent-green/5' : 'border-border text-text-secondary hover:text-accent-green hover:border-accent-green')}>
              <Plus size={14} />Full form
            </button>
          </div>

          {showAddForm && (
            <div className="mb-3">
              <TaskForm onSave={handleSaveNew} onCancel={() => setShowAddForm(false)} />
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0 relative">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…" className="input py-1.5 text-xs pl-8" />
              <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
              {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary"><X size={11} /></button>}
            </div>
            <button onClick={() => setShowFilters((s) => !s)} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', showFilters || activeFilters > 0 ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/5' : 'border-border text-text-secondary hover:border-text-dim')}>
              <Filter size={12} />Filters
              {activeFilters > 0 && <span className="w-4 h-4 rounded-full bg-accent-cyan text-bg-base text-[9px] flex items-center justify-center font-bold">{activeFilters}</span>}
            </button>
            <div className="flex gap-0 border border-border rounded-btn overflow-hidden">
              {([['list', <List size={14} />], ['kanban', <LayoutGrid size={14} />], ['eisenhower', <span className="font-mono text-[9px]">2×2</span>]] as [ViewMode, React.ReactNode][]).map(([v, icon]) => (
                <button key={v} onClick={() => setViewMode(v)} title={v} className={clsx('px-2.5 py-1.5 transition-colors', viewMode === v ? 'bg-accent-green/10 text-accent-green' : 'text-text-dim hover:text-text-primary')}>
                  {icon}
                </button>
              ))}
            </div>
            <span className="text-[10px] font-mono text-text-dim">{filtered.length} / {tasks.length}</span>
          </div>

          {showFilters && (
            <div className="mt-2 p-3 bg-bg-panel border border-border rounded-btn space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(STATUS_LABELS) as Task['status'][]).map((s) => (
                  <button key={s} onClick={() => setFilterStatus((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; })} className={clsx('px-2.5 py-1 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', filterStatus.has(s) ? 'border-accent-cyan text-accent-cyan bg-bg-elevated' : 'border-border text-text-secondary hover:border-text-dim')}>
                    {STATUS_LABELS[s]}
                  </button>
                ))}
                {[1, 2, 3, 4, 5].map((p) => (
                  <button key={p} onClick={() => setFilterPriority(filterPriority === p ? null : p)} className={clsx('px-2.5 py-1 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', PRIORITY_COLORS[p].text, filterPriority === p ? clsx(PRIORITY_COLORS[p].bg, PRIORITY_COLORS[p].border) : 'border-border hover:border-text-dim')}>
                    P{p}
                  </button>
                ))}
              </div>
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((tag) => (
                    <button key={tag} onClick={() => setFilterTags((p) => { const n = new Set(p); n.has(tag) ? n.delete(tag) : n.add(tag); return n; })} className={clsx('px-2 py-0.5 rounded text-[10px] border transition-colors', filterTags.has(tag) ? 'border-accent-green text-accent-green bg-accent-green/10' : 'border-border text-text-dim hover:border-text-dim')}>
                      <Tag size={9} className="inline mr-0.5" />{tag}
                    </button>
                  ))}
                </div>
              )}
              {activeFilters > 0 && (
                <button onClick={() => { setFilterStatus(new Set()); setFilterTags(new Set()); setFilterPriority(null); }} className="text-[10px] font-mono text-accent-cyan hover:underline">Clear filters</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="shrink-0 flex items-center gap-3 px-6 py-2.5 bg-accent-green/5 border-b border-accent-green/20 flex-wrap">
          <span className="text-xs font-rajdhani font-bold text-accent-green uppercase tracking-wider">{selected.size} selected</span>
          <div className="flex items-center gap-2 flex-wrap">
            {(Object.keys(STATUS_LABELS) as Task['status'][]).map((s) => (
              <button key={s} onClick={() => handleBulkStatusChange(s)} className="px-2 py-1 rounded-btn border border-border text-text-secondary hover:text-accent-cyan hover:border-accent-cyan text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-colors">
                → {STATUS_LABELS[s]}
              </button>
            ))}
            {showBulkTag ? (
              <div className="flex items-center gap-1">
                <input autoFocus value={bulkTagInput} onChange={(e) => setBulkTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleBulkTag()} placeholder="Tag name…" className="input py-1 text-xs w-24" />
                <button onClick={handleBulkTag} className="p-1.5 rounded-btn bg-accent-green text-bg-base hover:brightness-110 transition-all"><Check size={12} /></button>
                <button onClick={() => setShowBulkTag(false)} className="p-1.5 text-text-dim hover:text-text-primary"><X size={12} /></button>
              </div>
            ) : (
              <button onClick={() => setShowBulkTag(true)} className="flex items-center gap-1 px-2 py-1 rounded-btn border border-border text-text-secondary hover:text-accent-green hover:border-accent-green text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-colors">
                <Tag size={11} />Tag
              </button>
            )}
            <button onClick={handleBulkDelete} className="flex items-center gap-1 px-2 py-1 rounded-btn border border-red-500/30 text-red-400 hover:bg-red-500/10 text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-colors">
              <Trash2 size={11} />Delete
            </button>
          </div>
          <button onClick={() => setSelected(new Set())} className="ml-auto p-1 text-text-dim hover:text-text-primary transition-colors"><X size={12} /></button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
              <div className="p-4 rounded-full bg-bg-elevated border border-border">
                <CheckSquare size={28} className="text-text-dim" />
              </div>
              <div className="font-rajdhani font-bold text-lg text-text-secondary">
                {tasks.length === 0 ? 'No tasks yet' : 'No results'}
              </div>
              <p className="text-text-dim text-sm max-w-xs">
                {tasks.length === 0 ? 'Type a task above and press Enter. Natural language works — try "Mark Year 9 essays by Friday".' : 'Try adjusting your filters.'}
              </p>
            </div>
          )}

          {/* LIST */}
          {viewMode === 'list' && filtered.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <button onClick={() => { if (selected.size === filtered.length) setSelected(new Set()); else setSelected(new Set(filtered.map((t) => t.id))); }} className="flex items-center gap-1.5 text-xs font-mono text-text-dim hover:text-accent-green transition-colors">
                  {selected.size === filtered.length && filtered.length > 0 ? <CheckSquare size={13} className="text-accent-green" /> : <div className="w-[13px] h-[13px] border border-border rounded" />}
                  {selected.size === filtered.length && filtered.length > 0 ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                {filtered.map((task) => (
                  editingId === task.id ? (
                    <div key={task.id} className="p-3 border-b border-border bg-bg-panel">
                      <TaskForm initial={task} onSave={(d) => handleSaveEdit(task.id, d)} onCancel={() => setEditingId(null)} />
                    </div>
                  ) : (
                    <TaskRow
                      key={task.id} task={task} selected={selected.has(task.id)}
                      onSelect={() => toggleSelect(task.id)} onEdit={() => setEditingId(task.id)}
                      onDelete={() => handleDelete(task.id)} onStatusCycle={() => cycleStatus(task)}
                    />
                  )
                ))}
              </div>
            </div>
          )}

          {/* KANBAN */}
          {viewMode === 'kanban' && filtered.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {(Object.keys(STATUS_LABELS) as Task['status'][]).map((status) => {
                const colTasks = filtered.filter((t) => t.status === status);
                const Icon = STATUS_ICONS[status];
                return (
                  <div key={status} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon size={13} className={STATUS_COLORS[status]} />
                      <span className={clsx('font-rajdhani font-bold text-xs uppercase tracking-wider', STATUS_COLORS[status])}>{STATUS_LABELS[status]}</span>
                      <span className="ml-auto font-mono text-[9px] text-text-dim px-1.5 py-0.5 bg-bg-elevated border border-border rounded">{countByStatus[status] ?? 0}</span>
                    </div>
                    {colTasks.length === 0 && <div className="text-[10px] text-text-dim font-mono italic px-1">Empty</div>}
                    {colTasks.map((task) => (
                      editingId === task.id ? (
                        <div key={task.id}>
                          <TaskForm initial={task} onSave={(d) => handleSaveEdit(task.id, d)} onCancel={() => setEditingId(null)} />
                        </div>
                      ) : (
                        <KanbanCard
                          key={task.id} task={task}
                          onEdit={() => setEditingId(task.id)}
                          onDelete={() => handleDelete(task.id)}
                          onStatusChange={(s) => tasksRepo.update(db, task.id, { status: s })}
                        />
                      )
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* EISENHOWER */}
          {viewMode === 'eisenhower' && (
            <>
              <EisenhowerMatrix tasks={filtered} onEdit={(t) => setEditingId(t.id)} onDelete={handleDelete} />
              {editingId && (() => {
                const task = tasks.find((x) => x.id === editingId);
                return task ? (
                  <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setEditingId(null)}>
                    <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                      <TaskForm initial={task} onSave={(d) => handleSaveEdit(editingId, d)} onCancel={() => setEditingId(null)} />
                    </div>
                  </div>
                ) : null;
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
