import { useState, useMemo, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookOpen, Search, Grid3x3, List, Download, Trash2, Tag,
  Filter, X, ArrowUpDown, GitBranch, Calendar,
  CheckSquare, Square, FileText, Presentation, ClipboardList,
  NotebookPen, HelpCircle, Target, Image as ImageIcon, GraduationCap,
  GitCompare, LayoutGrid, Eye, CalendarPlus,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDb } from '../db/DbContext';
import { artifactsRepo } from '../db/repos';
import type { Artifact } from '../db/schema';
import { ArtifactPreviewModal } from '../components/ArtifactPreviewModal';

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_META: Record<Artifact['type'], { label: string; icon: typeof FileText; accent: string; accentBg: string }> = {
  slides:      { label: 'Slide Deck',    icon: Presentation,  accent: 'text-accent-cyan',  accentBg: 'bg-accent-cyan' },
  lesson_plan: { label: 'Lesson Plan',   icon: GraduationCap, accent: 'text-accent-amber', accentBg: 'bg-accent-amber' },
  worksheet:   { label: 'Worksheet',     icon: ClipboardList, accent: 'text-accent-green', accentBg: 'bg-accent-green' },
  quiz:        { label: 'Quiz / Test',   icon: HelpCircle,    accent: 'text-accent-cyan',  accentBg: 'bg-accent-cyan' },
  notes:       { label: 'Student Notes', icon: NotebookPen,   accent: 'text-accent-amber', accentBg: 'bg-accent-amber' },
  rubric:      { label: 'Rubric',        icon: Target,        accent: 'text-accent-green', accentBg: 'bg-accent-green' },
  pdf:         { label: 'Document',      icon: FileText,      accent: 'text-accent-amber', accentBg: 'bg-accent-amber' },
  image:       { label: 'AI Image',      icon: ImageIcon,     accent: 'text-accent-cyan',  accentBg: 'bg-accent-cyan' },
  infographic: { label: 'Infographic',   icon: LayoutGrid,    accent: 'text-accent-green', accentBg: 'bg-accent-green' },
};

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title',  label: 'Title A–Z' },
  { value: 'type',   label: 'Type' },
];

const ARTIFACT_TYPES: Artifact['type'][] = [
  'slides', 'lesson_plan', 'worksheet', 'quiz', 'notes', 'rubric', 'pdf', 'image', 'infographic',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function fileExtension(mediaType: string): string {
  if (mediaType?.startsWith('image/')) {
    if (mediaType === 'image/jpeg') return '.jpg';
    if (mediaType === 'image/png') return '.png';
    if (mediaType === 'image/webp') return '.webp';
    if (mediaType === 'image/gif') return '.gif';
    return '.jpg';
  }
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/html': '.html',
    'text/markdown': '.md',
    'application/json': '.json',
  };
  return map[mediaType] ?? '.bin';
}

