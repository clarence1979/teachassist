import { useRef, useState, useEffect, type CSSProperties } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { clsx } from 'clsx';
import { Paperclip, MapPin, Repeat, Sparkles, Check, X } from 'lucide-react';
import type { TimetableBlock, SchoolCalendarEntry } from '../../db/schema';
import type { BlockOccurrence } from '../../lib/timetable/recurrence';
import { type ConflictMap, occKey } from '../../lib/timetable/conflicts';
import { parseLocal, fmtTime, isoDate, isToday, fmtDayShort } from '../../lib/timetable/dates';
import { isHoliday } from '../../lib/timetable/schoolCalendar';
import { typeColor } from './blockTypes';
import type { GhostBlock } from '../../lib/timetable/aiPopulate';

const MINUTES_PER_DAY = 24 * 60;
// Base px-per-minute at zoom level 1.0 (~1728px for full 24h at 1.2)
const BASE_PX_PER_MIN = 1.2;
const SLOT_MIN = 15;

// Exported for parent use (drag math uses the base constant; actual px uses zoom)
const PX_PER_MIN = BASE_PX_PER_MIN;

function minutesFromMidnight(iso: string): number {
  const d = parseLocal(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function occColor(o: BlockOccurrence): string {
  return typeColor(o.block.type, o.block.color);
}

interface DayWeekGridProps {
  days: Date[];
  occurrences: BlockOccurrence[];
  conflicts: ConflictMap;
  calendar: SchoolCalendarEntry[];
  ghosts?: GhostBlock[];
  zoomLevel?: number; // 0.5 – 3.0, default 1.0
  onCreate: (dateISO: string, startMinutes: number, endMinutes: number) => void;
  onEditBlock: (occ: BlockOccurrence) => void;
  onViewMaterials?: (occ: BlockOccurrence) => void;
  onContextMenu: (occ: BlockOccurrence, x: number, y: number) => void;
  onAttachArtifact: (block: TimetableBlock, artifactId: string) => void;
  onResize: (occ: BlockOccurrence, next: string | { startISO?: string; endISO?: string }) => void;
  onMove: (occ: BlockOccurrence, newDateISO: string, newStartMinutes: number) => void;
  onAcceptGhost?: (id: string) => void;
  onRejectGhost?: (id: string) => void;
  /** If set, scrolls to this hour on mount (deprecated — auto-scrolls to current time instead) */
  scrollToHour?: number;
}

export function DayWeekGrid(props: DayWeekGridProps) {
  const {
    days, occurrences, conflicts, calendar, ghosts = [],
    zoomLevel = 1.0,
    onCreate, onEditBlock, onViewMaterials, onContextMenu, onAttachArtifact, onResize, onMove,
    onAcceptGhost, onRejectGhost,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const pxPerMin = BASE_PX_PER_MIN * zoomLevel;
  const fullHeight = MINUTES_PER_DAY * pxPerMin;

  // Auto-scroll to current time (or 07:00 on other days) on mount and zoom change
  useEffect(() => {
    if (!containerRef.current) return;
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    // Show current time centred with ~2 hours of context above
    const targetMin = Math.max(0, currentMin - 60);
    containerRef.current.scrollTop = targetMin * pxPerMin;
  // Only run on mount and when zoom changes (intentionally omit pxPerMin from stable closure —
  // using it directly ensures correct scroll position after zoom)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomLevel]);

  const currentMin = (() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  })();

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-auto">
      <div className="flex" style={{ minHeight: fullHeight + 40 }}>
        {/* Hour rail */}
        <div className="shrink-0 w-14 border-r border-border sticky left-0 bg-bg-base z-20">
          <div className="h-10 border-b border-border bg-bg-elevated" />
          <div className="relative" style={{ height: fullHeight }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute left-0 right-0 flex items-start justify-end pr-2"
                style={{ top: h * 60 * pxPerMin, height: 60 * pxPerMin }}
              >
                <span className="text-[0.625em] font-mono text-text-dim -mt-1.5">
                  {String(h).padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Day columns */}
        <div className="flex-1 flex">
          {days.map((day) => (
            <DayColumn
              key={isoDate(day)}
              day={day}
              occurrences={occurrences.filter((o) => isoDate(parseLocal(o.startISO)) === isoDate(day))}
              ghosts={ghosts.filter((g) => g.startISO.startsWith(isoDate(day)) && g.status !== 'rejected')}
              conflicts={conflicts}
              calendar={calendar}
              pxPerMin={pxPerMin}
              fullHeight={fullHeight}
              onCreate={onCreate}
              onEditBlock={onEditBlock}
              onViewMaterials={onViewMaterials}
              onContextMenu={onContextMenu}
              onAttachArtifact={onAttachArtifact}
              onResize={onResize}
              onMove={onMove}
              onAcceptGhost={onAcceptGhost}
              onRejectGhost={onRejectGhost}
              currentMin={isToday(day) ? currentMin : null}
              isSingle={days.length === 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface DayColumnProps {
  day: Date;
  occurrences: BlockOccurrence[];
  ghosts: GhostBlock[];
  conflicts: ConflictMap;
  calendar: SchoolCalendarEntry[];
  pxPerMin: number;
  fullHeight: number;
  onCreate: (dateISO: string, startMinutes: number, endMinutes: number) => void;
  onEditBlock: (occ: BlockOccurrence) => void;
  onViewMaterials?: (occ: BlockOccurrence) => void;
  onContextMenu: (occ: BlockOccurrence, x: number, y: number) => void;
  onAttachArtifact: (block: TimetableBlock, artifactId: string) => void;
  onResize: (occ: BlockOccurrence, next: string | { startISO?: string; endISO?: string }) => void;
  onMove: (occ: BlockOccurrence, newDateISO: string, newStartMinutes: number) => void;
  onAcceptGhost?: (id: string) => void;
  onRejectGhost?: (id: string) => void;
  currentMin: number | null;
  isSingle: boolean;
}

function DayColumn({
  day, occurrences, ghosts, conflicts, calendar, pxPerMin, fullHeight,
  onCreate, onEditBlock, onViewMaterials, onContextMenu, onAttachArtifact, onResize, onMove,
  onAcceptGhost, onRejectGhost, currentMin, isSingle,
}: DayColumnProps) {
  const dateISO = isoDate(day);
  const holiday = isHoliday(dateISO, calendar);
  const colRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState<{ startMin: number; endMin: number } | null>(null);
  const [artifactOverId, setArtifactOverId] = useState<string | null>(null);

  const { setNodeRef, isOver } = useDroppable({ id: `day_${dateISO}`, data: { dateISO } });

  // Click-and-drag to create
  const startCreate = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-block]')) return;
    const rect = colRef.current!.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const start = Math.floor(y / pxPerMin / SLOT_MIN) * SLOT_MIN;
    setCreating({ startMin: start, endMin: start + 30 });

    const move = (ev: MouseEvent) => {
      const yy = ev.clientY - rect.top;
      const m = Math.floor(yy / pxPerMin / SLOT_MIN) * SLOT_MIN;
      setCreating((c) => (c ? { ...c, endMin: Math.max(c.startMin + SLOT_MIN, m + SLOT_MIN) } : null));
    };
    const up = () => {
      setCreating((c) => {
        if (c && c.endMin > c.startMin) onCreate(dateISO, c.startMin, c.endMin);
        return null;
      });
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col border-r border-border last:border-r-0">
      {/* Header */}
      <div className={clsx(
        'shrink-0 h-10 flex items-center justify-center gap-2 border-b border-border text-xs font-rajdhani font-bold uppercase tracking-wider sticky top-0 z-10',
        isToday(day) ? 'bg-accent-amber/10 text-accent-amber' : 'bg-bg-elevated text-text-secondary',
      )}>
        {isSingle ? (
          <span>{day.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        ) : (
          <>
            <span>{fmtDayShort(day)}</span>
            <span className={clsx('w-5 h-5 rounded-full flex items-center justify-center text-[10px]', isToday(day) && 'bg-accent-amber text-bg-base')}>{day.getDate()}</span>
            {holiday && <span className="text-[0.5625em] font-mono text-red-400 normal-case" title={holiday.label}>holiday</span>}
          </>
        )}
      </div>

      {/* Body */}
      <div
        ref={(el) => { (colRef as React.MutableRefObject<HTMLDivElement | null>).current = el; setNodeRef(el); }}
        className={clsx(
          'relative flex-1',
          holiday && 'bg-red-500/5',
          isOver && 'bg-accent-cyan/5',
        )}
        style={{ height: fullHeight }}
        onMouseDown={startCreate}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); }}
      >
        {/* Hour lines */}
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute left-0 right-0 border-t border-border/30 pointer-events-none" style={{ top: h * 60 * pxPerMin }} />
        ))}
        {/* Half-hour subtle lines */}
        {Array.from({ length: 24 }, (_, h) => (
          <div key={`h${h}`} className="absolute left-0 right-0 border-t border-border/10 pointer-events-none" style={{ top: (h * 60 + 30) * pxPerMin }} />
        ))}

        {/* Current time indicator */}
        {currentMin != null && (
          <div className="absolute left-0 right-0 pointer-events-none z-10" style={{ top: currentMin * pxPerMin }}>
            <div className="h-[2px] bg-accent-red shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
            <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-accent-red" />
          </div>
        )}

        {/* Ghost create preview */}
        {creating && (
          <div
            className="absolute left-1 right-1 rounded-btn bg-accent-amber/20 border border-accent-amber/60 pointer-events-none"
            style={{ top: creating.startMin * pxPerMin, height: (creating.endMin - creating.startMin) * pxPerMin }}
          >
            <div className="px-2 py-1 text-[0.625em] font-mono text-accent-amber">
              {String(Math.floor(creating.startMin / 60)).padStart(2, '0')}:{String(creating.startMin % 60).padStart(2, '0')} –
              {' '}{String(Math.floor(creating.endMin / 60)).padStart(2, '0')}:{String(creating.endMin % 60).padStart(2, '0')}
            </div>
          </div>
        )}

        {/* Blocks */}
        {occurrences.map((occ) => (
          <BlockCard
            key={occKey(occ)}
            occ={occ}
            conflicts={conflicts}
            pxPerMin={pxPerMin}
            onEdit={() => onEditBlock(occ)}
            onViewMaterials={onViewMaterials ? () => onViewMaterials(occ) : undefined}
            onContextMenu={(x, y) => onContextMenu(occ, x, y)}
            onAttachArtifact={(aid) => onAttachArtifact(occ.block, aid)}
            onResizeEnd={(endMin) => {
              const newEnd = `${dateISO}T${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}:00`;
              onResize(occ, { endISO: newEnd });
            }}
            onResizeStart={(startMin) => {
              const newStart = `${dateISO}T${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}:00`;
              onResize(occ, { startISO: newStart });
            }}
            onMoveLocal={(startMin) => {
              onMove(occ, dateISO, startMin);
            }}
            isArtifactOver={artifactOverId === occKey(occ)}
            setArtifactOverId={setArtifactOverId}
          />
        ))}

        {/* Ghost blocks (AI proposals) */}
        {ghosts.map((ghost) => {
          const startMin = minutesFromMidnight(ghost.startISO);
          const endMin = minutesFromMidnight(ghost.endISO);
          const dur = Math.max(SLOT_MIN, endMin - startMin);
          const color = typeColor(ghost.type, ghost.color);
          const isAccepted = ghost.status === 'accepted';
          return (
            <div
              key={ghost.id}
              className={clsx(
                'absolute left-1 right-1 rounded-btn z-[6] pointer-events-auto overflow-hidden group/ghost',
                isAccepted && 'opacity-40',
              )}
              style={{
                top: startMin * pxPerMin,
                height: dur * pxPerMin,
                background: `${color}0a`,
                border: `1.5px dashed ${color}80`,
                opacity: isAccepted ? 0.4 : 0.75,
              }}
              title={ghost.rationale}
            >
              <div className="px-1.5 py-1 flex items-start gap-1 h-full">
                <Sparkles size={8} className="mt-0.5 shrink-0" style={{ color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[0.625em] font-rajdhani font-bold truncate leading-tight" style={{ color: `${color}cc` }}>{ghost.title}</div>
                  <div className="text-[0.5em] font-mono" style={{ color: `${color}80` }}>{fmtTime(ghost.startISO)}–{fmtTime(ghost.endISO)}</div>
                </div>
                {ghost.status === 'pending' && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover/ghost:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); onAcceptGhost?.(ghost.id); }}
                      className="p-0.5 rounded text-accent-green hover:bg-accent-green/20 transition-colors"
                      title="Accept"
                    ><Check size={9} /></button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onRejectGhost?.(ghost.id); }}
                      className="p-0.5 rounded text-red-400 hover:bg-red-500/20 transition-colors"
                      title="Reject"
                    ><X size={9} /></button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface BlockCardProps {
  occ: BlockOccurrence;
  conflicts: ConflictMap;
  pxPerMin: number;
  onEdit: () => void;
  onViewMaterials?: () => void;
  onContextMenu: (x: number, y: number) => void;
  onAttachArtifact: (artifactId: string) => void;
  onResizeEnd: (endMin: number) => void;
  onResizeStart: (startMin: number) => void;
  onMoveLocal: (startMin: number) => void;
  isArtifactOver: boolean;
  setArtifactOverId: (id: string | null) => void;
}

function BlockCard({
  occ, conflicts, pxPerMin,
  onEdit, onViewMaterials, onContextMenu, onAttachArtifact, onResizeEnd, onResizeStart, onMoveLocal,
  isArtifactOver, setArtifactOverId,
}: BlockCardProps) {
  const startMin = minutesFromMidnight(occ.startISO);
  const endMin = minutesFromMidnight(occ.endISO);
  const dur = Math.max(SLOT_MIN, endMin - startMin);
  const color = occColor(occ);
  const key = occKey(occ);
  const hasConflict = conflicts.has(key);

  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `block_${key}`,
    data: { kind: 'block', occ },
  });

  const translateY = transform?.y ?? 0;
  const translateX = transform?.x ?? 0;

  useEffect(() => {
    if (transform && !isDragging) {
      // reset visual no-op
    }
  }, [transform, isDragging]);

  // Resize via bottom edge (independent of dnd-kit)
  const resizeBottom = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const origEnd = endMin;
    const origY = e.clientY;
    const move = (ev: MouseEvent) => {
      const deltaMin = Math.round(((ev.clientY - origY) / pxPerMin) / SLOT_MIN) * SLOT_MIN;
      const newEnd = Math.max(startMin + SLOT_MIN, Math.min(24 * 60, origEnd + deltaMin));
      onResizeEnd(newEnd);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  // Resize via top edge — moves the start time while keeping end fixed
  const resizeTop = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const origStart = startMin;
    const origY = e.clientY;
    const move = (ev: MouseEvent) => {
      const deltaMin = Math.round(((ev.clientY - origY) / pxPerMin) / SLOT_MIN) * SLOT_MIN;
      const newStart = Math.max(0, Math.min(endMin - SLOT_MIN, origStart + deltaMin));
      onResizeStart(newStart);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  // Keyboard move
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? -SLOT_MIN : SLOT_MIN;
      onMoveLocal(Math.max(0, Math.min(24 * 60 - dur, startMin + delta)));
    }
  };

  const style: CSSProperties = {
    top: startMin * pxPerMin,
    height: dur * pxPerMin,
    background: `linear-gradient(135deg, ${color}22, ${color}11)`,
    borderColor: `${color}80`,
    boxShadow: hasConflict ? '0 0 0 1px #ef4444, 0 0 10px rgba(239,68,68,0.4)' : undefined,
    transform: isDragging ? `translate3d(${translateX}px, ${translateY}px, 0)` : undefined,
    zIndex: isDragging ? 30 : 5,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      data-block
      className={clsx(
        'absolute left-1 right-1 rounded-btn border overflow-hidden group/block cursor-grab active:cursor-grabbing transition-shadow',
        hasConflict && 'ring-1 ring-red-500/60',
        isArtifactOver && 'ring-2 ring-accent-cyan',
      )}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        if (isDragging) return;
        onEdit();
      }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e.clientX, e.clientY); }}
      onKeyDown={onKeyDown}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setArtifactOverId(key); }}
      onDragLeave={() => setArtifactOverId(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setArtifactOverId(null);
        const aid = e.dataTransfer.getData('artifactId');
        if (aid) onAttachArtifact(aid);
      }}
      {...attributes}
      {...listeners}
      tabIndex={0}
    >
      <div className="px-1.5 py-1 h-full flex flex-col relative">
        <div className="flex items-start gap-1">
          <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1" style={{ background: color }} />
          <div className="flex-1 min-w-0">
            <div className="text-[0.6875em] font-rajdhani font-bold leading-tight truncate" style={{ color }}>
              {occ.block.title}
            </div>
            <div className="text-[0.5625em] font-mono text-text-dim leading-tight">
              {fmtTime(occ.startISO)}–{fmtTime(occ.endISO)}
            </div>
          </div>
        </div>
        {dur >= 45 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.5625em] font-mono text-text-dim">
            {occ.block.location && <span className="flex items-center gap-0.5"><MapPin size={8} />{occ.block.location}</span>}
            {occ.isRecurrence && <span className="flex items-center gap-0.5"><Repeat size={8} />recurring</span>}
            {(occ.block.artifactIds?.length ?? 0) > 0 && (
              <button
                className="flex items-center gap-0.5 hover:text-accent-amber transition-colors"
                onClick={(e) => { e.stopPropagation(); onViewMaterials?.(); }}
                title="View attached materials"
              >
                <Paperclip size={8} />{occ.block.artifactIds!.length}
              </button>
            )}
            {hasConflict && <span className="text-red-400 font-semibold">CONFLICT</span>}
          </div>
        )}
        {dur >= 90 && occ.block.notes && (
          <div className="mt-1 text-[0.5625em] text-text-dim line-clamp-3 font-sans">{occ.block.notes}</div>
        )}
      </div>

      {/* Resize handles — top shifts start time, bottom shifts end time */}
      <div
        className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize opacity-0 group-hover/block:opacity-100 bg-gradient-to-b from-white/20 to-transparent"
        onMouseDown={resizeTop}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize opacity-0 group-hover/block:opacity-100 bg-gradient-to-t from-white/20 to-transparent"
        onMouseDown={resizeBottom}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export { PX_PER_MIN, SLOT_MIN };
