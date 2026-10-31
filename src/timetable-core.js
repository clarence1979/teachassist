/* ═══════════════════════════════════════════════════════════════════════════
   Timetable core — local dates, recurrence (RRULE subset), ICS import/export.
   All times are local, written as "YYYY-MM-DDTHH:MM:SS" with no timezone suffix.
   ═══════════════════════════════════════════════════════════════════════════ */

const BLOCK_TYPES = [
  { value: 'class', label: 'Class', color: '#0ea5e9' },
  { value: 'prep', label: 'Prep', color: '#22c55e' },
  { value: 'meeting', label: 'Meeting', color: '#f59e0b' },
  { value: 'duty', label: 'Duty', color: '#ef4444' },
  { value: 'pd', label: 'PD', color: '#6366f1' },
  { value: 'personal', label: 'Personal', color: '#64748b' },
  { value: 'custom', label: 'Custom', color: '#14b8a6' },
];
function typeColor(type, custom) { if (type === 'custom' && custom) return custom; return BLOCK_TYPES.find((t) => t.value === type)?.color || '#64748b'; }
function typeLabel(type) { return BLOCK_TYPES.find((t) => t.value === type)?.label || type; }

/* ───────────────────────────── Dates ───────────────────────────── */
const pad2 = (n) => String(n).padStart(2, '0');
function parseLocal(iso) {
  if (iso instanceof Date) return iso;
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) { const d = new Date(iso); return isNaN(d) ? new Date(NaN) : d; }
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}
function isoDate(d) { d = parseLocal(d); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function isoDateTime(d) { d = parseLocal(d); return `${isoDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function addDays(d, n) { const x = new Date(parseLocal(d)); x.setDate(x.getDate() + n); return x; }
function addMinutes(d, n) { return new Date(parseLocal(d).getTime() + n * 60000); }
function startOfDay(d) { const x = new Date(parseLocal(d)); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(parseLocal(d)); x.setHours(23, 59, 59, 999); return x; }
function startOfWeek(d) { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; } // Monday
function startOfMonth(d) { const x = startOfDay(d); x.setDate(1); return x; }
function minutesOfDay(d) { d = parseLocal(d); return d.getHours() * 60 + d.getMinutes(); }
function sameDay(a, b) { return isoDate(a) === isoDate(b); }
function fmtTime(d) { d = parseLocal(d); const h = d.getHours(), m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 === 0 ? 12 : h % 12; return m ? `${hh}:${pad2(m)}${ap}` : `${hh}${ap}`; }
function fmtDateLong(d) { return parseLocal(d).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function fmtDateShort(d) { return parseLocal(d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }); }
function durationMin(startISO, endISO) { return Math.round((parseLocal(endISO) - parseLocal(startISO)) / 60000); }
const DOW_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ───────────────────────────── RRULE subset ─────────────────────────────
   Supports FREQ=DAILY|WEEKLY|MONTHLY(by month day), INTERVAL, BYDAY (MO,TU…), UNTIL, COUNT. */
function parseRRule(str) {
  const r = { freq: 'WEEKLY', interval: 1, byday: null, until: null, count: null };
  if (!str) return r;
  for (const part of String(str).replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = part.split('=');
    if (!k || v === undefined) continue;
    switch (k.toUpperCase()) {
      case 'FREQ': r.freq = v.toUpperCase(); break;
      case 'INTERVAL': r.interval = Math.max(1, parseInt(v, 10) || 1); break;
      case 'BYDAY': r.byday = v.toUpperCase().split(',').map((x) => x.replace(/^[-+]?\d+/, '')).filter((x) => DOW_CODES.includes(x)); break;
      case 'UNTIL': { const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/); if (m) r.until = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59), +(m[6] || 59))) : new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59); break; }
      case 'COUNT': r.count = Math.max(1, parseInt(v, 10) || 1); break;
      default: break;
    }
  }
  return r;
}
function formatRRule(r) {
  const parts = [`FREQ=${r.freq || 'WEEKLY'}`];
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byday?.length) parts.push(`BYDAY=${r.byday.join(',')}`);
  if (r.until) parts.push(`UNTIL=${isoDate(r.until).replace(/-/g, '')}T235959`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  return parts.join(';');
}
function describeRRule(str) {
  if (!str) return 'Does not repeat';
  const r = parseRRule(str);
  const every = r.interval > 1 ? `every ${r.interval} ` : 'every ';
  let s;
  if (r.freq === 'DAILY') s = r.interval > 1 ? `${every}days` : 'daily';
  else if (r.freq === 'YEARLY') s = r.interval > 1 ? `${every}years` : 'yearly';
  else if (!['WEEKLY', 'MONTHLY'].includes(r.freq)) s = `${r.freq.toLowerCase()} (not supported — first occurrence only)`;
  else if (r.freq === 'MONTHLY') s = r.interval > 1 ? `${every}months` : 'monthly';
  else {
    const days = r.byday?.length ? r.byday.map((c) => DOW_LABELS[DOW_CODES.indexOf(c)]).join(', ') : '';
    s = r.interval === 2 ? `fortnightly${days ? ' on ' + days : ''}` : `${r.interval > 1 ? every + 'weeks' : 'weekly'}${days ? ' on ' + days : ''}`;
  }
  if (r.until) s += ` until ${fmtDateShort(r.until)}`;
  if (r.count) s += ` (${r.count} times)`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** Dates (local Date at the block's start time) on which a recurring block occurs within [from, to]. */
function recurrenceDates(block, from, to) {
  const r = parseRRule(block.recurrence);
  const start = parseLocal(block.startISO);
  const out = [];
  from = parseLocal(from); to = parseLocal(to);
  if (isNaN(start) || isNaN(from) || isNaN(to)) return out;
  const hardEnd = r.until && r.until < to ? r.until : to;
  const limitDate = addDays(start, 366 * 3); // safety cap: three years of expansion
  const stop = hardEnd < limitDate ? hardEnd : limitDate;
  let produced = 0;
  if (r.freq === 'DAILY') {
    const days = r.byday?.length ? new Set(r.byday.map((c) => DOW_CODES.indexOf(c))) : null;
    for (let d = new Date(start); d <= stop; d = addDays(d, r.interval)) {
      if (days && !days.has(d.getDay())) continue;
      produced++; if (r.count && produced > r.count) break;
      if (d >= from && d <= to) out.push(new Date(d));
    }
  } else if (r.freq === 'YEARLY') {
    for (let i = 0; ; i += r.interval) {
      const d = new Date(start); d.setFullYear(start.getFullYear() + i);
      if (d.getMonth() !== start.getMonth()) continue; // 29 Feb in a non-leap year
      if (d > stop) break;
      produced++; if (r.count && produced > r.count) break;
      if (d >= from && d <= to) out.push(d);
    }
  } else if (r.freq === 'MONTHLY') {
    for (let i = 0; ; i += r.interval) {
      const d = new Date(start); d.setMonth(start.getMonth() + i);
      if (d.getDate() !== start.getDate()) continue; // skip months without that day
      if (d > stop) break;
      produced++; if (r.count && produced > r.count) break;
      if (d >= from && d <= to) out.push(d);
    }
  } else if (r.freq !== 'WEEKLY') { // HOURLY/MINUTELY/unknown: not supported — show the first occurrence only
    if (start >= from && start <= to) out.push(new Date(start));
  } else {
    const days = r.byday?.length ? r.byday.map((c) => DOW_CODES.indexOf(c)) : [start.getDay()];
    const week0 = startOfWeek(start);
    for (let w = 0; ; w += r.interval) {
      const weekStart = addDays(week0, w * 7);
      if (weekStart > stop) break;
      for (const dow of [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
        const d = addDays(weekStart, (dow + 6) % 7);
        d.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        if (d < start) continue;
        if (d > stop) break;
        produced++; if (r.count && produced > r.count) { w = Infinity; break; }
        if (d >= from && d <= to) out.push(d);
      }
      if (w === Infinity) break;
    }
  }
  return out;
}
/** Expand blocks (some recurring) into concrete occurrences overlapping [from, to]. */
function expandOccurrences(blocks, from, to) {
  from = parseLocal(from); to = parseLocal(to);
  const out = [];
  const overridden = new Map(); // seriesId -> Set(dates)
  for (const b of blocks) if (b.overrideOfSeries && b.overrideInstanceDate) { if (!overridden.has(b.overrideOfSeries)) overridden.set(b.overrideOfSeries, new Set()); overridden.get(b.overrideOfSeries).add(b.overrideInstanceDate); }
  for (const b of blocks) {
    if (!b.startISO || !b.endISO || isNaN(parseLocal(b.startISO)) || isNaN(parseLocal(b.endISO))) continue;
    if (!b.recurrence) {
      const s = parseLocal(b.startISO), e = parseLocal(b.endISO);
      if (e >= from && s <= to) out.push({ block: b, isRecurrence: false, startISO: b.startISO, endISO: b.endISO, occurrenceDate: isoDate(s), id: `${b.id}@${isoDate(s)}` });
      continue;
    }
    const dur = durationMin(b.startISO, b.endISO);
    const ex = new Set(b.exdates || []);
    const ov = overridden.get(b.seriesId || b.id) || new Set();
    const winFrom = addMinutes(from, -dur - 1);
    for (const d of recurrenceDates(b, winFrom, to)) {
      const date = isoDate(d);
      if (ex.has(date) || ov.has(date)) continue;
      const startISO = isoDateTime(d), endISO = isoDateTime(addMinutes(d, dur));
      if (parseLocal(endISO) < from) continue;
      out.push({ block: b, isRecurrence: true, startISO, endISO, occurrenceDate: date, id: `${b.id}@${date}` });
    }
  }
  out.sort((a, b) => a.startISO.localeCompare(b.startISO));
  return out;
}
function overlaps(aStart, aEnd, bStart, bEnd) { return parseLocal(aStart) < parseLocal(bEnd) && parseLocal(bStart) < parseLocal(aEnd); }
/** Occurrences (excluding the given block) that overlap a candidate time range. */
function findConflicts(blocks, startISO, endISO, excludeId) {
  const occ = expandOccurrences(blocks.filter((b) => b.id !== excludeId && b.status !== 'cancelled'), startOfDay(startISO), endOfDay(endISO));
  return occ.filter((o) => overlaps(o.startISO, o.endISO, startISO, endISO));
}

/* ───────────────────────────── ICS ───────────────────────────── */
function parseIcs(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  const toLocal = (v, params) => {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    if (m[7]) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))); return { iso: isoDateTime(d), allDay: false }; }
    if (!m[4]) return { iso: `${m[1]}-${m[2]}-${m[3]}T00:00:00`, allDay: true };
    return { iso: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`, allDay: false };
  };
  for (const raw of lines) {
    if (raw === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (raw === 'END:VEVENT') { if (cur && cur.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = raw.indexOf(':'); if (idx < 0) continue;
    const head = raw.slice(0, idx), value = raw.slice(idx + 1);
    const [name, ...paramParts] = head.split(';');
    const params = Object.fromEntries(paramParts.map((p) => p.split('=')));
    const unesc = (s) => s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    switch (name.toUpperCase()) {
      case 'SUMMARY': cur.title = unesc(value); break;
      case 'DESCRIPTION': cur.notes = unesc(value); break;
      case 'LOCATION': cur.location = unesc(value); break;
      case 'UID': cur.uid = value; break;
      case 'DTSTART': cur.start = toLocal(value, params); break;
      case 'DTEND': cur.end = toLocal(value, params); break;
      case 'DURATION': { const m = value.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/); if (m) cur.durationMin = (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)); break; }
      case 'RRULE': cur.rrule = value; break;
      case 'RECURRENCE-ID': { const d = toLocal(value, params); if (d) cur.recurrenceId = d.iso.slice(0, 10); break; }
      case 'EXDATE': for (const v of value.split(',')) { const d = toLocal(v.trim(), params); if (d) cur.exdates.push(d.iso.slice(0, 10)); } break;
      case 'CATEGORIES': cur.categories = value; break;
      default: break;
    }
  }
  return events.map((e) => {
    let endISO = e.end?.iso;
    if (!endISO && e.durationMin) endISO = isoDateTime(addMinutes(e.start.iso, e.durationMin));
    if (!endISO) endISO = e.start.allDay ? isoDateTime(addMinutes(e.start.iso, 1439)) : isoDateTime(addMinutes(e.start.iso, 60));
    const t = (e.title || '').toLowerCase();
    const type = /meeting|briefing|staff/.test(t) ? 'meeting' : /duty|yard/.test(t) ? 'duty' : /\bpd\b|professional|training/.test(t) ? 'pd' : /prep|planning|free/.test(t) ? 'prep' : /class|year|yr|vce|period|\d{1,2}[a-z]{1,3}\b/.test(t) ? 'class' : 'custom';
    return { title: e.title || 'Event', startISO: e.start.iso, endISO, allDay: e.start.allDay, location: e.location || '', notes: e.notes || '', recurrence: e.rrule || undefined, exdates: e.exdates, uid: e.uid, recurrenceId: e.recurrenceId, type };
  });
}
function toIcsDate(iso) { return iso.replace(/[-:]/g, '').slice(0, 15); }
function buildIcs(blocks) {
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Teach Assist//Timetable//EN', 'CALSCALE:GREGORIAN'];
  for (const b of blocks) {
    if (!b.startISO || !b.endISO) continue;
    out.push('BEGIN:VEVENT', `UID:${b.id}@teach-assist`, `DTSTAMP:${toIcsDate(isoDateTime(new Date()))}`, `DTSTART:${toIcsDate(b.startISO)}`, `DTEND:${toIcsDate(b.endISO)}`, `SUMMARY:${esc(b.title)}`);
    if (b.location) out.push(`LOCATION:${esc(b.location)}`);
    if (b.notes) out.push(`DESCRIPTION:${esc(b.notes)}`);
    out.push(`CATEGORIES:${typeLabel(b.type)}`);
    if (b.recurrence) out.push(`RRULE:${b.recurrence.replace(/^RRULE:/i, '')}`);
    for (const d of b.exdates || []) out.push(`EXDATE:${d.replace(/-/g, '')}T${b.startISO.slice(11, 19).replace(/:/g, '')}`);
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}

/* ───────────────────────────── Block store helpers ───────────────────────────── */
async function allBlocks() { return store.all('blocks'); }
async function createBlock(data) {
  const b = { id: uid('blk'), title: 'Block', type: 'custom', exdates: [], artifactIds: [], status: 'scheduled', source: 'manual', createdAt: Date.now(), ...data };
  if (b.recurrence && !b.seriesId) b.seriesId = b.id;
  await store.put('blocks', b);
  return b;
}
async function updateBlock(id, patch) {
  const b = await store.get('blocks', id); if (!b) throw new Error('Block not found');
  Object.assign(b, patch, { updatedAt: Date.now() });
  if (b.recurrence && !b.seriesId) b.seriesId = b.id;
  await store.put('blocks', b);
  return b;
}
/** Change one occurrence of a series: add an exdate and create a standalone override block. */
async function overrideOccurrence(block, occurrenceDate, patch) {
  const ex = new Set(block.exdates || []); ex.add(occurrenceDate);
  await store.put('blocks', { ...block, exdates: [...ex], updatedAt: Date.now() });
  const dur = durationMin(block.startISO, block.endISO);
  const startISO = patch.startISO || `${occurrenceDate}T${block.startISO.slice(11)}`;
  const endISO = patch.endISO || isoDateTime(addMinutes(startISO, dur));
  const { recurrence, seriesId, exdates, id, sessionId, lastSessionId, createdAt, updatedAt, icsUid, ...rest } = block;
  return createBlock({ ...rest, ...patch, startISO, endISO, recurrence: undefined, seriesId: undefined, exdates: [], overrideOfSeries: block.seriesId || block.id, overrideInstanceDate: occurrenceDate, source: block.source });
}
async function skipOccurrence(block, occurrenceDate) {
  const ex = new Set(block.exdates || []); ex.add(occurrenceDate);
  await store.put('blocks', { ...block, exdates: [...ex], updatedAt: Date.now() });
}
async function deleteBlock(id) {
  const b = await store.get('blocks', id); if (!b) return;
  // Remove overrides that hang off this series too.
  const all = await allBlocks();
  for (const o of all) if (o.overrideOfSeries && o.overrideOfSeries === (b.seriesId || b.id)) await store.del('blocks', o.id);
  await store.del('blocks', id);
  if (b.taskId) await reconcileTaskStatus(b.taskId);
}
/** A task is "scheduled" while at least one block is work time for it; otherwise back to the inbox. */
async function reconcileTaskStatus(taskId) {
  const t = await store.get('tasks', taskId); if (!t || t.status === 'done') return;
  const linked = (await allBlocks()).some((b) => b.taskId === taskId);
  const want = linked ? 'scheduled' : 'inbox';
  if (t.status !== want) { t.status = want; t.updatedAt = Date.now(); await store.put('tasks', t); }
}
