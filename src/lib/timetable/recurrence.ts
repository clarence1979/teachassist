import { RRule, rrulestr } from 'rrule';
import type { TimetableBlock } from '../../db/schema';
import { parseLocal, isoDateTime, isoDate, addMinutes } from './dates';

/** Represents a block occurrence — might be the original or an expanded recurrence. */
export interface BlockOccurrence {
  block: TimetableBlock;
  /** Whether this is a recurring expansion of the series */
  isRecurrence: boolean;
  /** Start of this particular occurrence (may differ from block.startISO for expansions) */
  startISO: string;
  endISO: string;
  /** The ISO date (YYYY-MM-DD) of this occurrence — useful as stable key */
  occurrenceDate: string;
}

/** Duration in minutes. */
function duration(block: TimetableBlock): number {
  return (parseLocal(block.endISO).getTime() - parseLocal(block.startISO).getTime()) / 60_000;
}

/** Expand a set of blocks (some recurring) into concrete occurrences within [windowStart, windowEnd]. */
export function expandOccurrences(
  blocks: TimetableBlock[],
  windowStart: Date,
  windowEnd: Date,
): BlockOccurrence[] {
  const out: BlockOccurrence[] = [];
  const seriesInstances = new Map<string, Set<string>>(); // seriesId -> set of overridden occurrence dates

  // Pre-index overrides so we can skip them in the base series expansion
  for (const b of blocks) {
    if (b.overrideOfSeries && b.overrideInstanceDate) {
      if (!seriesInstances.has(b.overrideOfSeries)) seriesInstances.set(b.overrideOfSeries, new Set());
      seriesInstances.get(b.overrideOfSeries)!.add(b.overrideInstanceDate);
    }
  }

  for (const block of blocks) {
    if (!block.recurrence) {
      // non-recurring — include if it overlaps window
      const s = parseLocal(block.startISO);
      const e = parseLocal(block.endISO);
      if (e >= windowStart && s <= windowEnd) {
        out.push({ block, isRecurrence: false, startISO: block.startISO, endISO: block.endISO, occurrenceDate: isoDate(s) });
      }
      continue;
    }

    // Recurring — expand
    try {
      const rule = parseRRule(block.recurrence, parseLocal(block.startISO));
      const dur = duration(block);
      const exdates = new Set(block.exdates ?? []);
      const overrides = seriesInstances.get(block.seriesId ?? block.id) ?? new Set<string>();

      // Generate all occurrences in the window
      const instances = rule.between(windowStart, windowEnd, true);
      for (const inst of instances) {
        const occDate = isoDate(inst);
        if (exdates.has(occDate) || overrides.has(occDate)) continue;
        const start = inst;
        const end = addMinutes(start, dur);
        out.push({
          block,
          isRecurrence: true,
          startISO: isoDateTime(start),
          endISO: isoDateTime(end),
          occurrenceDate: occDate,
        });
      }
    } catch {
      // Bad RRULE — fall back to treating it as single instance
      const s = parseLocal(block.startISO);
      if (s >= windowStart && s <= windowEnd) {
        out.push({ block, isRecurrence: false, startISO: block.startISO, endISO: block.endISO, occurrenceDate: isoDate(s) });
      }
    }
  }

  return out.sort((a, b) => parseLocal(a.startISO).getTime() - parseLocal(b.startISO).getTime());
}

function parseRRule(rruleStr: string, dtstart: Date): RRule {
  // rrulestr handles the full form "DTSTART:...\nRRULE:..." or just the RRULE line.
  if (rruleStr.startsWith('DTSTART')) {
    const parsed = rrulestr(rruleStr);
    return parsed as RRule;
  }
  // Assume RRULE-only — we need to provide dtstart.
  const clean = rruleStr.replace(/^RRULE:/, '');
  const fullString = `DTSTART:${dtstartFormat(dtstart)}\nRRULE:${clean}`;
  return rrulestr(fullString) as RRule;
}

function dtstartFormat(d: Date): string {
  // Basic YYYYMMDDTHHmmss (local, floating)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
}

/** Common recurrence presets */
export const RECURRENCE_PRESETS: Array<{ label: string; rrule: string }> = [
  { label: 'Does not repeat', rrule: '' },
  { label: 'Daily', rrule: 'FREQ=DAILY' },
  { label: 'Weekdays', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Weekly', rrule: 'FREQ=WEEKLY' },
  { label: 'Every Tuesday', rrule: 'FREQ=WEEKLY;BYDAY=TU' },
  { label: 'Fortnightly', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Monthly', rrule: 'FREQ=MONTHLY' },
];

export function humanReadableRRule(rruleStr: string | undefined): string {
  if (!rruleStr) return 'Does not repeat';
  const preset = RECURRENCE_PRESETS.find((p) => p.rrule === rruleStr);
  if (preset) return preset.label;
  try {
    const rule = parseRRule(rruleStr, new Date());
    return rule.toText();
  } catch {
    return rruleStr;
  }
}
