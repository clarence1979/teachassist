import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  User,
  Sparkles,
  Copy,
  Check,
  RefreshCw,
  Pencil,
  GitBranch,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  BookOpen,
  ClipboardList,
  Layers,
  Star,
  Eye,
  CalendarPlus,
  Square,
  Trash2,
  Clock,
} from 'lucide-react';

const AEST_TZ = 'Australia/Sydney';

function fmtAEST(ts: number): { date: string; time: string } {
  const d = new Date(ts);
  const today = new Date();
  const dateStr = d.toLocaleDateString('en-AU', { timeZone: AEST_TZ, weekday: 'short', day: 'numeric', month: 'short' });
  const todayStr = today.toLocaleDateString('en-AU', { timeZone: AEST_TZ, weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = d.toLocaleTimeString('en-AU', { timeZone: AEST_TZ, hour: '2-digit', minute: '2-digit', hour12: true });
  return {
    date: dateStr === todayStr ? 'Today' : dateStr,
    time: timeStr,
  };
}
import { renderMarkdown } from '../../lib/markdown';
import type { Message, MessageAttachment, Artifact } from '../../db/schema';
import { ToolCallCard } from './ToolCallCard';
import { ArtifactPreviewModal } from '../ArtifactPreviewModal';

interface Props {
  message: Message;
  siblings: Message[];
  artifacts?: Artifact[];
  onRegenerate?: () => void;
  onEdit?: (newText: string) => void;
  onSwitchBranch?: (targetId: string) => void;
  /** Remove this message (and its descendants) from the conversation. */
  onDelete?: () => void;
  /** If set, this message is currently streaming — show a stop button. */
  onStop?: () => void;
  isStreaming?: boolean;
}

function AttachmentPreview({ a }: { a: MessageAttachment }) {
  if (a.kind === 'image') {
    const src = `data:${a.mediaType};base64,${a.data}`;
    return (
      <div className="relative group max-w-xs">
        <img
          src={src}
          alt={a.name}
          className="rounded-btn border border-border max-h-48 object-contain"
        />
        <div className="absolute bottom-1 left-1 right-1 text-xs font-mono text-text-dim bg-bg-base/80 px-1.5 py-0.5 rounded truncate">
          {a.name}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-elevated border border-border rounded-btn text-xs max-w-xs">
      <FileText size={12} className="text-accent-cyan shrink-0" />
      <span className="font-mono text-text-secondary truncate flex-1">{a.name}</span>
      <span className="font-mono text-text-dim shrink-0">
        {Math.ceil((a.size ?? 0) / 1024)} KB
      </span>
    </div>
  );
}

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

function artifactAccent(type: Artifact['type']): string {
  switch (type) {
    case 'image': return 'text-accent-amber border-accent-amber/30 bg-accent-amber/5';
    case 'quiz': return 'text-accent-cyan border-accent-cyan/30 bg-accent-cyan/5';
    case 'slides': return 'text-blue-400 border-blue-400/30 bg-blue-400/5';
    case 'worksheet': return 'text-accent-green border-accent-green/30 bg-accent-green/5';
    case 'notes': return 'text-text-secondary border-border bg-bg-elevated';
    case 'rubric': return 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5';
    default: return 'text-text-secondary border-border bg-bg-elevated';
  }
}

function ArtifactInlinePreview({ artifact }: { artifact: Artifact }) {
  const src = `data:${artifact.mediaType};base64,${artifact.data}`;
  if (artifact.mediaType?.startsWith('image/')) {
    return <img src={src} alt={artifact.title} className="w-full max-h-40 object-contain rounded-t-btn" />;
  }
  if (artifact.mediaType === 'text/html') {
    return (
      <iframe
        srcDoc={atob(artifact.data)}
        sandbox="allow-scripts allow-same-origin"
        className="w-full rounded-t-btn bg-white"
        style={{ height: 140, pointerEvents: 'none' }}
        title={artifact.title}
      />
    );
  }
  if (artifact.mediaType === 'application/pdf') {
    return (
      <iframe
        src={src}
        className="w-full rounded-t-btn"
        style={{ height: 140, pointerEvents: 'none' }}
        title={artifact.title}
      />
    );
  }
  return null;
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const Icon = artifactIcon(artifact.type);
  const accent = artifactAccent(artifact.type);
  const hasVisualPreview = artifact.mediaType?.startsWith('image/')
    || artifact.mediaType === 'text/html'
    || artifact.mediaType === 'application/pdf';

  return (
    <>
      <div className={clsx('rounded-btn border overflow-hidden flex flex-col', accent)}>
        {/* Clickable thumbnail — opens full preview */}
        {hasVisualPreview && (
          <button
            onClick={() => setPreviewOpen(true)}
            className="border-b border-current/10 overflow-hidden shrink-0 relative group/thumb w-full text-left"
            title="Click to preview"
          >
            <ArtifactInlinePreview artifact={artifact} />
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/30 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center gap-1.5 px-3 py-1.5 rounded-btn bg-bg-base/80 border border-border text-xs font-rajdhani font-semibold text-text-primary">
                <Eye size={12} />
                Quick view
              </div>
            </div>
          </button>
        )}

        <div className="px-3 py-2.5 flex items-center gap-2">
          <Icon size={14} className="shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-rajdhani font-bold truncate">{artifact.title}</div>
            <div className="text-[9px] font-mono opacity-60 capitalize">{artifact.type} · v{artifact.version ?? 1}</div>
          </div>
          <button
            onClick={() => setPreviewOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded border border-current/30 text-[10px] font-rajdhani font-semibold uppercase tracking-wider hover:opacity-80 transition-opacity shrink-0"
          >
            <Eye size={10} />View
          </button>
          <button
            onClick={() => setAssignOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded border border-current/30 text-[10px] font-rajdhani font-semibold uppercase tracking-wider hover:opacity-80 transition-opacity shrink-0"
            title="Assign to timetable slot"
          >
            <CalendarPlus size={10} />Assign
          </button>
        </div>
      </div>
      {previewOpen && (
        <ArtifactPreviewModal artifactId={artifact.id} onClose={() => setPreviewOpen(false)} />
      )}
      {assignOpen && (
        <ArtifactPreviewModal
          artifactId={artifact.id}
          onClose={() => setAssignOpen(false)}
          initialAssign
        />
      )}
    </>
  );
}

export function MessageItem({ message, siblings, artifacts = [], onRegenerate, onEdit, onSwitchBranch, onDelete, onStop, isStreaming }: Props) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);

  const isUser = message.role === 'user';

  const renderedHtml = useMemo(
    () => (message.content ? renderMarkdown(message.content) : ''),
    [message.content],
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const handleSaveEdit = () => {
    // Resend even if the text is unchanged — the user may be retrying the
    // same prompt + attachments after a failed or unsatisfactory response.
    // Only require that *some* content is present (text OR an attachment).
    const hasText = editValue.trim().length > 0;
    const hasAttachments = (message.attachments?.length ?? 0) > 0;
    if (hasText || hasAttachments) {
      onEdit?.(editValue);
    }
    setEditing(false);
  };

  const currentSiblingIdx = siblings.findIndex((s) => s.id === message.id);
  const hasBranches = siblings.length > 1;

  return (
    <div className={clsx('group flex gap-3 py-4', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={clsx(
          'shrink-0 w-8 h-8 rounded-full border flex items-center justify-center',
          isUser
            ? 'bg-bg-elevated border-border'
            : 'bg-accent-cyan/10 border-accent-cyan/40',
        )}
      >
        {isUser ? (
          <User size={14} className="text-text-secondary" />
        ) : (
          <Sparkles size={14} className="text-accent-cyan" />
        )}
      </div>

      {/* Content */}
      <div className={clsx('flex-1 min-w-0', isUser && 'flex flex-col items-end')}>
        <div
          className={clsx(
            'max-w-full',
            isUser
              ? 'inline-block bg-bg-elevated border border-border rounded-btn px-4 py-2.5'
              : '',
          )}
        >
          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className={clsx('flex flex-wrap gap-2 mb-2', isUser ? 'justify-end' : '')}>
              {message.attachments.map((a) => (
                <AttachmentPreview key={a.id} a={a} />
              ))}
            </div>
          )}

          {/* Text */}
          {editing ? (
            <div className="space-y-2 w-full">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                autoFocus
                rows={Math.min(12, Math.max(3, editValue.split('\n').length))}
                className="w-full bg-bg-base border border-accent-cyan rounded-btn px-3 py-2 font-inter text-sm text-text-primary outline-none caret-accent-cyan resize-y"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setEditing(false); setEditValue(message.content); }}
                  className="px-3 py-1 rounded-btn border border-border text-xs text-text-secondary hover:border-accent-red hover:text-accent-red transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1 rounded-btn border border-accent-cyan text-xs text-accent-cyan hover:bg-accent-cyan/10 transition-colors"
                >
                  Save & resend
                </button>
              </div>
            </div>
          ) : (
            <>
              {message.content && (
                <div
                  className={clsx('prose-chat', isUser ? 'text-text-primary' : 'text-text-primary')}
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              )}
              {isStreaming && !message.content && (
                <span className="inline-flex gap-1 items-center text-text-dim">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse [animation-delay:300ms]" />
                </span>
              )}
              {isStreaming && onStop && (
                <div className="mt-2">
                  <button
                    onClick={onStop}
                    aria-label="Stop generating"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-btn border border-accent-red/50 text-accent-red text-[10px] font-rajdhani font-semibold uppercase tracking-wider hover:bg-accent-red/10 transition-colors"
                  >
                    <Square size={10} className="fill-current" />
                    Stop
                  </button>
                </div>
              )}
            </>
          )}

          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="space-y-1.5 mt-2">
              {message.toolCalls.map((tc, i) => (
                <ToolCallCard key={tc.id || i} tc={tc} />
              ))}
            </div>
          )}

          {/* Artifact cards */}
          {artifacts.length > 0 && (
            <div className="mt-3 space-y-2 w-full max-w-sm">
              {artifacts.map((a) => (
                <ArtifactCard key={a.id} artifact={a} />
              ))}
            </div>
          )}

          {!isUser && !isStreaming && message.content && (
            <div className="flex items-center gap-0.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleCopy}
                aria-label="Copy message"
                className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan transition-colors"
              >
                {copied ? <Check size={12} className="text-accent-green" /> : <Copy size={12} />}
              </button>
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  aria-label="Regenerate"
                  className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan transition-colors"
                >
                  <RefreshCw size={12} />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => {
                    if (window.confirm('Delete this message and any follow-ups?')) onDelete();
                  }}
                  aria-label="Delete message"
                  className="p-1.5 rounded-btn text-text-dim hover:text-accent-red transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              )}
              {hasBranches && (
                <div className="flex items-center gap-0.5 ml-1 px-1 border-l border-border">
                  <button
                    onClick={() => {
                      const prev = siblings[currentSiblingIdx - 1];
                      if (prev) onSwitchBranch?.(prev.id);
                    }}
                    disabled={currentSiblingIdx <= 0}
                    aria-label="Previous branch"
                    className="p-1 text-text-dim hover:text-accent-cyan disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft size={11} />
                  </button>
                  <span className="text-xs font-mono text-text-dim">
                    <GitBranch size={9} className="inline mr-0.5" />
                    {currentSiblingIdx + 1}/{siblings.length}
                  </span>
                  <button
                    onClick={() => {
                      const next = siblings[currentSiblingIdx + 1];
                      if (next) onSwitchBranch?.(next.id);
                    }}
                    disabled={currentSiblingIdx >= siblings.length - 1}
                    aria-label="Next branch"
                    className="p-1 text-text-dim hover:text-accent-cyan disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight size={11} />
                  </button>
                </div>
              )}

              {message.usage && (
                <span className="ml-auto text-xs font-mono text-text-dim">
                  {message.usage.inputTokens} → {message.usage.outputTokens}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Timestamp — always visible, subtle */}
        {message.createdAt && !editing && (
          <div className={clsx(
            'flex items-center gap-1 mt-1 text-[10px] font-mono text-text-dim',
            isUser ? 'justify-end' : 'justify-start',
          )}>
            <Clock size={9} className="shrink-0" />
            {(() => {
              const { date, time } = fmtAEST(message.createdAt);
              return <span>{date === 'Today' ? time : `${date}, ${time}`} AEST</span>;
            })()}
          </div>
        )}

        {/* User actions */}
        {isUser && !editing && (
          <div className="flex items-center gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setEditing(true)}
              aria-label="Edit message"
              className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan transition-colors"
            >
              <Pencil size={12} />
            </button>
            {onDelete && (
              <button
                onClick={() => {
                  if (window.confirm('Delete this message and any follow-ups?')) onDelete();
                }}
                aria-label="Delete message"
                className="p-1.5 rounded-btn text-text-dim hover:text-accent-red transition-colors"
              >
                <Trash2 size={12} />
              </button>
            )}
            {hasBranches && (
              <div className="flex items-center gap-0.5 ml-1 px-1 border-l border-border">
                <button
                  onClick={() => {
                    const prev = siblings[currentSiblingIdx - 1];
                    if (prev) onSwitchBranch?.(prev.id);
                  }}
                  disabled={currentSiblingIdx <= 0}
                  aria-label="Previous branch"
                  className="p-1 text-text-dim hover:text-accent-cyan disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={11} />
                </button>
                <span className="text-xs font-mono text-text-dim">
                  {currentSiblingIdx + 1}/{siblings.length}
                </span>
                <button
                  onClick={() => {
                    const next = siblings[currentSiblingIdx + 1];
                    if (next) onSwitchBranch?.(next.id);
                  }}
                  disabled={currentSiblingIdx >= siblings.length - 1}
                  aria-label="Next branch"
                  className="p-1 text-text-dim hover:text-accent-cyan disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={11} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
