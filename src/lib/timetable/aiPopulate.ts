import type { TimetableBlock, Task, SchoolCalendarEntry } from '../../db/schema';
import type { BlockOccurrence } from './recurrence';
import { isoDate, addDays, parseLocal } from './dates';
import { termFor, isHoliday } from './schoolCalendar';
import { complete } from '../llm';

export interface TeacherPreferences {
  workDayStart: number; // hour, e.g. 7 (7:00am)
  workDayEnd: number;   // hour, e.g. 18 (6:00pm)
  sleepStart: number;   // hour, e.g. 23
  sleepEnd: number;     // hour, e.g. 6
  breakIntervalMinutes: number; // default 90
  exerciseEnabled: boolean;
  exerciseMinutes: number;
  mealDurations: { breakfast: number; lunch: number; dinner: number };
  meetingBufferMinutes: number;
  familyCommitments?: string; // free text fed to AI
  learnedPreferences: LearnedPreference[];
}

export interface LearnedPreference {
  description: string; // e.g. "teacher prefers prep on Monday afternoons"
  addedAt: number;
}

export interface GhostBlock {
  id: string;
  title: string;
  type: TimetableBlock['type'];
  subtype?: string;
  color?: string;
  startISO: string;
  endISO: string;
  location?: string;
  notes?: string;
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
  sourceBlockId?: string; // if it replaces an existing block
}

export const DEFAULT_PREFS: TeacherPreferences = {
  workDayStart: 7,
  workDayEnd: 18,
  sleepStart: 23,
  sleepEnd: 6,
  breakIntervalMinutes: 90,
  exerciseEnabled: true,
  exerciseMinutes: 45,
  mealDurations: { breakfast: 30, lunch: 45, dinner: 45 },
  meetingBufferMinutes: 10,
  learnedPreferences: [],
};

function formatBlock(b: TimetableBlock | BlockOccurrence): string {
  const block = 'block' in b ? b.block : b;
  const start = 'block' in b ? b.startISO : b.startISO;
  const end = 'block' in b ? b.endISO : b.endISO;
  return `  - "${block.title}" [${block.type}] ${start.slice(11, 16)}–${end.slice(11, 16)} on ${start.slice(0, 10)}`;
}

function formatTask(t: Task): string {
  const pri = ['', 'P1', 'P2', 'P3', 'P4', 'P5'][t.priority];
  const dl = t.deadline ? ` due ${new Date(t.deadline).toLocaleDateString('en-AU')}` : '';
  return `  - "${t.title}" [${pri}${dl}] ~${t.estimatedDurationMin}min`;
}

export function buildSystemPrompt(prefs: TeacherPreferences): string {
  return `You are a scheduling assistant for a school teacher in Victoria, Australia.
Your task is to populate an entire week with a complete, balanced, and realistic schedule.

## Your scheduling rules (MANDATORY)
1. SLEEP: Always schedule a sleep block from ${prefs.sleepStart}:00 to ${String(prefs.sleepEnd).padStart(2,'0')}:00 every night.
2. MEALS: Schedule breakfast (${prefs.mealDurations.breakfast}min), lunch (${prefs.mealDurations.lunch}min), and dinner (${prefs.mealDurations.dinner}min) every day. Never overlap meals with fixed teaching/meeting blocks.
3. BREAKS: Schedule a short 15-min break after every ~${prefs.breakIntervalMinutes} minutes of cognitive work.
4. EXERCISE: ${prefs.exerciseEnabled ? `Schedule one ${prefs.exerciseMinutes}-min exercise block per day.` : 'Do not schedule exercise (disabled).'}
5. WORK HOURS: Keep all cognitive/work tasks between ${prefs.workDayStart}:00–${prefs.workDayEnd}:00.
6. MEETING BUFFERS: Add a ${prefs.meetingBufferMinutes}-min buffer block (type: "prep") before back-to-back meetings.
7. PENDING TASKS: Try to fit high-priority pending tasks into available prep/evening slots.
8. NEVER overlap with FIXED blocks (marked below). Treat them as immovable.
9. Weekend days should have lighter schedules (personal + exercise + family time).
10. NEVER create generic teaching placeholders (e.g. "Period 1 - Teaching", "Teaching", "Class"). Teaching time is ALREADY represented by the FIXED imported class blocks listed below — do not duplicate or shadow them. Only schedule around them.
11. Allowed block types are personal/prep/meeting/duty/pd/custom for your output. Do NOT emit type "class" — classes come exclusively from the teacher's imported timetable.

## Output format
Return ONLY a valid JSON array of block objects (no markdown fences, no commentary):
[
  {
    "title": "Sleep",
    "type": "personal",
    "subtype": "sleep",
    "startISO": "2024-06-03T23:00:00",
    "endISO": "2024-06-04T06:00:00",
    "rationale": "Ensuring 7h sleep window"
  },
  ...
]

Allowed types: "class" | "prep" | "meeting" | "duty" | "pd" | "personal" | "custom"
startISO and endISO must use local ISO-8601 format YYYY-MM-DDTHH:MM:SS.
ALL seven days Monday–Sunday must be covered.
`;
}

