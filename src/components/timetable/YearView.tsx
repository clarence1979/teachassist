import { clsx } from 'clsx';
import type { SchoolCalendarEntry } from '../../db/schema';
import type { BlockOccurrence } from '../../lib/timetable/recurrence';
import { startOfYear, addDays, isoDate, isToday, parseLocal, minutesBetween } from '../../lib/timetable/dates';
import { isHoliday, termFor } from '../../lib/timetable/schoolCalendar';

interface YearViewProps {
  year: number;
  occurrences: BlockOccurrence[];
  calendar: SchoolCalendarEntry[];
  onDayClick: (day: Date) => void;
  mode: 'year' | 'term';
  termFilter?: SchoolCalendarEntry | null;
}

export function YearView({ year, occurrences, calendar, onDayClick, mode, termFilter }: YearViewProps) {
  // Build 53-week grid starting Monday of first week containing Jan 1.
  const jan1 = startOfYear(new Date(year, 0, 1));
  const firstDay = jan1.getDay();
  const offsetToMon = (firstDay + 6) % 7;
  const gridStart = addDays(jan1, -offsetToMon);

  const minutesByDay = new Map<string, number>();
  for (const o of occurrences) {
    const k = isoDate(parseLocal(o.startISO));
    const mins = minutesBetween(parseLocal(o.startISO), parseLocal(o.endISO));
    minutesByDay.set(k, (minutesByDay.get(k) ?? 0) + mins);
  }

  const maxMinutes = Math.max(...[...minutesByDay.values(), 60]);

  const weeks = mode === 'year' ? 53 : 16;
  const startOffset = mode === 'term' && termFilter
    ? Math.max(0, Math.floor((new Date(termFilter.startISO).getTime() - gridStart.getTime()) / (7 * 86400000)))
    : 0;

  const monthLabels: Array<{ week: number; label: string }> = [];
  {
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const d = addDays(gridStart, (w + startOffset) * 7);
      if (d.getMonth() !== lastMonth) {
        monthLabels.push({ week: w, label: d.toLocaleDateString('en-AU', { month: 'short' }) });
        lastMonth = d.getMonth();
      }
    }
  }

  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function heatColor(minutes: number): string {
    if (minutes === 0) return 'rgba(30,58,95,0.2)';
    const ratio = Math.min(1, minutes / maxMinutes);
    const alpha = 0.15 + ratio * 0.8;
    return `rgba(34, 211, 238, ${alpha})`;
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-orbitron text-sm font-bold text-text-primary tracking-wide">
          {mode === 'year' ? `YEAR ${year}` : termFilter?.label ?? 'TERM'} — density heatmap
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-text-dim">Low</span>
          <div className="flex gap-0.5">
            {[0.15, 0.35, 0.55, 0.75, 0.95].map((a) => (
              <div key={a} className="w-3 h-3 rounded-sm" style={{ background: `rgba(34,211,238,${a})` }} />
            ))}
          </div>
          <span className="text-[10px] font-mono text-text-dim">High</span>
        </div>
      </div>

      <div className="inline-block">
        {/* Month labels */}
        <div className="grid" style={{ gridTemplateColumns: `24px repeat(${weeks}, 16px)`, gap: 2 }}>
          <div />
          {Array.from({ length: weeks }, (_, w) => {
            const l = monthLabels.find((ml) => ml.week === w);
            return (
              <div key={w} className="text-[9px] font-mono text-text-dim h-4 leading-4">{l?.label ?? ''}</div>
            );
          })}
        </div>

        {/* Rows */}
        {days.map((dLabel, dow) => (
          <div key={dow} className="grid" style={{ gridTemplateColumns: `24px repeat(${weeks}, 16px)`, gap: 2, marginTop: 2 }}>
            <div className="text-[9px] font-mono text-text-dim flex items-center">{dLabel}</div>
            {Array.from({ length: weeks }, (_, w) => {
              const cellDate = addDays(gridStart, (w + startOffset) * 7 + dow);
              const inYear = cellDate.getFullYear() === year;
              const iso = isoDate(cellDate);
              const mins = minutesByDay.get(iso) ?? 0;
              const h = isHoliday(iso, calendar);
              const term = termFor(iso, calendar);
              return (
                <button
                  key={w}
                  onClick={() => onDayClick(cellDate)}
                  className={clsx(
                    'w-4 h-4 rounded-sm transition-all hover:scale-125 hover:z-10 relative',
                    !inYear && 'opacity-30',
                    isToday(cellDate) && 'ring-1 ring-accent-amber',
                  )}
                  style={{ background: h ? 'rgba(239,68,68,0.25)' : heatColor(mins) }}
                  title={`${iso}${term ? ` · ${term.label}` : ''}${h ? ` · ${h.label}` : ''}\n${Math.round(mins)} min scheduled`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