function b64toBlob(b64: string, mimeType: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function artifactSearchText(a: Artifact): string {
  const meta = a.meta as Record<string, unknown>;
  return [a.title, meta.topic, meta.yearLevel, meta.subject, meta.curriculumStandard, meta.task, meta.provider, meta.model, ...(a.tags ?? [])]
    .filter(Boolean).join(' ').toLowerCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ArtifactIcon({ type, size = 16 }: { type: Artifact['type']; size?: number }) {
  const m = TYPE_META[type] ?? TYPE_META.pdf;
  return <m.icon size={size} className={m.accent} />;
}

function VersionBadge({ version }: { version?: number }) {
  if (!version || version === 1) return null;
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono rounded border border-accent-amber/40 text-accent-amber bg-accent-amber/5">
      <GitBranch size={8} />v{version}
    </span>
  );
}

// Tag inline editor
function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState('');
  const add = () => {
    const t = input.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput('');
  };
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {tags.map((t) => (
        <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-bg-elevated border border-border text-text-secondary">
          {t}
          <button onClick={() => onChange(tags.filter((x) => x !== t))} className="text-text-dim hover:text-red-400 transition-colors"><X size={9} /></button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
        placeholder="add tag…"
        className="bg-transparent border-none outline-none text-[11px] text-text-secondary placeholder:text-text-dim w-20 min-w-0"
      />
    </div>
  );
}

// Version compare modal
function VersionCompareModal({ versions, onClose }: { versions: Artifact[]; onClose: () => void }) {
  const [leftIdx, setLeftIdx] = useState(Math.max(0, versions.length - 2));
  const [rightIdx, setRightIdx] = useState(versions.length - 1);

  const renderPreview = (a: Artifact) => {
    if (a.mediaType?.startsWith('image/')) {
      return <img src={`data:${a.mediaType};base64,${a.data}`} alt={a.title} className="max-w-full max-h-full object-contain" />;
    }
    if (a.mediaType === 'application/pdf') {
      return <iframe title={a.title} src={`data:application/pdf;base64,${a.data}`} className="w-full h-full border-0" />;
    }
    if (a.mediaType === 'text/html') {
      return <iframe title={a.title} srcDoc={atob(a.data)} className="w-full h-full border-0 bg-white" sandbox="allow-scripts" />;
    }
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div><ArtifactIcon type={a.type} size={32} /><p className="text-text-dim text-xs mt-2 font-mono">No preview</p></div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-6xl h-[90vh] bg-bg-panel border border-border rounded-lg flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            <GitCompare size={15} className="text-accent-cyan" />
            <span className="font-orbitron text-sm font-bold text-text-primary tracking-wide uppercase">Version Compare</span>
            <span className="font-mono text-[10px] text-text-dim">{versions[0].title.slice(0, 50)}</span>
          </div>
          <button onClick={onClose} className="p-1.5 text-text-dim hover:text-accent-cyan transition-colors"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-border">
          {[{ idx: leftIdx, setIdx: setLeftIdx }, { idx: rightIdx, setIdx: setRightIdx }].map(({ idx, setIdx }, col) => {
            const a = versions[idx];
            return (
              <div key={col} className="flex flex-col min-h-0">
                <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-elevated">
                  <select value={idx} onChange={(e) => setIdx(Number(e.target.value))} className="input py-1 text-xs flex-1">
                    {versions.map((v, i) => (
                      <option key={v.id} value={i}>v{v.version ?? 1} — {fmtDate(v.createdAt)} {fmtTime(v.createdAt)}</option>
                    ))}
                  </select>
                  <span className="text-[10px] font-mono text-text-dim shrink-0">{(a.meta as Record<string, unknown>).model as string || ''}</span>
                </div>
                <div className="flex-1 min-h-0 overflow-auto">{renderPreview(a)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Detail side drawer
interface DetailDrawerProps {
  artifact: Artifact;
  versions: Artifact[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onTagsChange: (id: string, tags: string[]) => void;
  onCompare: () => void;
}

function DetailDrawer({ artifact, versions, onClose, onDelete, onTagsChange, onCompare }: DetailDrawerProps) {
  const meta = artifact.meta as Record<string, unknown>;

  const download = () => {
    const ext = fileExtension(artifact.mediaType);
    const slug = artifact.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
    const a = document.createElement('a');
    a.href = `data:${artifact.mediaType};base64,${artifact.data}`;
    a.download = `${slug}_v${artifact.version ?? 1}${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const metaRows: [string, string | undefined][] = [
    ['Type', TYPE_META[artifact.type]?.label],
    ['Year level', meta.yearLevel as string | undefined],
    ['Topic', meta.topic as string | undefined],
    ['Model', meta.model as string | undefined],
    ['Provider', meta.provider as string | undefined],
    ['Created', `${fmtDate(artifact.createdAt)} ${fmtTime(artifact.createdAt)}`],
    ['Version', `v${artifact.version ?? 1} of ${versions.length}`],
  ];

  return (
    <div className="fixed inset-0 z-40 flex pointer-events-none">
      <div className="flex-1 pointer-events-auto" onClick={onClose} />
      <div className="w-76 h-full bg-bg-panel border-l border-border flex flex-col shadow-2xl pointer-events-auto" style={{ width: 304 }}>
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-2">
            <ArtifactIcon type={artifact.type} />
            <span className="font-rajdhani font-bold text-sm text-text-primary">Details</span>
          </div>
          <button onClick={onClose} className="p-1.5 text-text-dim hover:text-accent-cyan transition-colors"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <h3 className="font-rajdhani font-bold text-base text-text-primary leading-tight">{artifact.title}</h3>
            <div className="mt-1"><VersionBadge version={artifact.version} /></div>
          </div>

          <table className="w-full text-xs">
            <tbody>
              {metaRows.filter(([, v]) => v).map(([k, v]) => (
                <tr key={k} className="border-b border-border/50">
                  <td className="py-1.5 pr-3 text-text-dim font-mono text-[10px] whitespace-nowrap">{k}</td>
                  <td className="py-1.5 text-text-secondary break-all">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Tag size={11} className="text-text-dim" />
              <span className="text-[10px] font-mono text-text-dim uppercase tracking-wider">Tags</span>
            </div>
            <TagEditor tags={artifact.tags ?? []} onChange={(tags) => onTagsChange(artifact.id, tags)} />
          </div>
        </div>

        <div className="shrink-0 p-4 border-t border-border space-y-2">
          {versions.length > 1 && (
            <button onClick={onCompare} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-accent-cyan hover:border-accent-cyan text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">
              <GitCompare size={13} />Compare versions
            </button>
          )}
          <button onClick={download} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all">
            <Download size={13} />Download
          </button>
          <button onClick={() => onDelete(artifact.id)} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-btn border border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">
            <Trash2 size={13} />Delete this version
          </button>
        </div>
      </div>
    </div>
  );
}

// Grid card
interface CardProps {
  artifact: Artifact;
  selected: boolean;
  onSelect: () => void;
  onClick: () => void;
  active: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onPreview: () => void;
  onAssign: () => void;
}

function ArtifactCard({ artifact, selected, onSelect, onClick, active, onDragStart, onPreview, onAssign }: CardProps) {
  const meta = artifact.meta as Record<string, unknown>;
  const tm = TYPE_META[artifact.type] ?? TYPE_META.pdf;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={clsx(
        'group relative bg-bg-panel border rounded-lg overflow-hidden cursor-pointer transition-all select-none',
        active ? 'border-accent-cyan ring-1 ring-accent-cyan/30 shadow-lg' : selected ? 'border-accent-cyan/50' : 'border-border hover:border-text-dim hover:-translate-y-0.5 hover:shadow-md',
      )}
      onClick={onClick}
    >
      <div className={clsx('absolute top-0 left-0 right-0 h-0.5', tm.accentBg)} />
      {/* Thumbnail */}
      {artifact.mediaType?.startsWith('image/') ? (
        <div className="aspect-video bg-white overflow-hidden border-b border-border">
          <img src={`data:${artifact.mediaType};base64,${artifact.data}`} alt={artifact.title} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="aspect-video bg-bg-elevated flex items-center justify-center border-b border-border">
          <ArtifactIcon type={artifact.type} size={36} />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-start justify-between gap-1 mb-1">
          <h3 className="font-rajdhani font-bold text-sm text-text-primary leading-tight line-clamp-2 flex-1">{artifact.title}</h3>
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            <VersionBadge version={artifact.version} />
            <button onClick={(e) => { e.stopPropagation(); onSelect(); }} className="p-0.5 text-text-dim hover:text-accent-cyan transition-colors">
              {selected ? <CheckSquare size={13} className="text-accent-cyan" /> : <Square size={13} />}
            </button>
          </div>
        </div>
        <div className="text-[10px] font-mono text-text-dim flex items-center gap-1.5">
          <span>{tm.label}</span>
          {!!meta.yearLevel && <><span>·</span><span>{String(meta.yearLevel)}</span></>}
        </div>
        <div className="mt-1 text-[10px] text-text-dim">{fmtDate(artifact.createdAt)}</div>
        {(artifact.tags?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {artifact.tags!.map((t) => (
              <span key={t} className="px-1.5 py-0.5 rounded text-[9px] bg-bg-elevated border border-border text-text-dim">{t}</span>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-btn border border-border text-[10px] font-rajdhani font-semibold uppercase tracking-wider text-text-secondary hover:text-accent-cyan hover:border-accent-cyan transition-colors"
            title="Preview inline"
          >
            <Eye size={11} />Preview
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAssign(); }}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-btn border border-border text-[10px] font-rajdhani font-semibold uppercase tracking-wider text-text-secondary hover:text-accent-amber hover:border-accent-amber transition-colors"
            title="Assign to a timetable slot"
          >
            <CalendarPlus size={11} />Assign
          </button>
        </div>
      </div>
    </div>
  );
}

// List row
interface RowProps {
  artifact: Artifact;
  selected: boolean;
  onSelect: () => void;
  onClick: () => void;
  active: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onPreview: () => void;
  onAssign: () => void;
}

function ArtifactRow({ artifact, selected, onSelect, onClick, active, onDragStart, onPreview, onAssign }: RowProps) {
  const meta = artifact.meta as Record<string, unknown>;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={clsx(
        'group flex items-center gap-3 px-4 py-3 border-b border-border cursor-pointer transition-colors select-none',
        active ? 'bg-accent-cyan/5' : selected ? 'bg-accent-cyan/5' : 'hover:bg-bg-elevated',
      )}
      onClick={onClick}
    >
      <button onClick={(e) => { e.stopPropagation(); onSelect(); }} className="shrink-0 text-text-dim hover:text-accent-cyan transition-colors">
        {selected ? <CheckSquare size={14} className="text-accent-cyan" /> : <Square size={14} />}
      </button>
      <ArtifactIcon type={artifact.type} size={14} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-rajdhani font-bold text-sm text-text-primary truncate">{artifact.title}</span>
          <VersionBadge version={artifact.version} />
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-text-dim">
          <span>{TYPE_META[artifact.type]?.label}</span>
          {!!meta.yearLevel && <><span>·</span><span>{String(meta.yearLevel)}</span></>}
          {!!meta.topic && <><span>·</span><span className="truncate max-w-[12rem]">{String(meta.topic)}</span></>}
        </div>
      </div>
      {(artifact.tags?.length ?? 0) > 0 && (
        <div className="hidden sm:flex gap-1">
          {artifact.tags!.slice(0, 3).map((t) => (
            <span key={t} className="px-1.5 py-0.5 rounded text-[9px] bg-bg-elevated border border-border text-text-dim">{t}</span>
          ))}
        </div>
      )}
      <div className="text-[10px] font-mono text-text-dim shrink-0">{fmtDate(artifact.createdAt)}</div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
          className="p-1.5 rounded-btn border border-border text-text-dim hover:text-accent-cyan hover:border-accent-cyan transition-colors"
          title="Preview inline"
        >
          <Eye size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onAssign(); }}
          className="p-1.5 rounded-btn border border-border text-text-dim hover:text-accent-amber hover:border-accent-amber transition-colors"
          title="Assign to a timetable slot"
        >
          <CalendarPlus size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function LibraryView() {
  const db = useDb();
  const allArtifacts = useLiveQuery(() => artifactsRepo.list(db), [db]) ?? [];

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [filterTypes, setFilterTypes] = useState<Set<Artifact['type']>>(new Set());
  const [filterModel, setFilterModel] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterHasClass, setFilterHasClass] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title' | 'type'>('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [compareGroupId, setCompareGroupId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [assignId, setAssignId] = useState<string | null>(null);

  const versionMap = useMemo(() => {
    const map = new Map<string, Artifact[]>();
    for (const a of allArtifacts) {
      const gid = a.groupId ?? a.id;
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(a);
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
    return map;
  }, [allArtifacts]);

  const allModels = useMemo(() => {
    const set = new Set<string>();
    for (const a of allArtifacts) {
      const m = (a.meta as Record<string, unknown>).model as string | undefined;
      if (m) set.add(m);
    }
    return [...set].sort();
  }, [allArtifacts]);

  const timetableBlocks = useLiveQuery(() => db.timetableBlocks.toArray(), [db]) ?? [];
  const attachedIds = useMemo(() => {
    const set = new Set<string>();
    for (const b of timetableBlocks) for (const id of b.artifactIds ?? []) set.add(id);
    return set;
  }, [timetableBlocks]);

  const filtered = useMemo(() => {
    let list = [...allArtifacts];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => artifactSearchText(a).includes(q));
    }
    if (filterTypes.size > 0) list = list.filter((a) => filterTypes.has(a.type));
    if (filterModel) list = list.filter((a) => (a.meta as Record<string, unknown>).model === filterModel);
    if (filterDateFrom) list = list.filter((a) => a.createdAt >= new Date(filterDateFrom).getTime());
    if (filterDateTo) list = list.filter((a) => a.createdAt <= new Date(filterDateTo + 'T23:59:59').getTime());
    if (filterHasClass) list = list.filter((a) => attachedIds.has(a.id));
    list.sort((a, b) => {
      if (sortBy === 'newest') return b.createdAt - a.createdAt;
      if (sortBy === 'oldest') return a.createdAt - b.createdAt;
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return a.type.localeCompare(b.type);
    });
    return list;
  }, [allArtifacts, search, filterTypes, filterModel, filterDateFrom, filterDateTo, filterHasClass, sortBy, attachedIds]);

  const activeFilters = filterTypes.size + (filterModel ? 1 : 0) + (filterDateFrom ? 1 : 0) + (filterDateTo ? 1 : 0) + (filterHasClass ? 1 : 0);

  const toggleType = (t: Artifact['type']) => setFilterTypes((prev) => {
    const next = new Set(prev);
    next.has(t) ? next.delete(t) : next.add(t);
    return next;
  });

  const toggleSelect = useCallback((id: string) => setSelected((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  }), []);

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((a) => a.id)));
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this artifact version?')) return;
    await artifactsRepo.remove(db, id);
    setSelected((p) => { const n = new Set(p); n.delete(id); return n; });
    if (detailId === id) setDetailId(null);
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} artifact(s)?`)) return;
    for (const id of selected) await artifactsRepo.remove(db, id);
    setSelected(new Set());
  };

  const handleBulkExport = async () => {
    const items = filtered.filter((a) => selected.has(a.id));
    for (const a of items) {
      const ext = fileExtension(a.mediaType);
      const slug = a.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
      const blob = b64toBlob(a.data, a.mediaType);
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url;
      el.download = `${slug}_v${a.version ?? 1}${ext}`;
      document.body.appendChild(el);
      el.click();
      document.body.removeChild(el);
      URL.revokeObjectURL(url);
      await new Promise((r) => setTimeout(r, 80));
    }
  };

  const handleTagsChange = (id: string, tags: string[]) => artifactsRepo.updateTags(db, id, tags);

  const detailArtifact = detailId ? allArtifacts.find((a) => a.id === detailId) ?? null : null;
  const detailVersions = detailArtifact ? (versionMap.get(detailArtifact.groupId ?? detailArtifact.id) ?? [detailArtifact]) : [];
  const compareVersions = compareGroupId ? (versionMap.get(compareGroupId) ?? null) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col grid-bg">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border bg-bg-elevated">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start gap-4 mb-4">
            <div className="p-3 rounded-btn bg-bg-panel border border-border">
              <BookOpen size={22} className="text-accent-cyan" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-orbitron text-2xl font-bold text-text-primary tracking-wide">LIBRARY</h1>
                <span className="font-mono text-[10px] text-text-dim tracking-widest px-2 py-0.5 border border-border rounded">
                  {allArtifacts.length} artifact{allArtifacts.length !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-text-secondary text-sm mt-0.5 font-inter">
                Every generated artifact — searchable, re-exportable, versioned.
              </p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, topic, year level, tags, model…"
                className="input pl-9 pr-8 py-2 text-sm"
              />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary"><X size={13} /></button>}
            </div>

            <button
              onClick={() => setShowFilters((s) => !s)}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors',
                showFilters || activeFilters > 0 ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/5' : 'border-border text-text-secondary hover:border-text-dim',
              )}
            >
              <Filter size={13} />Filters
              {activeFilters > 0 && <span className="w-4 h-4 rounded-full bg-accent-cyan text-bg-base text-[9px] flex items-center justify-center font-bold">{activeFilters}</span>}
            </button>

            <div className="flex items-center gap-0 border border-border rounded-btn overflow-hidden">
              {(['grid', 'list'] as const).map((v) => (
                <button key={v} onClick={() => setViewMode(v)} className={clsx('px-2.5 py-2 transition-colors', viewMode === v ? 'bg-accent-cyan/10 text-accent-cyan' : 'text-text-dim hover:text-text-primary')}>
                  {v === 'grid' ? <Grid3x3 size={14} /> : <List size={14} />}
                </button>
              ))}
            </div>

            <div className="relative">
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="input py-2 text-xs pr-7 pl-3 appearance-none cursor-pointer">
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <ArrowUpDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
            </div>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div className="mt-3 p-4 bg-bg-panel border border-border rounded-btn space-y-3">
              <div>
                <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-2">Artifact type</div>
                <div className="flex flex-wrap gap-2">
                  {ARTIFACT_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => toggleType(t)}
                      className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', filterTypes.has(t) ? 'border-accent-cyan text-accent-cyan bg-bg-elevated' : 'border-border text-text-secondary hover:border-text-dim')}
                    >
                      <ArtifactIcon type={t} size={11} />{TYPE_META[t].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1">Model used</div>
                  <select value={filterModel} onChange={(e) => setFilterModel(e.target.value)} className="input py-1.5 text-xs">
                    <option value="">All</option>
                    {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1">From date</div>
                  <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="input py-1.5 text-xs" />
                </div>
                <div>
                  <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1">To date</div>
                  <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="input py-1.5 text-xs" />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => setFilterHasClass((s) => !s)}
                    className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', filterHasClass ? 'border-accent-cyan text-accent-cyan bg-bg-elevated' : 'border-border text-text-secondary hover:border-text-dim')}
                  >
                    <Calendar size={11} />Attached to class
                  </button>
                </div>
              </div>
              {activeFilters > 0 && (
                <button onClick={() => { setFilterTypes(new Set()); setFilterModel(''); setFilterDateFrom(''); setFilterDateTo(''); setFilterHasClass(false); }} className="text-[10px] font-mono text-accent-cyan hover:underline">
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="shrink-0 flex items-center gap-3 px-6 py-2.5 bg-accent-cyan/5 border-b border-accent-cyan/20">
          <span className="text-xs font-rajdhani font-bold text-accent-cyan uppercase tracking-wider">{selected.size} selected</span>
          <div className="flex-1" />
          <button onClick={handleBulkExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn border border-border text-text-secondary hover:text-accent-cyan hover:border-accent-cyan text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">
            <Download size={13} />Export ZIP
          </button>
          <button onClick={handleBulkDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn border border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">
            <Trash2 size={13} />Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="p-1.5 text-text-dim hover:text-text-primary transition-colors"><X size={13} /></button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
              <div className="p-4 rounded-full bg-bg-elevated border border-border">
                <BookOpen size={28} className="text-text-dim" />
              </div>
              <div className="font-rajdhani font-bold text-lg text-text-secondary">
                {allArtifacts.length === 0 ? 'No artifacts yet' : 'No results'}
              </div>
              <p className="text-text-dim text-sm max-w-xs">
                {allArtifacts.length === 0 ? 'Generate something in Studio and it will appear here.' : 'Try adjusting your search or filters.'}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={toggleSelectAll} className="flex items-center gap-2 text-xs font-mono text-text-dim hover:text-accent-cyan transition-colors">
                  {selected.size === filtered.length ? <CheckSquare size={13} className="text-accent-cyan" /> : <Square size={13} />}
                  {selected.size === filtered.length ? 'Deselect all' : 'Select all'}
                </button>
                <span className="text-[10px] font-mono text-text-dim">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
              </div>

              {viewMode === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {filtered.map((a) => (
                    <ArtifactCard
                      key={a.id}
                      artifact={a}
                      selected={selected.has(a.id)}
                      active={detailId === a.id}
                      onSelect={() => toggleSelect(a.id)}
                      onClick={() => setDetailId(detailId === a.id ? null : a.id)}
                      onDragStart={(e) => { e.dataTransfer.setData('artifactId', a.id); e.dataTransfer.effectAllowed = 'link'; }}
                      onPreview={() => setPreviewId(a.id)}
                      onAssign={() => setAssignId(a.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2 bg-bg-elevated border-b border-border text-[10px] font-mono text-text-dim uppercase tracking-wider">
                    <span className="w-4" /><span className="w-4" />
                    <span className="flex-1">Title / Type / Topic</span>
                    <span className="hidden sm:block w-32">Tags</span>
                    <span className="w-20 text-right">Date</span>
                  </div>
                  {filtered.map((a) => (
                    <ArtifactRow
                      key={a.id}
                      artifact={a}
                      selected={selected.has(a.id)}
                      active={detailId === a.id}
                      onSelect={() => toggleSelect(a.id)}
                      onClick={() => setDetailId(detailId === a.id ? null : a.id)}
                      onDragStart={(e) => { e.dataTransfer.setData('artifactId', a.id); e.dataTransfer.effectAllowed = 'link'; }}
                      onPreview={() => setPreviewId(a.id)}
                      onAssign={() => setAssignId(a.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Detail drawer */}
      {detailArtifact && (
        <DetailDrawer
          artifact={detailArtifact}
          versions={detailVersions}
          onClose={() => setDetailId(null)}
          onDelete={handleDelete}
          onTagsChange={handleTagsChange}
          onCompare={() => { setCompareGroupId(detailArtifact.groupId ?? detailArtifact.id); }}
        />
      )}

      {/* Version compare modal */}
      {compareVersions && compareVersions.length >= 2 && (
        <VersionCompareModal versions={compareVersions} onClose={() => setCompareGroupId(null)} />
      )}

      {/* Inline preview */}
      {previewId && (
        <ArtifactPreviewModal artifactId={previewId} onClose={() => setPreviewId(null)} />
      )}
      {assignId && (
        <ArtifactPreviewModal
          artifactId={assignId}
          onClose={() => setAssignId(null)}
          initialAssign
        />
      )}
    </div>
  );
}
