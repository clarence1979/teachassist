import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  X, Clock, Palette, Bell, MapPin, StickyNote, Repeat, Trash2,
  Paperclip, Eye, Plus, Share2, Link as LinkIcon, Copy, Check,
  FileText, Image as ImageIcon, BookOpen, ClipboardList, Layers, Star, Code2, Lock,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { TimetableBlock, BlockType, Artifact } from '../../db/schema';
import { RECURRENCE_PRESETS, humanReadableRRule } from '../../lib/timetable/recurrence';
import { isoDate } from '../../lib/timetable/dates';
import { useDb } from '../../db/DbContext';
import { useCredentials } from '../../contexts/CredentialsContext';
import { ArtifactPreviewModal } from '../ArtifactPreviewModal';
import { BLOCK_TYPES } from './blockTypes';
import { REMINDER_OPTIONS, ensureNotificationPermission } from '../../lib/timetable/reminders';
import { publishShare, revokeShare, buildShareUrl, buildEmbedIframe } from '../../lib/timetable/share';

export { BLOCK_TYPES, typeColor } from './blockTypes';

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

interface BlockEditorProps {
  initial?: Partial<TimetableBlock>;
  defaultDate?: string;
  isRecurringInstance?: boolean;
  onSave: (patch: Partial<TimetableBlock>, scope: 'single' | 'series') => void;
  onDelete?: (scope: 'single' | 'series') => void;
  onCancel: () => void;
}