export function buildUserPrompt(
  weekStart: Date,
  fixedOccurrences: BlockOccurrence[],
  pendingTasks: Task[],
  calendar: SchoolCalendarEntry[],
  prefs: TeacherPreferences,
  recentPatterns?: string,
): string {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = addDays(weekStart, 6);

  const lines: string[] = [
    `## Week to populate`,
    `${isoDate(weekStart)} (Mon) → ${isoDate(weekEnd)} (Sun)`,
    '',
    '## School calendar',
  ];

  for (const day of days) {
    const iso = isoDate(day);
    const hol = isHoliday(iso, calendar);
    const term = termFor(iso, calendar);
    if (hol) lines.push(`  - ${iso}: HOLIDAY — ${hol.label}`);
    else if (term) lines.push(`  - ${iso}: ${term.label}`);
    else lines.push(`  - ${iso}: School vacation`);
  }

  lines.push('', '## Fixed (immovable) blocks');
  if (fixedOccurrences.length === 0) {
    lines.push('  (none)');
  } else {
    for (const o of fixedOccurrences) {
      lines.push(formatBlock(o));
    }
  }

  lines.push('', '## Pending tasks to schedule this week (prioritised)');
  const top = pendingTasks.slice(0, 8);
  if (top.length === 0) {
    lines.push('  (none)');
  } else {
    for (const t of top) lines.push(formatTask(t));
  }

  lines.push('', '## Teacher preferences');
  lines.push(`  - Work hours: ${prefs.workDayStart}:00–${prefs.workDayEnd}:00`);
  lines.push(`  - Sleep window: ${prefs.sleepStart}:00–${String(prefs.sleepEnd).padStart(2,'0')}:00`);
  lines.push(`  - Break every ${prefs.breakIntervalMinutes}min cognitive work`);
  if (prefs.familyCommitments) lines.push(`  - Family: ${prefs.familyCommitments}`);

  if (prefs.learnedPreferences.length > 0) {
    lines.push('', '## Learned preferences from past overrides');
    for (const lp of prefs.learnedPreferences.slice(-10)) {
      lines.push(`  - ${lp.description}`);
    }
  }

  if (recentPatterns) {
    lines.push('', '## Recent week pattern (for context)');
    lines.push(recentPatterns);
  }

  lines.push('', 'Now generate the complete week schedule as a JSON array.');
  return lines.join('\n');
}

