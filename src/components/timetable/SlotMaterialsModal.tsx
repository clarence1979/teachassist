import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  X, Paperclip, ExternalLink, Download, Trash2,
  FileText, Image as ImageIcon, BookOpen, ClipboardList, Layers, Star,
  Plus, ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDb } from '../../db/DbContext';
import type { Artifact, TimetableBlock } from '../../db/schema';
import { fmtTime } from '../../lib/timetable/dates';
import { typeColor } from './blockTypes';

function artifactIcon(type: Artifact['type']) {
  switch (type) {
    case 'image': return ImageIcon;
    case 'quiz': return ClipboardList;
    case 'slides': return Layers;
    case 'worksheet': return FileText;
    case 'notes': return BookOpen;
    case 'rubric': return Star;
    default: return FileText;
  }
}

function InlinePreview({ artifact }: { artifact: Artifact }) {
  const src = `data:${artifact.mediaType};base64,${artifact.data}`;
  if (artifact.mediaType?.startsWith('image/')) {
    return <img src={src} alt={artifact.title} className="w-full max-h-48 object-contain rounded-btn bg-black/20" />;
  }
  if (artifact.mediaType === 'application/pdf') {
    return <iframe src={src} className="w-full rounded-btn border border-border" style={{ height: 240 }} title={artifact.title} />;
  }
  if (artifact.mediaType === 'text/html') {
    return (
      <iframe
        srcDoc={atob(artifact.data)}
        sandbox="allow-scripts allow-same-origin"
        className="w-full rounded-btn border border-border bg-white"
        style={{ height: 240 }}
        title={artifact.title}
      />
    );
  }
  return <div className="h-16 flex items-center justify-center text-text-dim text-xs font-mono">No inline preview</div>;
}

interface Props {
  block: TimetableBlock;
  occurrenceStart?: string;
  occurrenceEnd?: string;
  onClose: () => void;
  onEdit: () => void;
  onOpenLibrary?: () => void;
}

