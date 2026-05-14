import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { complete } from '../llm';
import type { ImageContent } from '../llm/types';
import type { TimetableBlock } from '../../db/schema';
import { addDays, isoDate, isoDateTime, parseLocal } from './dates';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export const IMPORT_SYSTEM_PROMPT = `You are extracting an Australian secondary school timetable from an image into structured JSON.

PERIOD ROW LABELS AND FIXED TIMES (always use these exact times regardless of what the image shows):
- P1  → periodNumber 1  → 08:40–09:30
- S2  → periodNumber 2  → 09:30–10:20
- SR  → SKIP (recess, not a teaching period)
- S3  → periodNumber 3  → 10:45–11:35
- S4  → periodNumber 4  → 11:35–12:25
- SL1 → SKIP (lunch 1, not a teaching period)
- SL2 → periodNumber 7  → 12:50–13:20  (only include if a class/duty appears in that row)
- S5  → periodNumber 5  → 13:20–14:10
- S6  → periodNumber 6  → 14:10–15:05

COLUMNS are days. The column headers contain the date (e.g. "4/May") and the day name/number (e.g. "Monday 1"). Use the full day name (Monday, Tuesday, Wednesday, Thursday, Friday).

CELL CONTENT: Each cell typically contains (in order, top to bottom):
  1. A class code line (e.g. "8TITC.1A3# 75", "Duty.SRED#", "10GSPR.B# 20")
  2. A subject/description line — this may wrap across TWO lines in the image (e.g. "Year 9/10 The Digital World" + "in 3D" should be joined into "Year 9/10 The Digital World in 3D")
  3. A student-count line (e.g. "21 students") — do NOT include this in the subject
  4. Optional italic "Relieved by ..." note

Extract:
- classCode: the exact class code line, preserving punctuation and spacing (e.g. "8TITC.1A3# 75")
- subject: the FULL descriptive subject name, joining wrapped lines. NEVER output the generic word "Teaching" or "Class" — always use the specific descriptive name from the cell. For Duty rows use the duty description (e.g. "RED: Lower Secondary", "Library").
- teacher: any "Relieved by" name if present, else null
- room: null (not shown separately)
- week: always 1

IMPORTANT: Every non-empty cell MUST produce both a classCode and a subject. If either is missing from your reading, look again — the cell will contain both. Do not fall back to generic labels like "Teaching".

Empty cells mean no class that period — do NOT create a block for empty cells. Duty rows (SR, SL2) with a "Duty.XXXX" entry should be included with subject = the duty label.

Return ONLY strict JSON, no prose, no markdown:
{
  "days": ["Monday","Tuesday","Wednesday","Thursday","Friday"],
  "periods": [
    {"number":1,"startTime":"08:40","endTime":"09:30"},
    {"number":2,"startTime":"09:30","endTime":"10:20"},
    {"number":3,"startTime":"10:45","endTime":"11:35"},
    {"number":4,"startTime":"11:35","endTime":"12:25"},
    {"number":7,"startTime":"12:50","endTime":"13:20"},
    {"number":5,"startTime":"13:20","endTime":"14:10"},
    {"number":6,"startTime":"14:10","endTime":"15:05"}
  ],
  "blocks": [...]
}`;

// ─── Types ──────────────────────────────────────────────────────────

export type DayName = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface ExtractedPeriod {
  number: number;
  startTime: string | null; // HH:MM or null
  endTime: string | null;
}

export interface ExtractedBlock {
  day: string;
  periodNumber: number;
  subject: string;
  classCode?: string | null;
  room?: string | null;
  teacher?: string | null;
  /** Week in cycle (1..N). Only populated for multi-week timetables. Defaults to 1. */
  week?: number;
}

export interface ExtractedTimetable {
  days: string[];
  periods: ExtractedPeriod[];
  blocks: ExtractedBlock[];
}

// ─── Image preparation ──────────────────────────────────────────────

/** Rasterise first page of a PDF into a PNG data URL + base64. */
export async function rasterisePdfFirstPage(file: File): Promise<{ base64: string; mediaType: 'image/png' }> {
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1] ?? '';
  return { base64, mediaType: 'image/png' };
}

export async function fileToBase64Image(file: File): Promise<{ base64: string; mediaType: ImageContent['mediaType'] }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const mime = file.type as ImageContent['mediaType'];
  const allowed: ImageContent['mediaType'][] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const mediaType = allowed.includes(mime) ? mime : 'image/png';
  return { base64: btoa(binary), mediaType };
}

// ─── Vision call ────────────────────────────────────────────────────

export interface ImportCallParams {
  file: File;
  anthropicKey?: string;
  openaiKey?: string;
}

