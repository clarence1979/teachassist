import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  X, Download, CalendarPlus, Check, ExternalLink, Paperclip,
  FileText, Image as ImageIcon, BookOpen, ClipboardList, Layers, Star,
  Maximize2, Minimize2, ZoomIn, ZoomOut, RotateCw,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDb } from '../db/DbContext';
import type { Artifact, TimetableBlock } from '../db/schema';
import { fmtTime, parseLocal } from '../lib/timetable/dates';

interface Props {
  artifactId: string;
  onClose: () => void;
  /** When true, the slot-assign side panel opens with the modal. */
  initialAssign?: boolean;
  /** Pre-select a specific block so the user sees exactly which slot is receiving the material. */
  focusBlockId?: string;
}

function artifactIcon(type: Artifact['type']) {
  switch (type) {
    case 'image': return ImageIcon;
    case 'infographic': return ImageIcon;
    case 'quiz': return ClipboardList;
    case 'slides': return Layers;
    case 'worksheet': return FileText;
    case 'notes': return BookOpen;
    case 'rubric': return Star;
    default: return FileText;
  }
}

// ─── Image viewer with zoom + rotate ─────────────────────────────────────────

function ImageViewer({ artifact }: { artifact: Artifact }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const src = `data:${artifact.mediaType};base64,${artifact.data}`;

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      {/* Controls */}
      <div className="flex items-center gap-2 self-end">
        <button
          onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
          className="p-1.5 rounded-btn border border-border text-text-dim hover:text-accent-cyan hover:border-accent-cyan transition-colors"
          title="Zoom out"
        >
          <ZoomOut size={13} />
        </button>
        <span className="text-[10px] font-mono text-text-dim w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
          className="p-1.5 rounded-btn border border-border text-text-dim hover:text-accent-cyan hover:border-accent-cyan transition-colors"
          title="Zoom in"
        >
          <ZoomIn size={13} />
        </button>
        <button
          onClick={() => setZoom(1)}
          className="px-2 py-1 rounded-btn border border-border text-[10px] font-mono text-text-dim hover:text-accent-cyan hover:border-accent-cyan transition-colors"
        >
          Reset
        </button>
        <button
          onClick={() => setRotation((r) => (r + 90) % 360)}
          className="p-1.5 rounded-btn border border-border text-text-dim hover:text-accent-cyan hover:border-accent-cyan transition-colors"
          title="Rotate 90°"
        >
          <RotateCw size={13} />
        </button>
      </div>

      {/* Image */}
      <div className="w-full overflow-auto flex justify-center" style={{ maxHeight: '65vh' }}>
        <img
          src={src}
          alt={artifact.title}
          draggable={false}
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            transition: 'transform 150ms ease',
            maxWidth: zoom <= 1 ? '100%' : 'none',
            display: 'block',
          }}
          className="rounded-btn select-none"
        />
      </div>
    </div>
  );
}

// ─── PDF viewer ───────────────────────────────────────────────────────────────

function PdfViewer({ artifact }: { artifact: Artifact }) {
  const src = `data:${artifact.mediaType};base64,${artifact.data}`;
  // Blob URL renders more reliably in Safari than a raw data: URL
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const bytes = Uint8Array.from(atob(artifact.data), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [artifact.data]);

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center h-48 text-text-dim text-sm font-mono">
        Loading PDF…
      </div>
    );
  }

  return (
    <iframe
      src={blobUrl}
      className="w-full rounded-btn border border-border"
      style={{ height: '68vh', minHeight: 400 }}
      title={artifact.title}
    />
  );
}

// ─── HTML viewer ─────────────────────────────────────────────────────────────