export function parseAIResponse(raw: string): Omit<GhostBlock, 'id' | 'status'>[] {
  let cleaned = raw.trim();
  // Strip all markdown fences (may wrap the whole response or individual blocks)
  cleaned = cleaned.replace(/```(?:json)?/gi, '').trim();

  let arr: unknown = null;

  // Attempt 1: parse as-is (could be an array, or an object wrapper)
  try {
    arr = JSON.parse(cleaned);
  } catch {
    // ignore, try slicing
  }

  // Attempt 2: find outermost JSON array slice
  if (!Array.isArray(arr)) {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        arr = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
  }

  // Attempt 3: unwrap common object shapes { blocks: [...] } / { schedule: [...] } / { data: [...] }
  if (!Array.isArray(arr) && arr && typeof arr === 'object') {
    const obj = arr as Record<string, unknown>;
    for (const k of ['blocks', 'schedule', 'data', 'items', 'events', 'week']) {
      if (Array.isArray(obj[k])) { arr = obj[k]; break; }
    }
    if (!Array.isArray(arr)) {
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) { arr = v; break; }
      }
    }
  }

  // Attempt 4: concatenated JSON objects { ... }{ ... } — pick each balanced object
  if (!Array.isArray(arr)) {
    const objs: unknown[] = [];
    let depth = 0;
    let startIdx = -1;
    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (c === '{') { if (depth === 0) startIdx = i; depth++; }
      else if (c === '}') {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          try { objs.push(JSON.parse(cleaned.slice(startIdx, i + 1))); } catch { /* skip */ }
          startIdx = -1;
        }
      }
    }
    if (objs.length > 0) arr = objs;
  }

  if (!Array.isArray(arr)) {
    throw new Error(`No JSON array found in AI response. Preview: ${cleaned.slice(0, 200)}`);
  }

  const validTypes = new Set(['class', 'prep', 'meeting', 'duty', 'pd', 'personal', 'custom']);
  const placeholderTitle = /^(period\s*\d+(\s*[-–:]\s*teaching)?|teaching|class|lesson)\s*$/i;

  return arr
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter((item) => item.startISO && item.endISO && item.title)
    .filter((item) => !placeholderTitle.test(String(item.title).trim()))
    .map((item) => ({
      title: String(item.title ?? 'AI Block'),
      type: (validTypes.has(String(item.type)) ? item.type : 'personal') as TimetableBlock['type'],
      subtype: item.subtype ? String(item.subtype) : undefined,
      color: item.color ? String(item.color) : undefined,
      startISO: String(item.startISO),
      endISO: String(item.endISO),
      location: item.location ? String(item.location) : undefined,
      notes: item.notes ? String(item.notes) : undefined,
      rationale: String(item.rationale ?? ''),
    }));
}

export async function populateWeekWithAI(params: {
  anthropicKey?: string;
  openaiKey?: string;
  weekStart: Date;
  fixedOccurrences: BlockOccurrence[];
  pendingTasks: Task[];
  calendar: SchoolCalendarEntry[];
  prefs: TeacherPreferences;
  recentPatterns?: string;
}): Promise<Omit<GhostBlock, 'id' | 'status'>[]> {
  const { anthropicKey, openaiKey, weekStart, fixedOccurrences, pendingTasks, calendar, prefs, recentPatterns } = params;

  // Prefer Anthropic if available, fall back to OpenAI
  const provider = anthropicKey ? 'anthropic' : 'openai';
  const apiKey = anthropicKey ?? openaiKey;
  if (!apiKey) throw new Error('No AI API key configured. Add an Anthropic or OpenAI key in Settings.');

  const model = provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o';

  const systemPrompt = buildSystemPrompt(prefs);
  const userPrompt = buildUserPrompt(weekStart, fixedOccurrences, pendingTasks, calendar, prefs, recentPatterns);

  const res = await complete({
    provider,
    model,
    apiKey,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 4096,
    temperature: 0.3,
  });

  return parseAIResponse(res.text);
}

/** Convert a ghost block that was moved/rejected into a learned preference string. */
export function deriveLearnedPreference(ghost: GhostBlock, movedTo?: { startISO: string }): string {
  const day = new Date(ghost.startISO).toLocaleDateString('en-AU', { weekday: 'long' });
  const timeOfDay = (() => {
    const h = parseLocal(ghost.startISO).getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  })();
  if (movedTo) {
    const newDay = new Date(movedTo.startISO).toLocaleDateString('en-AU', { weekday: 'long' });
    const newH = parseLocal(movedTo.startISO).getHours();
    const newPart = newH < 12 ? 'morning' : newH < 17 ? 'afternoon' : 'evening';
    return `Teacher moved "${ghost.title}" (${ghost.type}) from ${day} ${timeOfDay} to ${newDay} ${newPart}`;
  }
  return `Teacher rejected "${ghost.title}" (${ghost.type}) on ${day} ${timeOfDay} — avoid scheduling this here`;
}

export function buildRecentPattern(weekStart: Date, blocks: TimetableBlock[]): string {
  const prevStart = addDays(weekStart, -7);
  const prevEnd = addDays(weekStart, -1);
  const prevBlocks = blocks.filter((b) => {
    const d = isoDate(parseLocal(b.startISO));
    return d >= isoDate(prevStart) && d <= isoDate(prevEnd);
  });
  if (prevBlocks.length === 0) return '';
  const grouped = new Map<string, string[]>();
  for (const b of prevBlocks) {
    const day = new Date(b.startISO).toLocaleDateString('en-AU', { weekday: 'short' });
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(`${b.title}@${b.startISO.slice(11, 16)}`);
  }
  return [...grouped.entries()].map(([d, ls]) => `  ${d}: ${ls.join(', ')}`).join('\n');
}