export async function callVisionImport(params: ImportCallParams): Promise<ExtractedTimetable> {
  const { file, anthropicKey, openaiKey } = params;

  let image: ImageContent;
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const { base64, mediaType } = await rasterisePdfFirstPage(file);
    image = { type: 'image', data: base64, mediaType };
  } else {
    const { base64, mediaType } = await fileToBase64Image(file);
    image = { type: 'image', data: base64, mediaType };
  }

  const useAnthropic = !!anthropicKey;
  const provider = useAnthropic ? 'anthropic' : 'openai';
  const apiKey = useAnthropic ? anthropicKey! : openaiKey!;
  if (!apiKey) throw new Error('No vision API key available. Add Anthropic or OpenAI key in Settings.');

  const model = useAnthropic ? 'claude-opus-4-5' : 'gpt-4o';

  const res = await complete({
    provider,
    model,
    apiKey,
    system: IMPORT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        image,
        {
          type: 'text',
          text: 'Extract every teaching block from this timetable image following the system instructions exactly. Use the fixed period times from the system prompt — do not invent or guess different times. Return ONLY valid JSON, no markdown, no explanation.',
        },
      ],
    }],
    maxTokens: 4000,
  });

  return parseImportJson(res.text);
}

/** Canonical period schedule — always applied after AI extraction. */
export const CANONICAL_PERIODS: ExtractedPeriod[] = [
  { number: 1, startTime: '08:40', endTime: '09:30' },
  { number: 2, startTime: '09:30', endTime: '10:20' },
  { number: 3, startTime: '10:45', endTime: '11:35' },
  { number: 4, startTime: '11:35', endTime: '12:25' },
  { number: 7, startTime: '12:50', endTime: '13:20' },
  { number: 5, startTime: '13:20', endTime: '14:10' },
  { number: 6, startTime: '14:10', endTime: '15:05' },
];

export function parseImportJson(raw: string): ExtractedTimetable {
  let clean = raw.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Could not locate JSON in the model response.');
  const obj = JSON.parse(clean.slice(start, end + 1));
  const days = Array.isArray(obj.days) ? obj.days.map(String) : [];
  const periods: ExtractedPeriod[] = Array.isArray(obj.periods)
    ? obj.periods.map((p: Record<string, unknown>) => ({
        number: Number(p.number ?? 0),
        startTime: typeof p.startTime === 'string' ? p.startTime : null,
        endTime: typeof p.endTime === 'string' ? p.endTime : null,
      }))
    : [];
  const blocks: ExtractedBlock[] = Array.isArray(obj.blocks)
    ? obj.blocks.map((b: Record<string, unknown>) => ({
        day: String(b.day ?? ''),
        periodNumber: Number(b.periodNumber ?? 0),
        subject: String(b.subject ?? ''),
        classCode: b.classCode ? String(b.classCode) : null,
        room: b.room ? String(b.room) : null,
        teacher: b.teacher ? String(b.teacher) : null,
        week: b.week != null ? Number(b.week) : 1,
      }))
    : [];

  // Always override period times with the canonical school schedule for known period numbers.
  // Unknown period numbers returned by the AI are kept as-is.
  const canonicalMap = new Map(CANONICAL_PERIODS.map((p) => [p.number, p]));
  const knownNums = new Set(CANONICAL_PERIODS.map((p) => p.number));
  // Keep AI periods for unknown numbers, then add all canonical ones
  const aiUnknown = periods.filter((p) => !knownNums.has(p.number));
  const mergedPeriods: ExtractedPeriod[] = [
    ...CANONICAL_PERIODS,
    ...aiUnknown,
  ];
  // Only include period numbers that actually appear in blocks
  const usedNums = new Set(blocks.map((b) => b.periodNumber));
  const filteredPeriods = mergedPeriods.filter((p) => usedNums.has(p.number) || canonicalMap.has(p.number));

  return { days, periods: filteredPeriods, blocks };
}

// ─── Cycle expansion ────────────────────────────────────────────────

const DAY_INDEX: Record<string, number> = {
  monday: 0, mon: 0,
  tuesday: 1, tue: 1, tues: 1,
  wednesday: 2, wed: 2,
  thursday: 3, thu: 3, thur: 3, thurs: 3,
  friday: 4, fri: 4,
  saturday: 5, sat: 5,
  sunday: 6, sun: 6,
  // Australian/UK-style day letters A-J for multi-week cycles
  a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9,
};

function dayOffset(day: string, cycleDayKeys?: string[]): number {
  const lower = day.trim().toLowerCase();
  if (cycleDayKeys) {
    const idx = cycleDayKeys.findIndex((d) => d.trim().toLowerCase() === lower);
    if (idx >= 0) return idx;
  }
  return DAY_INDEX[lower] ?? -1;
}

/** Parse HH:MM or H:MMam/pm into { hours, minutes } */
function parseTime(raw: string): { hours: number; minutes: number } | null {
  if (!raw) return null;
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/);
  if (!m) {
    const h = raw.trim().toLowerCase().match(/^(\d{1,2})\s*(am|pm)$/);
    if (h) {
      let hh = parseInt(h[1], 10);
      if (h[2] === 'pm' && hh < 12) hh += 12;
      if (h[2] === 'am' && hh === 12) hh = 0;
      return { hours: hh, minutes: 0 };
    }
    return null;
  }
  let hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const mer = m[3];
  if (mer === 'pm' && hh < 12) hh += 12;
  if (mer === 'am' && hh === 12) hh = 0;
  return { hours: hh, minutes: mm };
}