function HtmlViewer({ artifact }: { artifact: Artifact }) {
  const html = atob(artifact.data);
  return (
    <iframe
      srcDoc={html}
      sandbox="allow-scripts allow-same-origin"
      className="w-full rounded-btn border border-border bg-white"
      style={{ height: '68vh', minHeight: 400 }}
      title={artifact.title}
    />
  );
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

function ArtifactViewer({ artifact }: { artifact: Artifact }) {
  if (artifact.mediaType?.startsWith('image/')) {
    return <ImageViewer artifact={artifact} />;
  }
  if (artifact.mediaType === 'application/pdf') {
    return <PdfViewer artifact={artifact} />;
  }
  if (artifact.mediaType === 'text/html') {
    return <HtmlViewer artifact={artifact} />;
  }
  return (
    <div className="flex flex-col items-center justify-center h-40 gap-3 text-text-dim">
      <FileText size={36} className="opacity-30" />
      <span className="text-sm">
        Preview not available for this file type.<br />
        <span className="text-xs font-mono">{artifact.mediaType}</span>
      </span>
    </div>
  );
}

// ─── Main modal ──────────────────────────────────────────────────────────────

export function ArtifactPreviewModal({ artifactId, onClose, initialAssign, focusBlockId }: Props) {
  const db = useDb();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [assigning, setAssigning] = useState(!!initialAssign);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [justAssigned, setJustAssigned] = useState<Set<string>>(new Set());
  const [slotQuery, setSlotQuery] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const blocks = useLiveQuery(() => db.timetableBlocks.toArray(), [db]) ?? [];

  useEffect(() => {
    db.artifacts.get(artifactId).then((a) => setArtifact(a ?? null));
  }, [db, artifactId]);

  useEffect(() => {
    const ids = new Set<string>();
    for (const b of blocks) {
      if (b.artifactIds?.includes(artifactId)) ids.add(b.id);
    }
    setAssignedIds(ids);
  }, [blocks, artifactId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleAssign = async (block: TimetableBlock) => {
    const current = new Set(block.artifactIds ?? []);
    if (current.has(artifactId)) {
      current.delete(artifactId);
    } else {
      current.add(artifactId);
      setJustAssigned((prev) => new Set(prev).add(block.id));
      setTimeout(() => setJustAssigned((prev) => { const n = new Set(prev); n.delete(block.id); return n; }), 2000);
    }
    await db.timetableBlocks.update(block.id, { artifactIds: [...current] });
  };

  const handleDownload = () => {
    if (!artifact) return;
    const link = document.createElement('a');
    link.href = `data:${artifact.mediaType};base64,${artifact.data}`;
    const ext = artifact.mediaType === 'application/pdf' ? 'pdf'
      : artifact.mediaType?.startsWith('image/') ? 'png'
      : artifact.mediaType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ? 'pptx'
      : artifact.mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 'docx'
      : 'bin';
    link.download = `${artifact.title}.${ext}`;
    link.click();
  };

  const embedUrl = artifact ? `data:${artifact.mediaType};base64,${artifact.data}` : '';

  // Upcoming blocks sorted by time, filtered by the user's search query
  const now = Date.now();
  const q = slotQuery.trim().toLowerCase();
  const upcomingBlocks = [...blocks]
    .filter((b) => !b.recurrence)
    .filter((b) => parseLocal(b.endISO).getTime() >= now - 1000 * 60 * 60 * 24)
    .filter((b) => !q || b.title.toLowerCase().includes(q) || (b.location ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.startISO.localeCompare(b.startISO))
    .slice(0, 120);

  const groupedBlocks = upcomingBlocks.reduce<Record<string, TimetableBlock[]>>((acc, b) => {
    const day = parseLocal(b.startISO).toLocaleDateString('en-AU', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    (acc[day] ??= []).push(b);
    return acc;
  }, {});

  const Icon = artifact ? artifactIcon(artifact.type) : FileText;

  if (!artifact) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center">
        <div className="text-text-dim text-sm font-mono animate-pulse">Loading…</div>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center',
        fullscreen ? 'p-0' : 'p-3 sm:p-4',
      )}
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className={clsx(
          'bg-bg-panel border border-border shadow-2xl flex flex-col overflow-hidden',
          fullscreen
            ? 'w-full h-full rounded-none'
            : 'w-full max-w-5xl rounded-lg max-h-[95vh]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="shrink-0 px-4 py-3 border-b border-border bg-bg-elevated flex items-center gap-3">
          <div className="p-1.5 rounded-btn bg-bg-panel border border-border shrink-0">
            <Icon size={15} className="text-accent-cyan" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-orbitron text-sm font-bold text-text-primary truncate">{artifact.title}</h2>
            <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider">
              {artifact.type} · v{artifact.version ?? 1}
              {artifact.meta?.topic ? ` · ${artifact.meta.topic as string}` : ''}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Assign to slot */}
            <button
              onClick={() => setAssigning((a) => !a)}
              className={clsx(
                'hidden sm:flex px-3 py-1.5 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-all items-center gap-1.5',
                assigning
                  ? 'bg-accent-amber/20 border-accent-amber/60 text-accent-amber'
                  : 'border-border text-text-secondary hover:text-text-primary',
              )}
            >
              <CalendarPlus size={12} />
              Assign
              {assignedIds.size > 0 && (
                <span className="ml-0.5 bg-accent-amber text-bg-base text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {assignedIds.size}
                </span>
              )}
            </button>

            {/* Embed URL toggle */}
            <button
              onClick={() => setShowEmbed((s) => !s)}
              title="Show embed URL"
              className={clsx(
                'p-1.5 rounded-btn border transition-colors',
                showEmbed
                  ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/10'
                  : 'border-border text-text-dim hover:text-text-primary',
              )}
            >
              <ExternalLink size={14} />
            </button>

            {/* Download */}
            <button
              onClick={handleDownload}
              className="p-1.5 rounded-btn border border-border text-text-dim hover:text-text-primary transition-colors"
              title="Download"
            >
              <Download size={14} />
            </button>

            {/* Fullscreen toggle */}
            <button
              onClick={() => setFullscreen((f) => !f)}
              className="p-1.5 rounded-btn border border-border text-text-dim hover:text-accent-cyan hover:border-accent-cyan transition-colors"
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-btn border border-border text-text-dim hover:text-accent-red hover:border-accent-red/50 transition-colors"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Embed URL bar (collapsible) ── */}
        {showEmbed && (
          <div className="shrink-0 px-4 py-2.5 border-b border-border bg-bg-base/60 flex items-center gap-2">
            <ExternalLink size={11} className="text-accent-cyan shrink-0" />
            <span className="text-[10px] font-mono text-text-dim uppercase tracking-wider shrink-0">SEQTA embed</span>
            <input
              readOnly
              value={embedUrl.slice(0, 100) + (embedUrl.length > 100 ? '…' : '')}
              className="flex-1 input text-[10px] font-mono text-text-dim py-1 cursor-text min-w-0"
              title={embedUrl}
            />
            <button
              onClick={() => navigator.clipboard.writeText(embedUrl)}
              className="px-2.5 py-1 rounded-btn border border-border text-[10px] font-rajdhani font-semibold text-text-secondary hover:text-text-primary transition-colors shrink-0"
            >
              Copy
            </button>
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Preview area */}
          <div className={clsx(
            'flex-1 min-w-0 overflow-auto',
            fullscreen ? 'p-4' : 'p-4',
          )}>
            <ArtifactViewer artifact={artifact} />
          </div>

          {/* Slot assignment panel */}
          {assigning && (
            <div className="shrink-0 w-72 border-l border-border flex flex-col overflow-hidden">
              <div className="shrink-0 px-3 py-2.5 border-b border-border bg-bg-elevated space-y-2">
                <div className="flex items-center gap-2">
                  <Paperclip size={12} className="text-accent-amber" />
                  <span className="text-xs font-rajdhani font-bold uppercase tracking-wider text-text-primary">
                    Assign to Slot
                  </span>
                </div>
                <input
                  type="search"
                  value={slotQuery}
                  onChange={(e) => setSlotQuery(e.target.value)}
                  placeholder="Search by title or location…"
                  className="w-full input py-1.5 text-xs"
                />
                <p className="text-[9px] font-mono text-text-dim">
                  {assignedIds.size > 0
                    ? `Attached to ${assignedIds.size} slot${assignedIds.size === 1 ? '' : 's'}.`
                    : 'Tap a slot to attach this material.'}
                </p>
              </div>
              <div className="flex-1 overflow-auto p-2 space-y-3">
                {upcomingBlocks.length === 0 && (
                  <div className="text-center py-8 text-text-dim text-xs font-mono">
                    {q ? 'No matching slots.' : 'No upcoming timetable blocks.'}
                  </div>
                )}
                {Object.entries(groupedBlocks).map(([day, dayBlocks]) => (
                  <div key={day} className="space-y-1">
                    <div className="px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider text-text-dim sticky top-0 bg-bg-panel/95 backdrop-blur-sm">
                      {day}
                    </div>
                    {dayBlocks.map((b) => {
                      const attached = assignedIds.has(b.id);
                      const recent = justAssigned.has(b.id);
                      const focused = b.id === focusBlockId;
                      return (
                        <button
                          key={b.id}
                          onClick={() => toggleAssign(b)}
                          className={clsx(
                            'w-full flex items-center gap-2 px-2.5 py-2 rounded-btn border text-left transition-all',
                            focused && !attached && 'ring-1 ring-accent-cyan/60 border-accent-cyan/40',
                            attached
                              ? 'border-accent-amber/60 bg-accent-amber/10'
                              : 'border-border hover:bg-bg-elevated',
                          )}
                        >
                          <div className={clsx(
                            'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                            attached ? 'bg-accent-amber border-accent-amber' : 'border-border',
                          )}>
                            {(attached || recent) && <Check size={10} className="text-bg-base" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-rajdhani font-semibold text-text-primary truncate flex items-center gap-1.5">
                              {b.title}
                              {focused && (
                                <span className="text-[8px] font-mono bg-accent-cyan/20 text-accent-cyan px-1 py-0.5 rounded uppercase tracking-wider">selected</span>
                              )}
                            </div>
                            <div className="text-[9px] font-mono text-text-dim truncate">
                              {fmtTime(b.startISO)}–{fmtTime(b.endISO)}
                              {b.location ? ` · ${b.location}` : ''}
                            </div>
                          </div>
                          {attached && <Paperclip size={10} className="text-accent-amber shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
