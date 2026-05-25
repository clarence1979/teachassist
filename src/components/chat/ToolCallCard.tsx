import { useState, useEffect } from 'react';
import {
  ChevronDown, ChevronRight, Wrench, Loader2, CheckCircle2, AlertCircle,
  FileText, Presentation as PresentationIcon, BookOpen, ClipboardList, ImageIcon,
  ListChecks, Calendar, ListTodo, Search, Paperclip, Download, X, ZoomIn, Globe,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { ToolInvocation } from '../../db/schema';
import type { Artifact } from '../../db/schema';
import { useDb } from '../../db/DbContext';

const TOOL_META: Record<string, { label: string; Icon: typeof Wrench }> = {
  generate_slides: { label: 'Generate slides', Icon: PresentationIcon },
  generate_pdf_document: { label: 'Generate document', Icon: FileText },
  generate_worksheet: { label: 'Generate worksheet', Icon: ClipboardList },
  generate_student_notes: { label: 'Generate notes', Icon: BookOpen },
  generate_quiz: { label: 'Generate quiz', Icon: ListChecks },
  generate_rubric: { label: 'Generate rubric', Icon: ClipboardList },
  generate_image: { label: 'Generate image', Icon: ImageIcon },
  generate_lesson_plan: { label: 'Generate lesson plan', Icon: FileText },
  add_task: { label: 'Add task', Icon: ListTodo },
  prioritise_tasks: { label: 'Re-prioritise tasks', Icon: ListTodo },
  schedule_block: { label: 'Schedule block', Icon: Calendar },
  populate_week_with_ai: { label: 'AI week planner', Icon: Calendar },
  parse_timetable_image: { label: 'Parse timetable', Icon: Calendar },
  search_library: { label: 'Search library', Icon: Search },
  attach_resource_to_block: { label: 'Attach resource', Icon: Paperclip },
  fetch_webpage: { label: 'Read webpage', Icon: Globe },
};

function summarise(tc: ToolInvocation): string {
  const r = tc.result as { summary?: string } | undefined;
  if (r?.summary) return r.summary;
  const args = tc.arguments;
  const name = tc.name;
  if (name === 'generate_slides') return `${args.slideCount ?? '?'} slides on ${args.topic} for ${args.yearLevel}`;
  if (name === 'generate_worksheet') return `${args.count ?? '?'}-question worksheet on ${args.topic} for ${args.yearLevel}`;
  if (name === 'generate_student_notes') return `${args.depth ?? 'standard'} notes on ${args.topic} for ${args.yearLevel}`;
  if (name === 'generate_quiz') return `${args.count ?? '?'}-question quiz on ${args.topic} for ${args.yearLevel}`;
  if (name === 'generate_rubric') return `Rubric for ${args.assessmentTitle}`;
  if (name === 'generate_lesson_plan') return `${args.durationMin ?? '?'}-min lesson plan on ${args.topic} for ${args.yearLevel}`;
  if (name === 'generate_image') return String(args.prompt ?? '').slice(0, 60);
  if (name === 'add_task') return String(args.title ?? '');
  if (name === 'schedule_block') return String(args.title ?? '');
  if (name === 'search_library') return `"${args.query ?? ''}"`;
  return Object.entries(args).slice(0, 2).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
}

function b64ToBlob(b64: string, mime: string): Blob {
  const byteStr = atob(b64);
  const len = byteStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = byteStr.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function extFor(mime: string): string {
  if (mime.includes('presentation')) return 'pptx';
  if (mime.includes('wordprocessing')) return 'docx';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'text/markdown') return 'md';
  return 'bin';
}

function downloadArtifact(a: Artifact) {
  const blob = a.mediaType === 'text/markdown'
    ? new Blob([decodeURIComponent(escape(atob(a.data)))], { type: 'text/markdown' })
    : b64ToBlob(a.data, a.mediaType);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${a.title.replace(/[^a-z0-9_\-]/gi, '_')}.${extFor(a.mediaType)}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

// ─── Image lightbox ───────────────────────────────────────────────────────────

function ImageLightbox({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const src = `data:${artifact.mediaType};base64,${artifact.data}`;
  const [downloading, setDownloading] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleDownload = async () => {
    setDownloading(true);
    try { downloadArtifact(artifact); }
    finally { setDownloading(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl w-full flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 p-1.5 rounded-full bg-bg-elevated border border-border text-text-secondary hover:text-accent-red transition-colors"
          aria-label="Close"
        >
          <X size={14} />
        </button>

        {/* Image */}
        <img
          src={src}
          alt={artifact.title}
          className="rounded-lg max-h-[75vh] w-auto object-contain shadow-2xl border border-white/10"
        />

        {/* Caption + download */}
        <div className="flex items-center gap-3 px-4 py-2 rounded-btn bg-bg-elevated border border-border">
          <span className="text-xs text-text-secondary truncate max-w-xs">{artifact.title}</span>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn bg-accent-cyan text-bg-base text-xs font-rajdhani font-bold uppercase tracking-wider hover:brightness-110 transition-colors shrink-0 disabled:opacity-60"
          >
            <Download size={11} />
            {downloading ? 'Saving…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Image thumbnail (inline in chat) ────────────────────────────────────────

function ImageArtifactThumbnail({ id }: { id: string }) {
  const db = useDb();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    void db.artifacts.get(id).then((a) => { if (a) setArtifact(a); });
  }, [db, id]);

  if (!artifact) return null;

  const src = `data:${artifact.mediaType};base64,${artifact.data}`;

  return (
    <>
      <button
        onClick={() => setLightboxOpen(true)}
        className="relative group/img block rounded-lg overflow-hidden border border-border hover:border-accent-cyan/60 transition-colors shadow-md"
        aria-label="View generated image"
        title="Click to view full size"
      >
        <img
          src={src}
          alt={artifact.title}
          className="w-full max-w-sm object-cover block"
          style={{ maxHeight: 220 }}
        />
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/40 transition-colors flex items-center justify-center">
          <div className="opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center gap-1.5 px-3 py-1.5 rounded-btn bg-bg-base/90 border border-border text-xs font-rajdhani font-semibold text-text-primary">
            <ZoomIn size={12} />
            View full size
          </div>
        </div>
      </button>
      {lightboxOpen && (
        <ImageLightbox artifact={artifact} onClose={() => setLightboxOpen(false)} />
      )}
    </>
  );
}

// ─── Generic download row (non-image artifacts) ───────────────────────────────

function ArtifactRow({ id }: { id: string }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState<string>('Artifact');
  const [mediaType, setMediaType] = useState<string>('');
  useEffect(() => {
    void db.artifacts.get(id).then((a) => {
      if (a) { setTitle(a.title); setMediaType(a.mediaType); }
    });
  }, [db, id]);

  const download = async () => {
    setBusy(true);
    try {
      const a = await db.artifacts.get(id);
      if (!a) return;
      downloadArtifact(a);
    } finally { setBusy(false); }
  };

  return (
    <button
      onClick={download}
      disabled={busy}
      aria-label={`Download ${title}`}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-btn border border-border bg-bg-base hover:border-accent-cyan/60 hover:bg-accent-cyan/5 focus:outline-none focus:ring-2 focus:ring-accent-cyan transition-colors text-left text-xs"
    >
      <Download size={11} className="text-accent-cyan shrink-0" />
      <span className="text-text-secondary truncate flex-1">{title}</span>
      <span className="text-[9px] font-mono uppercase text-text-dim">{extFor(mediaType)}</span>
    </button>
  );
}

// ─── Smart artifact renderer: image → thumbnail, other → download row ─────────

function ArtifactItem({ id }: { id: string }) {
  const db = useDb();
  const [mediaType, setMediaType] = useState<string | null>(null);

  useEffect(() => {
    void db.artifacts.get(id).then((a) => { if (a) setMediaType(a.mediaType); });
  }, [db, id]);

  if (mediaType === null) return null;
  if (mediaType.startsWith('image/')) return <ImageArtifactThumbnail id={id} />;
  return <ArtifactRow id={id} />;
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function ToolCallCard({ tc }: { tc: ToolInvocation }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_META[tc.name] ?? { label: tc.name, Icon: Wrench };
  const Icon = meta.Icon;

  const result = tc.result as { artifactIds?: string[]; details?: Record<string, unknown> } | undefined;
  const artifactIds = result?.artifactIds ?? [];

  // For generate_image, show thumbnail directly in the card header (always visible, not just when expanded)
  const isImageTool = tc.name === 'generate_image';
  const imageArtifactIds = isImageTool ? artifactIds : [];
  const otherArtifactIds = isImageTool ? [] : artifactIds;

  const statusIcon =
    tc.status === 'pending' ? <Loader2 size={11} className="animate-spin text-accent-amber" />
    : tc.status === 'error' ? <AlertCircle size={11} className="text-red-400" />
    : <CheckCircle2 size={11} className="text-accent-green" />;

  const borderClr =
    tc.status === 'error' ? 'border-red-500/40 bg-red-500/5'
    : tc.status === 'pending' ? 'border-accent-amber/40 bg-accent-amber/5'
    : 'border-accent-cyan/30 bg-accent-cyan/5';

  return (
    <div className={clsx('border rounded-btn text-xs transition-colors', borderClr)}>
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={`${meta.label} — ${tc.status}`}
        className="w-full flex items-center gap-2 px-3 py-2 text-left focus:outline-none focus:ring-2 focus:ring-accent-cyan rounded-btn"
      >
        <Icon size={12} className="text-accent-cyan shrink-0" />
        <span className="font-rajdhani font-semibold uppercase tracking-wider text-[10px] text-accent-cyan shrink-0">
          {meta.label}
        </span>
        <span className="text-text-secondary flex-1 truncate">{summarise(tc)}</span>
        {statusIcon}
        {expanded ? (
          <ChevronDown size={11} className="shrink-0 text-text-dim" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-text-dim" />
        )}
      </button>

      {/* Image thumbnails always visible once generation is done */}
      {imageArtifactIds.length > 0 && tc.status !== 'pending' && (
        <div className="px-3 pb-3 space-y-2">
          {imageArtifactIds.map((id) => (
            <ImageArtifactThumbnail key={id} id={id} />
          ))}
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-border/50">
          {otherArtifactIds.length > 0 && (
            <div className="pt-2">
              <div className="text-text-dim uppercase tracking-wider text-[10px] font-rajdhani font-semibold mb-1">
                Generated files ({otherArtifactIds.length})
              </div>
              <div className="space-y-1">
                {otherArtifactIds.map((id) => <ArtifactItem key={id} id={id} />)}
              </div>
            </div>
          )}
          {tc.error && (
            <div>
              <div className="text-red-400 uppercase tracking-wider text-[10px] font-rajdhani font-semibold mb-1">Error</div>
              <p className="text-red-400 font-mono">{tc.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