export interface CycleConfig {
  weeksInCycle: number;
  startDate: Date; // Monday that week 1 begins
  monthsHorizon: number; // typically 12
  /** Fallback: period 1 start time and duration when AI returned null times */
  fallbackPeriod1Start?: string; // HH:MM
  fallbackPeriodMinutes?: number;
  /** Minutes between periods if no end time supplied (default 5) */
  interPeriodBreakMinutes?: number;
  defaultLocation?: string;
}

export function computePeriodTimes(
  periods: ExtractedPeriod[],
  fallback?: { start: string; durationMin: number; breakMin?: number },
): Map<number, { start: string; end: string }> {
  const out = new Map<number, { start: string; end: string }>();
  const hasTimes = periods.some((p) => p.startTime && p.endTime);
  if (hasTimes) {
    for (const p of periods) {
      if (p.startTime && p.endTime) out.set(p.number, { start: p.startTime, end: p.endTime });
    }
    return out;
  }
  if (!fallback) return out;
  const first = parseTime(fallback.start);
  if (!first) return out;
  const sorted = [...periods].sort((a, b) => a.number - b.number);
  const brk = fallback.breakMin ?? 5;
  let cursor = first.hours * 60 + first.minutes;
  for (const p of sorted) {
    const start = cursor;
    const end = start + fallback.durationMin;
    const s = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
    const e = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    out.set(p.number, { start: s, end: e });
    cursor = end + brk;
  }
  return out;
}

export interface ExpandedBlock {
  startISO: string;
  endISO: string;
  block: ExtractedBlock;
}

export function expandCycle(
  extracted: ExtractedTimetable,
  cycle: CycleConfig,
  dayKeys?: string[],
): ExpandedBlock[] {
  const times = computePeriodTimes(
    extracted.periods,
    cycle.fallbackPeriod1Start && cycle.fallbackPeriodMinutes
      ? { start: cycle.fallbackPeriod1Start, durationMin: cycle.fallbackPeriodMinutes, breakMin: cycle.interPeriodBreakMinutes }
      : undefined,
  );

  const horizonEnd = new Date(cycle.startDate);
  horizonEnd.setMonth(horizonEnd.getMonth() + cycle.monthsHorizon);

  const out: ExpandedBlock[] = [];
  const cycleLen = Math.max(1, cycle.weeksInCycle) * 7;

  for (let offset = 0; offset < (cycle.monthsHorizon * 31) + cycleLen; offset += cycleLen) {
    const cycleStart = addDays(cycle.startDate, offset);
    if (cycleStart > horizonEnd) break;

    for (const b of extracted.blocks) {
      const week = Math.max(1, Math.min(cycle.weeksInCycle, b.week ?? 1));
      const dayIdx = dayOffset(b.day, dayKeys);
      if (dayIdx < 0) continue;
      const dayOffsetInCycle = (week - 1) * 7 + dayIdx;
      const date = addDays(cycleStart, dayOffsetInCycle);
      if (date > horizonEnd) continue;

      const t = times.get(b.periodNumber);
      if (!t) continue;

      const startISO = `${isoDate(date)}T${t.start}:00`;
      const endISO = `${isoDate(date)}T${t.end}:00`;
      out.push({ startISO, endISO, block: b });
    }
  }
  return out;
}

export function buildClassBlocks(expanded: ExpandedBlock[], groupTag: string): TimetableBlock[] {
  const createdAt = Date.now();
  return expanded.map((e) => ({
    id: `blk_${createdAt.toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    title: [e.block.subject, e.block.classCode].filter(Boolean).join(' · '),
    type: 'class' as const,
    location: e.block.room ?? undefined,
    notes: [
      e.block.teacher ? `Teacher: ${e.block.teacher}` : null,
      `Imported cycle: ${groupTag}`,
    ].filter(Boolean).join('\n'),
    startISO: e.startISO,
    endISO: e.endISO,
    artifactIds: [],
    source: 'imported' as const,
    status: 'scheduled' as const,
    createdAt,
  }));
}

// ─── Diff for re-imports ────────────────────────────────────────────

export interface ReimportDiff {
  existingTag: string;
  existingCount: number;
  incomingCount: number;
}

export function summariseDiff(existing: TimetableBlock[], incoming: TimetableBlock[], tag: string): ReimportDiff {
  return {
    existingTag: tag,
    existingCount: existing.length,
    incomingCount: incoming.length,
  };
}

export function inferDuration(from: string, to: string): number {
  return (parseLocal(to).getTime() - parseLocal(from).getTime()) / 60000;
}

export function firstStartISO(blocks: TimetableBlock[]): string | null {
  if (blocks.length === 0) return null;
  const first = [...blocks].sort((a, b) => parseLocal(a.startISO).getTime() - parseLocal(b.startISO).getTime())[0];
  return first.startISO;
}

export function nextMondayOnOrAfter(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const day = r.getDay();
  const offset = (1 - day + 7) % 7;
  return addDays(r, offset);
}

export { isoDateTime };
