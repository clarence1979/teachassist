import type { TimetableBlock, BlockType } from '../../db/schema';
import { uid } from '../../db/repos';

// ─── Low-level tokeniser ─────────────────────────────────────────────────────

interface RawEvent {
  [prop: string]: string[];
}

function unfold(raw: string): string {
  // RFC 5545 line-folding: CRLF followed by a single whitespace char
  return raw.replace(/\r?\n[ \t]/g, '');
}

function parseICS(text: string): RawEvent[] {
  const lines = unfold(text).split(/\r?\n/);
  const events: RawEvent[] = [];
  let current: RawEvent | null = null;

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const colonIdx = raw.indexOf(':');
    if (colonIdx === -1) continue;
    const propFull = raw.slice(0, colonIdx).toUpperCase();
    const value = raw.slice(colonIdx + 1);
    // Strip parameters from property name (e.g. DTSTART;TZID=... → DTSTART)
    const prop = propFull.split(';')[0];

    if (prop === 'BEGIN' && value.trim() === 'VEVENT') {
      current = {};
    } else if (prop === 'END' && value.trim() === 'VEVENT') {
      if (current) {
        events.push(current);
        current = null;
      }
    } else if (current) {
      if (!current[prop]) current[prop] = [];
      current[prop].push(value.trim());
    }
  }
  return events;
}

// ─── Date parsing ────────────────────────────────────────────────────────────

/**
 * Parse iCal datetime value to a local ISO string (no timezone conversion —
 * we treat all times as local, which matches how blocks are stored elsewhere).
 * Handles: 20240101T090000Z, 20240101T090000, 20240101 (date-only)
 */
function icsDateToISO(val: string): string {
  const v = val.replace('Z', '').trim();
  if (v.length === 8) {
    // DATE-only: 20240101
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00`;
  }
  // DATETIME: 20240101T090000
  const d = v.replace('T', '');
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}`;
}

// ─── Type mapping ─────────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, BlockType> = {
  class: 'class',
  lesson: 'class',
  prep: 'prep',
  preparation: 'prep',
  meeting: 'meeting',
  duty: 'duty',
  pd: 'pd',
  'professional development': 'pd',
  personal: 'personal',
};

function guessType(event: RawEvent): BlockType {
  const cats = (event['CATEGORIES'] ?? []).join(',').toLowerCase();
  for (const [k, v] of Object.entries(CATEGORY_MAP)) {
    if (cats.includes(k)) return v;
  }
  // Fallback: look in summary
  const summary = (event['SUMMARY']?.[0] ?? '').toLowerCase();
  for (const [k, v] of Object.entries(CATEGORY_MAP)) {
    if (summary.includes(k)) return v;
  }
  return 'custom';
}

// ─── RRULE passthrough ────────────────────────────────────────────────────────

function extractRRule(event: RawEvent): string | undefined {
  return event['RRULE']?.[0];
}

function extractExdates(event: RawEvent): string[] | undefined {
  const raw = event['EXDATE'];
  if (!raw?.length) return undefined;
  return raw.flatMap((v) => v.split(',')).map(icsDateToISO).map((iso) => iso.slice(0, 10));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ICSParseResult {
  blocks: Omit<TimetableBlock, 'createdAt'>[];
  skipped: number;
}

export function parseICSToBlocks(text: string): ICSParseResult {
  const raw = parseICS(text);
  const blocks: Omit<TimetableBlock, 'createdAt'>[] = [];
  let skipped = 0;

  for (const ev of raw) {
    const startRaw = ev['DTSTART']?.[0];
    const endRaw = ev['DTEND']?.[0] ?? ev['DTSTART']?.[0];
    const title = ev['SUMMARY']?.[0] ?? 'Imported event';

    if (!startRaw) { skipped++; continue; }

    let startISO: string;
    let endISO: string;
    try {
      startISO = icsDateToISO(startRaw);
      endISO = icsDateToISO(endRaw ?? startRaw);
    } catch {
      skipped++;
      continue;
    }

    // If end equals start (date-only all-day), make it a 1-hour block
    if (startISO === endISO) {
      const d = new Date(startISO);
      d.setHours(d.getHours() + 1);
      endISO = d.toISOString().slice(0, 19);
    }

    const rrule = extractRRule(ev);
    const exdates = extractExdates(ev);
    const type = guessType(ev);

    const status = ev['STATUS']?.[0]?.toUpperCase();

    blocks.push({
      id: uid(),
      title,
      type,
      notes: ev['DESCRIPTION']?.[0]?.replace(/\\n/g, '\n').replace(/\\,/g, ',') ?? undefined,
      location: ev['LOCATION']?.[0]?.replace(/\\,/g, ',') ?? undefined,
      startISO,
      endISO,
      recurrence: rrule,
      exdates: exdates?.length ? exdates : undefined,
      source: 'imported',
      status: status === 'CANCELLED' ? 'cancelled' : 'scheduled',
    });
  }

  return { blocks, skipped };
}