export function SlotMaterialsModal({ block, occurrenceStart, occurrenceEnd, onClose, onEdit, onOpenLibrary }: Props) {
  const db = useDb();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const allArtifacts = useLiveQuery(() => db.artifacts.toArray(), [db]) ?? [];

  useEffect(() => {
    const ids = block.artifactIds ?? [];
    if (!ids.length) { setArtifacts([]); return; }
    Promise.all(ids.map((id) => db.artifacts.get(id))).then((results) => {
      setArtifacts(results.filter((a): a is Artifact => !!a));
    });
  }, [db, block.artifactIds]);

  const detach = async (artifactId: string) => {
    const ids = (block.artifactIds ?? []).filter((id) => id !== artifactId);
    await db.timetableBlocks.update(block.id, { artifactIds: ids });
    setArtifacts((prev) => prev.filter((a) => a.id !== artifactId));
    if (selectedId === artifactId) setSelectedId(null);
  };

  const handleDownload = (artifact: Artifact) => {
    const link = document.createElement('a');
    link.href = `data:${artifact.mediaType};base64,${artifact.data}`;
    const ext = artifact.mediaType === 'application/pdf' ? 'pdf'
      : artifact.mediaType?.startsWith('image/') ? 'png'
      : artifact.mediaType?.includes('presentation') ? 'pptx'
      : artifact.mediaType?.includes('wordprocessing') ? 'docx'
      : 'bin';
    link.download = `${artifact.title}.${ext}`;
    link.click();
  };

  const copyEmbedUrl = (artifact: Artifact) => {
    const url = `data:${artifact.mediaType};base64,${artifact.data}`;
    navigator.clipboard.writeText(url);
    setCopiedId(artifact.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const color = typeColor(block.type, block.color);
  const startStr = occurrenceStart ?? block.startISO;
  const endStr = occurrenceEnd ?? block.endISO;

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;

  // Unattached library items (for quick-add)
  const unattached = allArtifacts
    .filter((a) => !(block.artifactIds ?? []).includes(a.id))
    .slice(0, 20);

  const [showAdd, setShowAdd] = useState(false);

  const attachExisting = async (artifactId: string) => {
    const ids = new Set(block.artifactIds ?? []);
    ids.add(artifactId);
    await db.timetableBlocks.update(block.id, { artifactIds: [...ids] });
    setShowAdd(false);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-bg-panel border border-border rounded-lg shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-border bg-bg-elevated flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
          <div className="flex-1 min-w-0">
            <h2 className="font-orbitron text-sm font-bold text-text-primary truncate">{block.title}</h2>
            <div className="text-[10px] font-mono text-text-dim">
              {new Date(startStr).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
              {' · '}{fmtTime(startStr)}–{fmtTime(endStr)}
            </div>
          </div>
          <button
            onClick={onEdit}
            className="px-2.5 py-1 rounded-btn border border-border text-xs font-rajdhani font-semibold text-text-secondary hover:text-text-primary uppercase tracking-wider transition-colors"
          >
            Edit block
          </button>
          <button onClick={onClose} className="p-1.5 rounded-btn border border-border text-text-dim hover:text-text-primary transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Sidebar — artifact list */}
          <div className="shrink-0 w-56 border-r border-border flex flex-col overflow-hidden">
            <div className="shrink-0 px-3 py-2 border-b border-border bg-bg-elevated flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Paperclip size={11} className="text-accent-amber" />
                <span className="text-[10px] font-mono text-text-dim uppercase tracking-wider">Materials ({artifacts.length})</span>
              </div>
              <button
                onClick={() => setShowAdd((v) => !v)}
                className={clsx(
                  'p-1 rounded-btn border transition-colors',
                  showAdd ? 'border-accent-cyan/60 text-accent-cyan bg-accent-cyan/10' : 'border-border text-text-dim hover:text-text-primary',
                )}
                title="Attach from library"
              >
                <Plus size={11} />
              </button>
            </div>

            <div className="flex-1 overflow-auto">
              {!showAdd ? (
                <>
                  {artifacts.length === 0 && (
                    <div className="p-4 text-center">
                      <p className="text-xs text-text-dim font-mono">No materials attached.</p>
                      <p className="text-[10px] text-text-dim mt-1">Drag from Library or click + above.</p>
                    </div>
                  )}
                  {artifacts.map((a) => {
                    const Icon = artifactIcon(a.type);
                    return (
                      <button
                        key={a.id}
                        onClick={() => setSelectedId((s) => s === a.id ? null : a.id)}
                        className={clsx(
                          'w-full flex items-center gap-2 px-3 py-2 border-b border-border/50 text-left transition-colors',
                          selectedId === a.id ? 'bg-accent-cyan/10 border-l-2 border-l-accent-cyan' : 'hover:bg-bg-elevated',
                        )}
                      >
                        <Icon size={13} className={selectedId === a.id ? 'text-accent-cyan' : 'text-text-dim'} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-rajdhani font-semibold text-text-primary truncate">{a.title}</div>
                          <div className="text-[9px] font-mono text-text-dim capitalize">{a.type}</div>
                        </div>
                        <ChevronRight size={10} className={clsx('shrink-0 transition-opacity', selectedId === a.id ? 'opacity-100 text-accent-cyan' : 'opacity-0')} />
                      </button>
                    );
                  })}
                </>
              ) : (
                <div className="p-2 space-y-1">
                  <p className="text-[9px] font-mono text-text-dim px-1 pb-1">Click to attach from library:</p>
                  {unattached.length === 0 && <p className="text-[10px] text-text-dim font-mono text-center py-4">Library is empty.</p>}
                  {unattached.map((a) => {
                    const Icon = artifactIcon(a.type);
                    return (
                      <button
                        key={a.id}
                        onClick={() => attachExisting(a.id)}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-btn border border-border hover:border-accent-amber/60 hover:bg-accent-amber/5 text-left transition-all"
                      >
                        <Icon size={12} className="text-text-dim shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-rajdhani font-semibold text-text-primary truncate">{a.title}</div>
                          <div className="text-[9px] font-mono text-text-dim capitalize">{a.type}</div>
                        </div>
                        <Plus size={10} className="text-accent-amber shrink-0" />
                      </button>
                    );
                  })}
                  {onOpenLibrary && (
                    <button
                      onClick={onOpenLibrary}
                      className="w-full text-center text-[10px] font-mono text-accent-cyan hover:underline mt-2 py-1"
                    >
                      Browse full library
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Main — preview + embed */}
          <div className="flex-1 min-w-0 overflow-auto p-4">
            {!selected ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-text-dim">
                <Paperclip size={32} className="opacity-20" />
                <p className="text-sm font-mono">Select a material to preview</p>
                {artifacts.length === 0 && (
                  <p className="text-xs text-text-dim">Attach materials by clicking + in the sidebar.</p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Title bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-orbitron text-sm font-bold text-text-primary">{selected.title}</h3>
                    <p className="text-[10px] font-mono text-text-dim capitalize">{selected.type} · v{selected.version ?? 1}</p>
                  </div>
                  <button
                    onClick={() => handleDownload(selected)}
                    className="p-1.5 rounded-btn border border-border text-text-dim hover:text-text-primary transition-colors"
                    title="Download"
                  >
                    <Download size={13} />
                  </button>
                  <button
                    onClick={() => detach(selected.id)}
                    className="p-1.5 rounded-btn border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Detach from this slot"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {/* Preview */}
                <InlinePreview artifact={selected} />

                {/* SEQTA Embed section */}
                <div className="p-3 rounded-btn border border-border bg-bg-elevated space-y-2">
                  <div className="flex items-center gap-2">
                    <ExternalLink size={12} className="text-accent-cyan shrink-0" />
                    <span className="text-[10px] font-mono text-text-dim uppercase tracking-wider">SEQTA Embed</span>
                  </div>
                  <p className="text-[10px] text-text-dim font-mono">
                    Copy the data URL below and paste it into SEQTA using the HTML embed method.
                  </p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={`data:${selected.mediaType};base64,${selected.data}`.slice(0, 80) + '…'}
                      className="flex-1 input text-[9px] font-mono text-text-dim cursor-text"
                      title={`data:${selected.mediaType};base64,${selected.data}`}
                    />
                    <button
                      onClick={() => copyEmbedUrl(selected)}
                      className={clsx(
                        'px-3 py-1.5 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-all shrink-0',
                        copiedId === selected.id
                          ? 'border-accent-green bg-accent-green/10 text-accent-green'
                          : 'border-border text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {copiedId === selected.id ? 'Copied!' : 'Copy URL'}
                    </button>
                  </div>
                  <p className="text-[9px] font-mono text-text-dim">
                    HTML example: <code className="text-accent-cyan">&lt;iframe src="[paste here]" /&gt;</code>
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