export function BlockEditor({ initial, defaultDate, isRecurringInstance, onSave, onDelete, onCancel }: BlockEditorProps) {
  const db = useDb();
  const { username } = useCredentials();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [type, setType] = useState<BlockType>(initial?.type ?? 'class');
  const [customColor, setCustomColor] = useState(initial?.color ?? '#06b6d4');
  const [subtype, setSubtype] = useState(initial?.subtype ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const safeDate = (iso?: string): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return isoDate(d);
  };
  const safeTime = (iso?: string): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const [date, setDate] = useState(
    safeDate(initial?.startISO) ?? defaultDate ?? isoDate(new Date()),
  );
  const [startTime, setStartTime] = useState(safeTime(initial?.startISO) ?? '09:00');
  const [endTime, setEndTime] = useState(safeTime(initial?.endISO) ?? '10:00');
  const [recurrence, setRecurrence] = useState(initial?.recurrence ?? '');
  const [scope, setScope] = useState<'single' | 'series'>(isRecurringInstance ? 'single' : 'series');
  const [artifactIds, setArtifactIds] = useState<string[]>(initial?.artifactIds ?? []);
  const [reminderOffsetMin, setReminderOffsetMin] = useState<number | undefined>(initial?.reminderOffsetMin);
  const [shareId, setShareId] = useState<string | undefined>(initial?.shareId);
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(null);
  const [showAddArtifact, setShowAddArtifact] = useState(false);
  const [attachedArtifacts, setAttachedArtifacts] = useState<Artifact[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copiedKind, setCopiedKind] = useState<'link' | 'iframe' | null>(null);
  const [notifDenied, setNotifDenied] = useState(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'denied',
  );

  const allArtifacts = useLiveQuery(() => db.artifacts.toArray(), [db]) ?? [];

  useEffect(() => {
    if (!artifactIds.length) { setAttachedArtifacts([]); return; }
    Promise.all(artifactIds.map((id) => db.artifacts.get(id))).then((results) => {
      setAttachedArtifacts(results.filter((a): a is Artifact => !!a));
    });
  }, [db, artifactIds]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const detachArtifact = (id: string) => {
    setArtifactIds((prev) => prev.filter((x) => x !== id));
  };

  const addArtifact = (id: string) => {
    if (!artifactIds.includes(id)) setArtifactIds((prev) => [...prev, id]);
    setShowAddArtifact(false);
  };

  const handleReminderChange = async (raw: string) => {
    const parsed = raw === '' ? undefined : Number(raw);
    setReminderOffsetMin(parsed);
    if (parsed !== undefined) {
      const ok = await ensureNotificationPermission();
      if (!ok) {
        setNotifDenied(true);
      } else {
        setNotifDenied(false);
      }
    }
  };

  const copyToClipboard = async (text: string, kind: 'link' | 'iframe') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKind(kind);
      setTimeout(() => setCopiedKind(null), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
      setCopiedKind(kind);
      setTimeout(() => setCopiedKind(null), 2000);
    }
  };

  const generateShare = async () => {
    if (!initial?.id) {
      setShareError('Save the block before sharing.');
      return;
    }
    setSharing(true);
    setShareError(null);
    try {
      const dbBlock = await db.timetableBlocks.get(initial.id);
      if (!dbBlock) throw new Error('Block not found.');
      // Build snapshot from current UI state + stored record
      const snapshotBlock: TimetableBlock = {
        ...dbBlock,
        title: title.trim() || dbBlock.title,
        type,
        color: type === 'custom' ? customColor : undefined,
        subtype: subtype.trim() || undefined,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
        startISO: `${date}T${startTime}:00`,
        endISO: `${date}T${endTime}:00`,
        artifactIds,
      };
      const artifacts = (
        await Promise.all(artifactIds.map((id) => db.artifacts.get(id)))
      ).filter((a): a is Artifact => !!a);
      const { shareId: newId } = await publishShare({
        block: snapshotBlock,
        artifacts,
        ownerUsername: username,
        existingShareId: shareId,
      });
      setShareId(newId);
      await db.timetableBlocks.update(initial.id, { shareId: newId });
    } catch (e) {
      setShareError(e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

  const stopShare = async () => {
    if (!shareId) return;
    setSharing(true);
    setShareError(null);
    try {
      await revokeShare(shareId);
      setShareId(undefined);
      if (initial?.id) await db.timetableBlocks.update(initial.id, { shareId: undefined });
    } catch (e) {
      setShareError(e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const startISO = `${date}T${startTime}:00`;
    const endISO = `${date}T${endTime}:00`;
    onSave({
      title: title.trim(),
      type,
      color: type === 'custom' ? customColor : undefined,
      subtype: subtype.trim() || undefined,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      startISO,
      endISO,
      recurrence: recurrence || undefined,
      artifactIds,
      reminderOffsetMin,
      shareId,
    }, scope);
  };

  const unattached = allArtifacts.filter((a) => !artifactIds.includes(a.id));
  const shareUrl = shareId ? buildShareUrl(shareId) : '';
  const iframeCode = shareId ? buildEmbedIframe(shareId) : '';

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
        <form
          onSubmit={submit}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg bg-bg-panel border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          <div className="shrink-0 px-4 py-3 flex items-center justify-between border-b border-border bg-bg-elevated">
            <div>
              <h2 className="font-orbitron text-base font-bold text-text-primary">{initial?.id ? 'EDIT BLOCK' : 'NEW BLOCK'}</h2>
              {isRecurringInstance && (
                <p className="text-[10px] font-mono text-accent-amber mt-0.5">This is part of a recurring series</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {initial?.id && (
                <button
                  type="button"
                  onClick={() => setShareOpen((v) => !v)}
                  className={clsx(
                    'p-1.5 rounded-btn border transition-colors flex items-center gap-1',
                    shareOpen || shareId
                      ? 'border-accent-cyan/60 text-accent-cyan bg-accent-cyan/10'
                      : 'border-border text-text-dim hover:text-text-primary',
                  )}
                  title="Share this block"
                >
                  <Share2 size={13} />
                  {shareId && <span className="text-[9px] font-mono">LIVE</span>}
                </button>
              )}
              <button type="button" onClick={onCancel} className="p-1 text-text-dim hover:text-text-primary transition-colors"><X size={16} /></button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-4">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Block title" className="input text-sm" required />

            <div>
              <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1.5 flex items-center gap-1"><Palette size={10} />Type</div>
              <div className="grid grid-cols-4 gap-1.5">
                {BLOCK_TYPES.map((bt) => (
                  <button
                    key={bt.value}
                    type="button"
                    onClick={() => setType(bt.value)}
                    className={clsx(
                      'px-2 py-1.5 rounded-btn border text-[11px] font-rajdhani font-semibold uppercase tracking-wider transition-all',
                      type === bt.value ? 'border-transparent text-bg-base' : 'border-border text-text-secondary hover:text-text-primary',
                    )}
                    style={type === bt.value ? { background: bt.color } : { borderColor: `${bt.color}40` }}
                  >
                    {bt.label}
                  </button>
                ))}
              </div>
            </div>

            {type === 'custom' && (
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider">Colour</div>
                <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)} className="h-7 w-12 rounded border border-border bg-bg-elevated cursor-pointer" />
                <input value={subtype} onChange={(e) => setSubtype(e.target.value)} placeholder="Sub-label (e.g. meal, sleep, exercise)" className="input text-sm flex-1" />
              </div>
            )}
            {type === 'personal' && (
              <input value={subtype} onChange={(e) => setSubtype(e.target.value)} placeholder="Sub-label (optional)" className="input text-sm" />
            )}

            <div>
              <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1.5 flex items-center gap-1"><Clock size={10} />When</div>
              <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input text-sm" />
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input text-sm" step={900} />
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input text-sm" step={900} />
              </div>
            </div>

            <div>
              <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1.5 flex items-center gap-1"><Repeat size={10} />Recurrence</div>
              <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="input text-sm">
                {RECURRENCE_PRESETS.map((p) => (
                  <option key={p.rrule} value={p.rrule}>{p.label}</option>
                ))}
                {recurrence && !RECURRENCE_PRESETS.some((p) => p.rrule === recurrence) && (
                  <option value={recurrence}>Custom: {humanReadableRRule(recurrence)}</option>
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1.5 flex items-center gap-1"><MapPin size={10} />Location</div>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room 12" className="input text-sm" />
              </div>
              <div>
                <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1.5 flex items-center gap-1"><Bell size={10} />Reminder</div>
                <select
                  value={reminderOffsetMin === undefined ? '' : String(reminderOffsetMin)}
                  onChange={(e) => handleReminderChange(e.target.value)}
                  className="input text-sm"
                >
                  {REMINDER_OPTIONS.map((opt) => (
                    <option key={String(opt.value)} value={opt.value === undefined ? '' : String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {notifDenied && reminderOffsetMin !== undefined && (
                  <p className="text-[9px] font-mono text-accent-red mt-1 leading-tight">
                    Notifications are blocked. Enable them in your browser site settings.
                  </p>
                )}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1.5 flex items-center gap-1"><StickyNote size={10} />Notes</div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Lesson plan, agenda, reminders..." className="input text-sm min-h-[60px] resize-none" rows={3} />
            </div>

            {/* Attached materials */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider flex items-center gap-1">
                  <Paperclip size={10} />Materials ({artifactIds.length})
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddArtifact((v) => !v)}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-0.5 rounded-btn border text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-colors',
                    showAddArtifact ? 'border-accent-cyan/60 text-accent-cyan bg-accent-cyan/10' : 'border-border text-text-dim hover:text-text-primary',
                  )}
                >
                  <Plus size={9} />Attach
                </button>
              </div>

              {attachedArtifacts.length > 0 && (
                <div className="space-y-1 mb-2">
                  {attachedArtifacts.map((a) => {
                    const Icon = artifactIcon(a.type);
                    return (
                      <div key={a.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-btn border border-border bg-bg-elevated">
                        <Icon size={12} className="text-text-dim shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-rajdhani font-semibold text-text-primary truncate">{a.title}</div>
                          <div className="text-[9px] font-mono text-text-dim capitalize">{a.type}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewArtifactId(a.id)}
                          className="p-1 rounded text-text-dim hover:text-accent-cyan transition-colors"
                          title="Preview"
                        >
                          <Eye size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => detachArtifact(a.id)}
                          className="p-1 rounded text-text-dim hover:text-accent-red transition-colors"
                          title="Detach"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {showAddArtifact && (
                <div className="rounded-btn border border-border bg-bg-elevated overflow-hidden max-h-40 overflow-y-auto">
                  {unattached.length === 0 && (
                    <div className="px-3 py-4 text-center text-[10px] font-mono text-text-dim">No library items to attach.</div>
                  )}
                  {unattached.slice(0, 30).map((a) => {
                    const Icon = artifactIcon(a.type);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => addArtifact(a.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 border-b border-border/50 last:border-b-0 text-left hover:bg-bg-panel transition-colors"
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
                </div>
              )}
            </div>

            {/* Share section */}
            {shareOpen && initial?.id && (
              <div className="p-3 rounded-btn border border-accent-cyan/30 bg-accent-cyan/5 space-y-3">
                <div className="flex items-center gap-2">
                  <Share2 size={12} className="text-accent-cyan" />
                  <div className="text-[10px] font-mono text-accent-cyan uppercase tracking-wider font-semibold">Share block</div>
                </div>
                <p className="text-[11px] text-text-secondary leading-snug">
                  Generates a public read-only link. Viewers see the block details and every attached material, but cannot edit.
                </p>

                {!shareId && (
                  <button
                    type="button"
                    disabled={sharing}
                    onClick={generateShare}
                    className="w-full px-3 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                  >
                    <LinkIcon size={12} />{sharing ? 'Publishing…' : 'Generate share link'}
                  </button>
                )}

                {shareId && (
                  <>
                    <div>
                      <div className="text-[9px] font-mono text-text-dim uppercase tracking-wider mb-1 flex items-center gap-1">
                        <LinkIcon size={9} />Hyperlink
                      </div>
                      <div className="flex gap-1.5">
                        <input readOnly value={shareUrl} className="flex-1 input text-[10px] font-mono" onFocus={(e) => e.currentTarget.select()} />
                        <button
                          type="button"
                          onClick={() => copyToClipboard(shareUrl, 'link')}
                          className={clsx(
                            'px-2.5 py-1 rounded-btn border text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-all shrink-0 flex items-center gap-1',
                            copiedKind === 'link' ? 'border-accent-green bg-accent-green/10 text-accent-green' : 'border-border text-text-secondary hover:text-text-primary',
                          )}
                        >
                          {copiedKind === 'link' ? <><Check size={10} />Copied</> : <><Copy size={10} />Copy</>}
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="text-[9px] font-mono text-text-dim uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Code2 size={9} />Iframe embed (paste any HTML)
                      </div>
                      <textarea
                        readOnly
                        rows={3}
                        value={iframeCode}
                        onFocus={(e) => e.currentTarget.select()}
                        className="input text-[10px] font-mono w-full resize-none"
                      />
                      <div className="flex gap-1.5 mt-1">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(iframeCode, 'iframe')}
                          className={clsx(
                            'flex-1 px-2.5 py-1 rounded-btn border text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-1',
                            copiedKind === 'iframe' ? 'border-accent-green bg-accent-green/10 text-accent-green' : 'border-border text-text-secondary hover:text-text-primary',
                          )}
                        >
                          {copiedKind === 'iframe' ? <><Check size={10} />Copied</> : <><Copy size={10} />Copy iframe</>}
                        </button>
                        <a
                          href={shareUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 rounded-btn border border-border text-text-secondary hover:text-text-primary text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1"
                        >
                          <Eye size={10} />Open
                        </a>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={sharing}
                      onClick={stopShare}
                      className="w-full px-2.5 py-1.5 rounded-btn border border-red-500/30 text-red-400 hover:bg-red-500/10 text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center justify-center gap-1"
                    >
                      <Lock size={10} />{sharing ? 'Revoking…' : 'Revoke share'}
                    </button>

                    <p className="text-[9px] font-mono text-text-dim leading-snug">
                      Share reflects the current saved state. Save the block after edits, then click Generate again to refresh the snapshot.
                    </p>
                  </>
                )}

                {shareError && (
                  <div className="text-[10px] font-mono text-red-400">{shareError}</div>
                )}
              </div>
            )}

            {isRecurringInstance && (
              <div className="p-3 rounded-btn border border-accent-amber/30 bg-accent-amber/5 space-y-2">
                <div className="text-[10px] font-mono text-accent-amber uppercase tracking-wider font-semibold">Apply changes to</div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setScope('single')} className={clsx('flex-1 px-2 py-1.5 rounded-btn border text-[11px] font-rajdhani font-semibold uppercase tracking-wider transition-colors', scope === 'single' ? 'border-accent-amber bg-accent-amber/20 text-accent-amber' : 'border-border text-text-secondary')}>This event only</button>
                  <button type="button" onClick={() => setScope('series')} className={clsx('flex-1 px-2 py-1.5 rounded-btn border text-[11px] font-rajdhani font-semibold uppercase tracking-wider transition-colors', scope === 'series' ? 'border-accent-amber bg-accent-amber/20 text-accent-amber' : 'border-border text-text-secondary')}>All in series</button>
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 px-4 py-3 border-t border-border bg-bg-elevated flex items-center gap-2">
            {onDelete && initial?.id && (
              <button
                type="button"
                onClick={() => onDelete(scope)}
                className="px-3 py-2 rounded-btn border border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <Trash2 size={12} />Delete
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={onCancel} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-btn bg-accent-amber text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all">Save</button>
          </div>
        </form>
      </div>

      {previewArtifactId && (
        <ArtifactPreviewModal artifactId={previewArtifactId} onClose={() => setPreviewArtifactId(null)} />
      )}
    </>
  );
}
