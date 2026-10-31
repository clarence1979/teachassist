/** Date helpers for the timetable — works with local time zones. */

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000);
}

/** Start of week (Monday) */
export function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  r.setDate(r.getDate() - ((day + 6) % 7));
  r.setHours(0, 0, 0, 0);
  return r;
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

export function isoDate(d: Date): string {
  // YYYY-MM-DD in local time
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

export function isoDateTime(d: Date): string {
  // Local ISO without timezone, e.g. 2024-05-01T09:30:00
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${da}T${hh}:${mm}:00`;
}

export function parseLocal(iso: string): Date {
  // Force local interpretation by parsing components manually.
  // new Date('YYYY-MM-DDTHH:mm:ss') is treated as UTC in some browsers
  // when there's no timezone suffix, causing offset bugs.
  const [datePart, timePart] = iso.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  if (!timePart) return new Date(y, m - 1, d);
  const [hh, mm, ss] = timePart.replace('Z', '').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isToday(d: Date): boolean {
  return sameDay(d, new Date());
}

export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

/** Snap to 15-minute increments */
export function snap15(d: Date): Date {
  const r = new Date(d);
  const min = r.getMinutes();
  const snapped = Math.round(min / 15) * 15;
  r.setMinutes(snapped, 0, 0);
  return r;
}

/** Get week number (ISO 8601) for the given date */
export function weekNumber(d: Date): number {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const jan4 = new Date(target.getFullYear(), 0, 4);
  const dayDiff = (target.getTime() - jan4.getTime()) / 86400000;
  return 1 + Math.round((dayDiff - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

export function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtDayShort(d: Date): string {
  return d.toLocaleDateString('en-AU', { weekday: 'short' });
}

export function fmtTime(iso: string): string {
  const d = parseLocal(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtMonthLabel(d: Date): string {
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}
