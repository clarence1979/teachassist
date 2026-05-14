import type { SchoolCalendarEntry } from '../../db/schema';

/** Australian / Victorian defaults for the coming year. Values are approximate
 *  DEECD defaults; users can edit any entry. */

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Victorian school term dates — approximation for the current year. Editable at runtime. */
export function defaultVictorianTerms(year: number): SchoolCalendarEntry[] {
  // Rough Victorian public-school terms: edit in UI if needed.
  const ranges: Array<[string, string, string]> = [
    [`${year}-01-28`, `${year}-04-04`, `Term 1 ${year}`],
    [`${year}-04-22`, `${year}-07-04`, `Term 2 ${year}`],
    [`${year}-07-21`, `${year}-09-19`, `Term 3 ${year}`],
    [`${year}-10-06`, `${year}-12-19`, `Term 4 ${year}`],
  ];
  return ranges.map(([s, e, label]) => ({
    id: uid('term'), label, startISO: s, endISO: e, type: 'term',
  }));
}

/** Victorian public holidays — editable. Year-parameterised. */
export function defaultVictorianHolidays(year: number): SchoolCalendarEntry[] {
  const list: Array<[string, string]> = [
    [`${year}-01-01`, "New Year's Day"],
    [`${year}-01-27`, 'Australia Day (observed)'],
    [`${year}-03-10`, 'Labour Day'],
    [`${year}-04-18`, 'Good Friday'],
    [`${year}-04-19`, 'Saturday before Easter'],
    [`${year}-04-20`, 'Easter Sunday'],
    [`${year}-04-21`, 'Easter Monday'],
    [`${year}-04-25`, 'ANZAC Day'],
    [`${year}-06-09`, "King's Birthday"],
    [`${year}-09-26`, 'AFL Grand Final Friday'],
    [`${year}-11-04`, 'Melbourne Cup Day'],
    [`${year}-12-25`, 'Christmas Day'],
    [`${year}-12-26`, 'Boxing Day'],
  ];
  return list.map(([iso, label]) => ({
    id: uid('hol'), label, startISO: iso, endISO: iso, type: 'holiday',
  }));
}

export function defaultCalendarFor(year: number): SchoolCalendarEntry[] {
  return [...defaultVictorianTerms(year), ...defaultVictorianHolidays(year)];
}

/** Is a given date inside a holiday entry? */
export function isHoliday(dateISO: string, entries: SchoolCalendarEntry[]): SchoolCalendarEntry | null {
  for (const e of entries) {
    if (e.type !== 'holiday' && e.type !== 'pupil_free') continue;
    if (dateISO >= e.startISO && dateISO <= e.endISO) return e;
  }
  return null;
}

/** Return the term entry containing this date, or null. */
export function termFor(dateISO: string, entries: SchoolCalendarEntry[]): SchoolCalendarEntry | null {
  for (const e of entries) {
    if (e.type !== 'term') continue;
    if (dateISO >= e.startISO && dateISO <= e.endISO) return e;
  }
  return null;
}
