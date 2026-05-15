import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Calendar, ChevronLeft, ChevronRight, Plus, Download, FileText,
  FileSpreadsheet, CalendarDays, Sparkles, Edit3, Copy,
  Trash2, CheckCircle2, XCircle, Repeat, Paperclip, Upload,
  ZoomIn, ZoomOut, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useMobile } from '../lib/useMobile';
import { clsx } from 'clsx';
import {
  DndContext, PointerSensor, KeyboardSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { useAdminDb } from '../db/DbContext';
import { pullFromSupabase } from '../db/sync';
import { useCredentials } from '../contexts/CredentialsContext';
import { uid } from '../db/repos';
import type { TimetableBlock, SchoolCalendarEntry } from '../db/schema';
import {
  startOfWeek, addDays, isoDate, isoDateTime, parseLocal,
  startOfMonth, endOfMonth, startOfYear, fmtDayLabel, fmtMonthLabel, weekNumber,
} from '../lib/timetable/dates';
import { expandOccurrences, type BlockOccurrence } from '../lib/timetable/recurrence';
import { detectConflicts } from '../lib/timetable/conflicts';
import { defaultCalendarFor, termFor } from '../lib/timetable/schoolCalendar';
import { rescheduleReminders, ensureNotificationPermission } from '../lib/timetable/reminders';
import { buildICS, buildCSV, buildPDF, downloadBlob } from '../lib/timetable/export';
import {
  populateWeekWithAI, deriveLearnedPreference, buildRecentPattern,
  DEFAULT_PREFS,
  type GhostBlock,
  type TeacherPreferences,
} from '../lib/timetable/aiPopulate';
import { BlockEditor } from '../components/timetable/BlockEditor';
import { ContextMenu, type ContextMenuItem } from '../components/timetable/ContextMenu';
import { DayWeekGrid, PX_PER_MIN, SLOT_MIN } from '../components/timetable/DayWeekGrid';
import { MonthView } from '../components/timetable/MonthView';
import { YearView } from '../components/timetable/YearView';
import { AIWeekPanel } from '../components/timetable/AIWeekPanel';
import { TimetableImportModal } from '../components/timetable/ImportModal';
import { SlotMaterialsModal } from '../components/timetable/SlotMaterialsModal';

type ViewMode = 'day' | 'week' | 'month' | 'term' | 'year';

export function TimetableView() {
  const { db, viewedAsUser } = useAdminDb();
  const { getKey } = useCredentials();
  const blocks = useLiveQuery(() => db.timetableBlocks.toArray(), [db]) ?? [];

  // Guaranteed pull-on-mount: fetch all timetable blocks for the currently
  // viewed user from Supabase and populate their IndexedDB namespace. Uses
  // viewedAsUser (not the logged-in username) so admin-switched views pull
  // the correct user's data.
  useEffect(() => {
    if (!viewedAsUser || viewedAsUser === 'default') return;
    pullFromSupabase(db, viewedAsUser).catch((e) => {
      console.warn('[timetable] pull on mount failed:', e);
    });
  }, [db, viewedAsUser]);
  const tasksRaw = useLiveQuery(() => db.tasks.where('status').anyOf(['inbox', 'scheduled']).toArray(), [db]) ?? [];
  const calRaw = useLiveQuery(() => db.schoolCalendar.toArray(), [db]);
  const prefsRaw = useLiveQuery(() => db.preferences.get('aiWeekPrefs'), [db]);

  const isMobile = useMobile();
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [hideWeekends, setHideWeekends] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [focusDate, setFocusDate] = useState(() => new Date());
  // Default to higher zoom on mobile so slots are readable
  const [zoomLevel, setZoomLevel] = useState(() => (window.innerWidth < 768 ? 1.5 : 1.0));

  const ZOOM_STEPS = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0];
  const zoomIn = () => setZoomLevel((z) => {
    const next = ZOOM_STEPS.find((s) => s > z);
    return next ?? z;
  });
  const zoomOut = () => setZoomLevel((z) => {
    const prev = [...ZOOM_STEPS].reverse().find((s) => s < z);
    return prev ?? z;
  });
  const [editing, setEditing] = useState<{ initial?: Partial<TimetableBlock>; defaultDate?: string; isInstance?: boolean } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; occ: BlockOccurrence } | null>(null);
  const [slotMaterials, setSlotMaterials] = useState<{ block: TimetableBlock; startISO: string; endISO: string } | null>(null);
  const [scopeConfirm, setScopeConfirm] = useState<{ occ: BlockOccurrence; action: (scope: 'single' | 'series') => void; verb: string } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // ── AI population state ──
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [ghosts, setGhosts] = useState<GhostBlock[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const aiPrefs: TeacherPreferences = useMemo(
    () => (prefsRaw?.value as TeacherPreferences | undefined) ?? DEFAULT_PREFS,
    [prefsRaw],
  );

  const savePrefs = useCallback(async (p: TeacherPreferences) => {
    await db.preferences.put({ key: 'aiWeekPrefs', value: p });
  }, [db]);

  // Seed calendar with Victorian defaults (once)
  useEffect(() => {
    if (calRaw && calRaw.length === 0) {
      const y = new Date().getFullYear();
      db.schoolCalendar.bulkAdd(defaultCalendarFor(y));
    }
  }, [calRaw, db]);

  // Reminder notifications — request permission once if any block wants reminders,
  // then re-schedule whenever blocks change.
  useEffect(() => {
    const anyReminder = blocks.some((b) => typeof b.reminderOffsetMin === 'number');
    if (anyReminder) {
      ensureNotificationPermission().then(() => {
        rescheduleReminders(blocks);
      });
    } else {
      rescheduleReminders(blocks);
    }
  }, [blocks]);

  const calendar: SchoolCalendarEntry[] = calRaw ?? [];

  // Compute visible window
  const { windowStart, windowEnd, days } = useMemo(() => {
    if (viewMode === 'day') {
      const s = new Date(focusDate); s.setHours(0, 0, 0, 0);
      const e = new Date(focusDate); e.setHours(23, 59, 59, 999);
      return { windowStart: s, windowEnd: e, days: [focusDate] };
    }
    if (viewMode === 'week') {
      const s = startOfWeek(focusDate);
      const e = addDays(s, 7); e.setMilliseconds(-1);
      const allDays = Array.from({ length: 7 }, (_, i) => addDays(s, i));
      const visibleDays = hideWeekends
        ? allDays.filter((d) => d.getDay() !== 0 && d.getDay() !== 6)
        : allDays;
      return { windowStart: s, windowEnd: e, days: visibleDays };
    }
    if (viewMode === 'month') {
      return { windowStart: startOfMonth(focusDate), windowEnd: endOfMonth(focusDate), days: [] };
    }
    if (viewMode === 'term') {
      const term = termFor(isoDate(focusDate), calendar);
      if (term) {
        return { windowStart: parseLocal(`${term.startISO}T00:00:00`), windowEnd: parseLocal(`${term.endISO}T23:59:59`), days: [] };
      }
      return { windowStart: startOfMonth(focusDate), windowEnd: endOfMonth(focusDate), days: [] };
    }
    // year
    const s = startOfYear(focusDate);
    const e = new Date(s.getFullYear() + 1, 0, 0, 23, 59, 59);
    return { windowStart: s, windowEnd: e, days: [] };
  }, [viewMode, focusDate, calendar]);

  const occurrences = useMemo(
    () => expandOccurrences(blocks, windowStart, windowEnd),
    [blocks, windowStart, windowEnd],
  );
  const conflicts = useMemo(() => detectConflicts(occurrences), [occurrences]);

  // Nav
  const navigate = (dir: -1 | 1) => {
    setFocusDate((d) => {
      if (viewMode === 'day') return addDays(d, dir);
      if (viewMode === 'week') return addDays(d, dir * 7);
      if (viewMode === 'month') return new Date(d.getFullYear(), d.getMonth() + dir, 1);
      if (viewMode === 'term') return new Date(d.getFullYear(), d.getMonth() + dir * 3, 1);
      return new Date(d.getFullYear() + dir, d.getMonth(), d.getDate());
    });
  };

  const label = useMemo(() => {
    if (viewMode === 'day') return fmtDayLabel(focusDate);
    if (viewMode === 'week') {
      const s = startOfWeek(focusDate);
      return `Week ${weekNumber(s)} · ${fmtDayLabel(s)} – ${fmtDayLabel(addDays(s, 6))}`;
    }
    if (viewMode === 'month') return fmtMonthLabel(focusDate);
    if (viewMode === 'term') {
      const t = termFor(isoDate(focusDate), calendar);
      return t ? t.label : fmtMonthLabel(focusDate);
    }
    return String(focusDate.getFullYear());
  }, [viewMode, focusDate, calendar]);

  // ─── CRUD ───
  const createBlock = async (patch: Partial<TimetableBlock>) => {
    const block: TimetableBlock = {
      id: uid('blk'),
      title: patch.title ?? 'Untitled',
      type: patch.type ?? 'class',
      color: patch.color,
      subtype: patch.subtype,
      notes: patch.notes,
      location: patch.location,
      startISO: patch.startISO!,
      endISO: patch.endISO!,
      recurrence: patch.recurrence,
      seriesId: patch.recurrence ? uid('ser') : undefined,
      exdates: [],
      artifactIds: [],
      source: 'manual',
      status: 'scheduled',
      createdAt: Date.now(),
    };
    await db.timetableBlocks.add(block);
  };

  const saveEditor = async (patch: Partial<TimetableBlock>, scope: 'single' | 'series') => {
    if (!editing?.initial?.id) {
      await createBlock(patch);
    } else {
      const existing = await db.timetableBlocks.get(editing.initial.id);
      if (!existing) return;
      if (existing.recurrence && scope === 'single' && editing.isInstance) {
        // Create override sibling, add exdate to series
        const instanceDate = isoDate(parseLocal(editing.initial.startISO!));
        const override: TimetableBlock = {
          ...existing,
          ...patch,
          id: uid('blk'),
          recurrence: undefined,
          seriesId: existing.seriesId ?? existing.id,
          overrideOfSeries: existing.seriesId ?? existing.id,
          overrideInstanceDate: instanceDate,
          createdAt: Date.now(),
        };
        await db.timetableBlocks.add(override);
        await db.timetableBlocks.update(existing.id, {
          exdates: [...(existing.exdates ?? []), instanceDate],
        });
      } else {
        await db.timetableBlocks.update(existing.id, patch);
      }
    }
    setEditing(null);
  };

  const deleteFromEditor = async (scope: 'single' | 'series') => {
    if (!editing?.initial?.id) return;
    const existing = await db.timetableBlocks.get(editing.initial.id);
    if (!existing) return;
    if (existing.recurrence && scope === 'single' && editing.isInstance) {
      const instanceDate = isoDate(parseLocal(editing.initial.startISO!));
      await db.timetableBlocks.update(existing.id, {
        exdates: [...(existing.exdates ?? []), instanceDate],
      });
    } else {
      if (existing.seriesId) {
        // Delete all in series
        await db.timetableBlocks.where('seriesId').equals(existing.seriesId).delete();
      } else {
        await db.timetableBlocks.delete(existing.id);
      }
    }
    setEditing(null);
  };

  const editOccurrence = (occ: BlockOccurrence) => {
    setEditing({
      initial: { ...occ.block, startISO: occ.startISO, endISO: occ.endISO },
      isInstance: occ.isRecurrence,
    });
  };

  const attachArtifact = async (block: TimetableBlock, artifactId: string) => {
    const ids = new Set(block.artifactIds ?? []);
    ids.add(artifactId);
    await db.timetableBlocks.update(block.id, { artifactIds: [...ids] });
  };

  const resizeOccurrence = async (
    occ: BlockOccurrence,
    next: string | { startISO?: string; endISO?: string },
  ) => {
    const newStartISO = typeof next === 'string' ? occ.startISO : (next.startISO ?? occ.startISO);
    const newEndISO = typeof next === 'string' ? next : (next.endISO ?? occ.endISO);
    if (occ.block.recurrence && occ.isRecurrence) {
      const instanceDate = occ.occurrenceDate;
      const override: TimetableBlock = {
        ...occ.block,
        id: uid('blk'),
        startISO: newStartISO,
        endISO: newEndISO,
        recurrence: undefined,
        seriesId: occ.block.seriesId ?? occ.block.id,
        overrideOfSeries: occ.block.seriesId ?? occ.block.id,
        overrideInstanceDate: instanceDate,
        createdAt: Date.now(),
      };
      await db.timetableBlocks.add(override);
      await db.timetableBlocks.update(occ.block.id, {
        exdates: [...(occ.block.exdates ?? []), instanceDate],
      });
    } else {
      const patch: Record<string, string> = {};
      if (newStartISO !== occ.block.startISO) patch.startISO = newStartISO;
      if (newEndISO !== occ.block.endISO) patch.endISO = newEndISO;
      if (Object.keys(patch).length) await db.timetableBlocks.update(occ.block.id, patch);
    }
  };

  const moveOccurrence = async (occ: BlockOccurrence, newDateISO: string, newStartMinutes: number) => {
    const durMin = (parseLocal(occ.endISO).getTime() - parseLocal(occ.startISO).getTime()) / 60000;
    const newStart = `${newDateISO}T${String(Math.floor(newStartMinutes / 60)).padStart(2, '0')}:${String(newStartMinutes % 60).padStart(2, '0')}:00`;
    const newEnd = isoDateTime(new Date(parseLocal(newStart).getTime() + durMin * 60000));

    if (occ.block.recurrence && occ.isRecurrence) {
      const instanceDate = occ.occurrenceDate;
      const override: TimetableBlock = {
        ...occ.block,
        id: uid('blk'),
        startISO: newStart,
        endISO: newEnd,
        recurrence: undefined,
        seriesId: occ.block.seriesId ?? occ.block.id,
        overrideOfSeries: occ.block.seriesId ?? occ.block.id,
        overrideInstanceDate: instanceDate,
        createdAt: Date.now(),
      };
      await db.timetableBlocks.add(override);
      await db.timetableBlocks.update(occ.block.id, {
        exdates: [...(occ.block.exdates ?? []), instanceDate],
      });
    } else {
      await db.timetableBlocks.update(occ.block.id, { startISO: newStart, endISO: newEnd });
    }
  };

  // ─── AI populate ───
  const weekStartForAI = useMemo(() => startOfWeek(focusDate), [focusDate]);

  const generateWeek = useCallback(async () => {
    const anthropicKey = getKey('anthropic') ?? undefined;
    const openaiKey = getKey('openai') ?? undefined;
    if (!anthropicKey && !openaiKey) {
      setAiError('No AI API key configured. Add an Anthropic or OpenAI key in Settings.');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const weekEnd = addDays(weekStartForAI, 7);
      const fixed = expandOccurrences(blocks, weekStartForAI, weekEnd);
      const recentPattern = buildRecentPattern(weekStartForAI, blocks);
      const proposals = await populateWeekWithAI({
        anthropicKey,
        openaiKey,
        weekStart: weekStartForAI,
        fixedOccurrences: fixed,
        pendingTasks: tasksRaw,
        calendar,
        prefs: aiPrefs,
        recentPatterns: recentPattern,
      });
      setGhosts(proposals.map((p) => ({ ...p, id: uid('ghost'), status: 'pending' })));
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  }, [getKey, blocks, tasksRaw, calendar, aiPrefs, weekStartForAI]);

  const acceptGhost = useCallback(async (id: string) => {
    const ghost = ghosts.find((g) => g.id === id);
    if (!ghost) return;
    const block: TimetableBlock = {
      id: uid('blk'),
      title: ghost.title,
      type: ghost.type,
      color: ghost.color,
      subtype: ghost.subtype,
      notes: ghost.rationale,
      location: ghost.location,
      startISO: ghost.startISO,
      endISO: ghost.endISO,
      artifactIds: [],
      source: 'ai',
      status: 'scheduled',
      createdAt: Date.now(),
    };
    await db.timetableBlocks.add(block);
    setGhosts((gs) => gs.map((g) => g.id === id ? { ...g, status: 'accepted' } : g));
  }, [ghosts, db]);

  const rejectGhost = useCallback(async (id: string) => {
    const ghost = ghosts.find((g) => g.id === id);
    if (!ghost) return;
    // Learn from rejection
    const pref = deriveLearnedPreference(ghost);
    const updated: TeacherPreferences = {
      ...aiPrefs,
      learnedPreferences: [
        ...aiPrefs.learnedPreferences,
        { description: pref, addedAt: Date.now() },
      ].slice(-20),
    };
    await savePrefs(updated);
    setGhosts((gs) => gs.map((g) => g.id === id ? { ...g, status: 'rejected' } : g));
  }, [ghosts, aiPrefs, savePrefs]);

  const acceptAllGhosts = useCallback(async () => {
    for (const g of ghosts.filter((x) => x.status === 'pending')) {
      await acceptGhost(g.id);
    }
  }, [ghosts, acceptGhost]);

  const rejectAllGhosts = useCallback(async () => {
    for (const g of ghosts.filter((x) => x.status === 'pending')) {
      await rejectGhost(g.id);
    }
  }, [ghosts, rejectGhost]);

  // Context menu items
  const contextItems = (occ: BlockOccurrence): ContextMenuItem[] => [
    { label: 'Edit', icon: Edit3, onClick: () => editOccurrence(occ) },
    { label: 'View Materials', icon: Paperclip, onClick: () => setSlotMaterials({ block: occ.block, startISO: occ.startISO, endISO: occ.endISO }) },
    { label: 'Duplicate', icon: Copy, onClick: async () => {
      const copy: TimetableBlock = { ...occ.block, id: uid('blk'), startISO: occ.startISO, endISO: occ.endISO, recurrence: undefined, seriesId: undefined, exdates: [], overrideOfSeries: undefined, overrideInstanceDate: undefined, createdAt: Date.now() };
      await db.timetableBlocks.add(copy);
    } },
    { label: 'Mark done', icon: CheckCircle2, onClick: () => db.timetableBlocks.update(occ.block.id, { status: 'done' }) },
    { label: 'Cancel', icon: XCircle, onClick: () => db.timetableBlocks.update(occ.block.id, { status: 'cancelled' }) },
    { separator: true, label: '', onClick: () => {} },
    { label: 'Change recurrence', icon: Repeat, onClick: () => editOccurrence(occ) },
    { separator: true, label: '', onClick: () => {} },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => {
      if (occ.block.recurrence) {
        setScopeConfirm({ occ, verb: 'Delete', action: async (scope) => {
          if (scope === 'single') {
            await db.timetableBlocks.update(occ.block.id, { exdates: [...(occ.block.exdates ?? []), occ.occurrenceDate] });
          } else if (occ.block.seriesId) {
            await db.timetableBlocks.where('seriesId').equals(occ.block.seriesId).delete();
          } else {
            await db.timetableBlocks.delete(occ.block.id);
          }
        }});
      } else {
        db.timetableBlocks.delete(occ.block.id);
      }
    } },
  ];

  // Dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as { kind?: string; occ?: BlockOccurrence } | undefined;
    if (!data || data.kind !== 'block' || !data.occ) return;
    const over = e.over;
    const overDate = (over?.data.current as { dateISO?: string } | undefined)?.dateISO;
    const origDate = isoDate(parseLocal(data.occ.startISO));
    const origStartMin = parseLocal(data.occ.startISO).getHours() * 60 + parseLocal(data.occ.startISO).getMinutes();
    const effectivePxPerMin = PX_PER_MIN * zoomLevel;
    const deltaMin = Math.round((e.delta.y / effectivePxPerMin) / SLOT_MIN) * SLOT_MIN;
    const newStartMin = Math.max(0, Math.min(24 * 60 - SLOT_MIN, origStartMin + deltaMin));
    const targetDate = overDate ?? origDate;
    if (targetDate === origDate && deltaMin === 0) return;
    moveOccurrence(data.occ, targetDate, newStartMin);
  };

  // ─── Export ───
  const doExport = async (kind: 'ics' | 'csv' | 'pdf') => {
    // Export one-year horizon from today
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setFullYear(e.getFullYear() + 1);
    const occ = expandOccurrences(blocks, s, e);
    if (kind === 'ics') downloadBlob(buildICS(occ), 'timetable.ics', 'text/calendar');
    else if (kind === 'csv') downloadBlob(buildCSV(occ), 'timetable.csv', 'text/csv');
    else downloadBlob(await buildPDF(occ, 'Timetable — One Year'), 'timetable.pdf', 'application/pdf');
    setExportOpen(false);
  };

  const pendingGhostCount = ghosts.filter((g) => g.status === 'pending').length;

  return (
    <div className="flex-1 min-h-0 flex flex-col grid-bg">
      {/* ── Mobile toolbar ─────────────────────────────────────── */}
      {isMobile ? (
        <div className="shrink-0 bg-bg-elevated border-b border-border">
          {/* Always-visible row: nav + view tabs + collapse toggle */}
          <div className="flex items-center gap-1.5 px-2 py-1.5">
            {/* Navigation */}
            <button onClick={() => navigate(-1)} className="p-1.5 rounded-btn border border-border text-text-dim hover:text-accent-amber active:text-accent-amber transition-colors shrink-0"><ChevronLeft size={14} /></button>
            <button onClick={() => setFocusDate(new Date())} className="px-2 py-1 rounded-btn border border-border text-[10px] font-rajdhani font-semibold text-text-secondary uppercase tracking-wider transition-colors shrink-0">Today</button>
            <button onClick={() => navigate(1)} className="p-1.5 rounded-btn border border-border text-text-dim hover:text-accent-amber active:text-accent-amber transition-colors shrink-0"><ChevronRight size={14} /></button>

            {/* Date label */}
            <span className="flex-1 text-[11px] font-rajdhani font-bold text-text-primary truncate px-1">{label}</span>

            {/* New block — always visible */}
            <button
              onClick={() => setEditing({ defaultDate: isoDate(focusDate) })}
              className="shrink-0 p-1.5 rounded-btn bg-accent-amber text-bg-base hover:brightness-110 transition-all"
              title="New block"
            >
              <Plus size={14} />
            </button>

            {/* AI badge */}
            <button
              onClick={() => { setAiPanelOpen((o) => !o); setViewMode('week'); }}
              className={clsx(
                'shrink-0 p-1.5 rounded-btn border transition-all relative',
                aiPanelOpen ? 'bg-accent-cyan/20 border-accent-cyan/60 text-accent-cyan' : 'border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan',
                pendingGhostCount > 0 && !aiPanelOpen && 'animate-pulse',
              )}
              title="AI Week"
            >
              <Sparkles size={14} />
              {pendingGhostCount > 0 && (
                <span className="absolute -top-1 -right-1 text-[8px] bg-accent-cyan text-bg-base rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold leading-none">
                  {pendingGhostCount}
                </span>
              )}
            </button>

            {/* Collapse toggle */}
            <button
              onClick={() => setToolbarCollapsed((v) => !v)}
              className="shrink-0 p-1.5 rounded-btn border border-border text-text-dim hover:text-text-primary transition-colors"
              title={toolbarCollapsed ? 'Show options' : 'Hide options'}
            >
              {toolbarCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>

          {/* Collapsible section */}
          {!toolbarCollapsed && (
            <div className="px-2 pb-2 space-y-1.5">
              {/* View mode tabs */}
              <div className="flex items-center gap-0 border border-border rounded-btn overflow-hidden w-full">
                {(['day', 'week', 'month', 'term', 'year'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v)}
                    className={clsx(
                      'flex-1 py-1 text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-colors',
                      viewMode === v ? 'bg-accent-amber/10 text-accent-amber' : 'text-text-dim',
                    )}
                  >{v}</button>
                ))}
              </div>

              {/* Second row: zoom + hide weekends + import + export */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Zoom */}
                {(viewMode === 'day' || viewMode === 'week') && (
                  <div className="flex items-center gap-0 border border-border rounded-btn overflow-hidden">
                    <button onClick={zoomOut} disabled={zoomLevel <= ZOOM_STEPS[0]} className="px-2 py-1 text-text-dim disabled:opacity-30 border-r border-border transition-colors"><ZoomOut size={12} /></button>
                    <span className="px-1.5 text-[9px] font-mono text-text-dim min-w-[3ch] text-center">{Math.round(zoomLevel * 100)}%</span>
                    <button onClick={zoomIn} disabled={zoomLevel >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} className="px-2 py-1 text-text-dim disabled:opacity-30 border-l border-border transition-colors"><ZoomIn size={12} /></button>
                  </div>
                )}

                {/* Hide weekends toggle */}
                {(viewMode === 'day' || viewMode === 'week') && (
                  <button
                    onClick={() => setHideWeekends((v) => !v)}
                    className={clsx(
                      'flex items-center gap-1 px-2 py-1 rounded-btn border text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-all',
                      hideWeekends
                        ? 'border-accent-amber/60 bg-accent-amber/10 text-accent-amber'
                        : 'border-border text-text-dim hover:border-text-dim',
                    )}
                  >
                    5-day
                  </button>
                )}

                {/* Import */}
                <button
                  onClick={() => setImportOpen(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-btn border border-border text-text-secondary text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-colors"
                >
                  <Upload size={10} />Import
                </button>

                {/* Export */}
                <div className="relative">
                  <button
                    onClick={() => setExportOpen((o) => !o)}
                    className="flex items-center gap-1 px-2 py-1 rounded-btn border border-border text-text-secondary text-[10px] font-rajdhani font-semibold uppercase tracking-wider transition-colors"
                  >
                    <Download size={10} />Export
                  </button>
                  {exportOpen && (
                    <div className="absolute left-0 top-full mt-1 w-40 bg-bg-panel border border-border rounded-lg shadow-2xl py-1 z-50">
                      <button onClick={() => doExport('ics')} className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-secondary hover:bg-bg-elevated transition-colors"><CalendarDays size={12} />iCal (.ics)</button>
                      <button onClick={() => doExport('pdf')} className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-secondary hover:bg-bg-elevated transition-colors"><FileText size={12} />PDF</button>
                      <button onClick={() => doExport('csv')} className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-secondary hover:bg-bg-elevated transition-colors"><FileSpreadsheet size={12} />CSV</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
      /* ── Desktop toolbar ───────────────────────────────────── */
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="p-2.5 rounded-btn bg-bg-panel border border-border">
            <Calendar size={20} className="text-accent-amber" />
          </div>
          <div>
            <h1 className="font-orbitron text-xl font-bold text-text-primary tracking-wide">TIMETABLE</h1>
            <p className="text-text-dim text-xs font-mono">Drag to move · resize from the edge · right-click for options</p>
          </div>
          <div className="flex-1" />

          <div className="flex items-center gap-0 border border-border rounded-btn overflow-hidden">
            {(['day', 'week', 'month', 'term', 'year'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={clsx(
                  'px-3 py-1.5 text-[11px] font-rajdhani font-semibold uppercase tracking-wider transition-colors',
                  viewMode === v ? 'bg-accent-amber/10 text-accent-amber' : 'text-text-dim hover:text-text-primary',
                )}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)} className="p-1.5 rounded-btn border border-border text-text-dim hover:text-text-primary hover:border-text-dim transition-colors"><ChevronLeft size={15} /></button>
            <button onClick={() => setFocusDate(new Date())} className="px-3 py-1.5 rounded-btn border border-border text-xs font-rajdhani font-semibold text-text-secondary hover:text-text-primary uppercase tracking-wider transition-colors">Today</button>
            <button onClick={() => navigate(1)} className="p-1.5 rounded-btn border border-border text-text-dim hover:text-text-primary hover:border-text-dim transition-colors"><ChevronRight size={15} /></button>
          </div>

          <div className="font-rajdhani font-bold text-sm text-text-primary min-w-[12ch]">{label}</div>

          {/* Zoom controls — only for day/week grid views */}
          {(viewMode === 'day' || viewMode === 'week') && (
            <div className="flex items-center gap-0 border border-border rounded-btn overflow-hidden">
              <button
                onClick={zoomOut}
                disabled={zoomLevel <= ZOOM_STEPS[0]}
                title="Zoom out"
                className="px-2 py-1.5 text-text-dim hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors border-r border-border"
              >
                <ZoomOut size={13} />
              </button>
              <span className="px-2 text-[10px] font-mono text-text-dim min-w-[3.5ch] text-center">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                onClick={zoomIn}
                disabled={zoomLevel >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                title="Zoom in"
                className="px-2 py-1.5 text-text-dim hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors border-l border-border"
              >
                <ZoomIn size={13} />
              </button>
            </div>
          )}

          {/* Hide weekends toggle (desktop) */}
          {(viewMode === 'day' || viewMode === 'week') && (
            <button
              onClick={() => setHideWeekends((v) => !v)}
              className={clsx(
                'px-3 py-1.5 rounded-btn border font-rajdhani font-bold text-xs uppercase tracking-wider transition-all',
                hideWeekends
                  ? 'border-accent-amber/60 bg-accent-amber/10 text-accent-amber'
                  : 'border-border text-text-dim hover:border-text-dim',
              )}
            >
              5-day
            </button>
          )}

          <button
            onClick={() => setEditing({ defaultDate: isoDate(focusDate) })}
            className="px-3 py-1.5 rounded-btn bg-accent-amber text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-1.5"
          >
            <Plus size={13} />New block
          </button>

          <button
            onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"
          >
            <Upload size={13} />Import image
          </button>

          <button
            onClick={() => { setAiPanelOpen((o) => !o); setViewMode('week'); }}
            className={clsx(
              'px-3 py-1.5 rounded-btn border font-rajdhani font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5',
              aiPanelOpen
                ? 'bg-accent-cyan/20 border-accent-cyan/60 text-accent-cyan'
                : 'border-accent-cyan/30 text-accent-cyan hover:bg-accent-cyan/10',
              pendingGhostCount > 0 && !aiPanelOpen && 'animate-pulse',
            )}
          >
            <Sparkles size={13} />
            AI Week
            {pendingGhostCount > 0 && (
              <span className="ml-1 text-[9px] bg-accent-cyan text-bg-base rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {pendingGhostCount}
              </span>
            )}
          </button>

          <div className="relative">
            <button
              onClick={() => setExportOpen((o) => !o)}
              className="px-3 py-1.5 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <Download size={13} />Export
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-bg-panel border border-border rounded-lg shadow-2xl py-1 z-50">
                <button onClick={() => doExport('ics')} className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"><CalendarDays size={12} />iCal (.ics)</button>
                <button onClick={() => doExport('pdf')} className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"><FileText size={12} />PDF agenda</button>
                <button onClick={() => doExport('csv')} className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"><FileSpreadsheet size={12} />CSV</button>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Body */}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {(viewMode === 'day' || viewMode === 'week') && (
          <DayWeekGrid
            days={days}
            occurrences={occurrences}
            conflicts={conflicts}
            calendar={calendar}
            ghosts={ghosts}
            zoomLevel={zoomLevel}
            onCreate={(dateISO, startMin, endMin) => setEditing({
              defaultDate: dateISO,
              initial: {
                startISO: `${dateISO}T${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}:00`,
                endISO: `${dateISO}T${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}:00`,
              },
            })}
            onEditBlock={editOccurrence}
            onViewMaterials={(occ) => setSlotMaterials({ block: occ.block, startISO: occ.startISO, endISO: occ.endISO })}
            onContextMenu={(occ, x, y) => setContextMenu({ occ, x, y })}
            onAttachArtifact={attachArtifact}
            onResize={resizeOccurrence}
            onMove={moveOccurrence}
            onAcceptGhost={acceptGhost}
            onRejectGhost={rejectGhost}
          />
        )}
        {viewMode === 'month' && (
          <MonthView
            focusDate={focusDate}
            occurrences={occurrences}
            calendar={calendar}
            onDayClick={(d) => { setFocusDate(d); setViewMode('day'); }}
            onOccClick={(occ) => setSlotMaterials({ block: occ.block, startISO: occ.startISO, endISO: occ.endISO })}
          />
        )}
        {viewMode === 'term' && (
          <YearView
            year={focusDate.getFullYear()}
            occurrences={occurrences}
            calendar={calendar}
            onDayClick={(d) => { setFocusDate(d); setViewMode('day'); }}
            mode="term"
            termFilter={termFor(isoDate(focusDate), calendar)}
          />
        )}
        {viewMode === 'year' && (
          <YearView
            year={focusDate.getFullYear()}
            occurrences={occurrences}
            calendar={calendar}
            onDayClick={(d) => { setFocusDate(d); setViewMode('day'); }}
            mode="year"
          />
        )}
      </DndContext>

      {/* Editor modal */}
      {editing && (
        <BlockEditor
          initial={editing.initial}
          defaultDate={editing.defaultDate}
          isRecurringInstance={editing.isInstance}
          onSave={saveEditor}
          onDelete={editing.initial?.id ? deleteFromEditor : undefined}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextItems(contextMenu.occ)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Scope confirmation */}
      {scopeConfirm && (
        <div className="fixed inset-0 z-[65] bg-black/60 flex items-center justify-center p-4" onClick={() => setScopeConfirm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-bg-panel border border-border rounded-lg shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-bg-elevated">
              <h3 className="font-orbitron text-sm font-bold text-text-primary">{scopeConfirm.verb.toUpperCase()} RECURRING EVENT</h3>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-text-secondary">This event is part of a series. Apply {scopeConfirm.verb.toLowerCase()} to:</p>
              <div className="space-y-1.5">
                <button
                  onClick={() => { scopeConfirm.action('single'); setScopeConfirm(null); }}
                  className="w-full px-3 py-2 rounded-btn border border-border text-left text-sm text-text-primary hover:bg-bg-elevated transition-colors"
                >
                  This event only
                </button>
                <button
                  onClick={() => { scopeConfirm.action('series'); setScopeConfirm(null); }}
                  className="w-full px-3 py-2 rounded-btn border border-border text-left text-sm text-text-primary hover:bg-bg-elevated transition-colors"
                >
                  All events in this series
                </button>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border bg-bg-elevated flex justify-end">
              <button onClick={() => setScopeConfirm(null)} className="px-3 py-1.5 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Slot materials modal */}
      {slotMaterials && (
        <SlotMaterialsModal
          block={slotMaterials.block}
          occurrenceStart={slotMaterials.startISO}
          occurrenceEnd={slotMaterials.endISO}
          onClose={() => setSlotMaterials(null)}
          onEdit={() => {
            setEditing({
              initial: { ...slotMaterials.block, startISO: slotMaterials.startISO, endISO: slotMaterials.endISO },
              isInstance: slotMaterials.block.recurrence != null,
            });
            setSlotMaterials(null);
          }}
        />
      )}

      {/* Import modal */}
      {importOpen && <TimetableImportModal onClose={() => setImportOpen(false)} />}

      {/* AI Week Panel */}
      {aiPanelOpen && (
        <AIWeekPanel
          ghosts={ghosts}
          loading={aiLoading}
          error={aiError}
          prefs={aiPrefs}
          onPrefsChange={savePrefs}
          onGenerate={generateWeek}
          onAccept={acceptGhost}
          onReject={rejectGhost}
          onAcceptAll={acceptAllGhosts}
          onRejectAll={rejectAllGhosts}
          onClose={() => setAiPanelOpen(false)}
          weekLabel={label}
        />
      )}
    </div>
  );
}
