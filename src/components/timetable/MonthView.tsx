import { clsx } from 'clsx';
import type { SchoolCalendarEntry } from '../../db/schema';
import type { BlockOccurrence } from '../../lib/timetable/recurrence';
import { startOfMonth, endOfMonth, startOfWeek, addDays, isoDate, isToday, parseLocal, fmtTime } from '../../lib/timetable/dates';
import { isHoliday, termFor } from '../../lib/timetable/schoolCalendar';
import { typeColor } from './blockTypes';

interface MonthViewProps {
  focusDate: Date;
  occurrences: BlockOccurrence[];
  calendar: SchoolCalendarEntry[];
  onDayClick: (day: Date) => void;
  onOccClick: (occ: BlockOccurrence) => void;
}

export function MonthView({ focusDate, occurrences, calendar, onDayClick, onOccClick }: MonthViewProps) {
  const mStart = startOfMonth(focusDate);
  const mEnd = endOfMonth(focusDate);
  const gridStart = startOfWeek(mStart);

  const days: Date[] = [];
  for (let d = new Date(gridStart); d <= mEnd || days.length % 7 !== 0; d = addDays(d, 1)) {
    days.push(new Date(d));
    if (days.length > 42) break;
  }

  const byDay = new Map<string, BlockOccurrence[]>();
  for (const o of occurrences) {
    const k = isoDate(parseLocal(o.startISO));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(o);
  }

  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-auto">
      <div className="grid grid-cols-7 border-b border-border bg-bg-elevated sticky top-0 z-10">
        {weekdays.map((w) => (
          <div key={w} className="px-2 py-2 text-[10px] font-rajdhani font-bold uppercase tracking-wider text-text-secondary text-center border-r border-border last:border-r-0">{w}</div>
        ))}
      </div>
      <div className="flex-1 grid grid-cols-7 auto-rows-fr min-h-0">
        {days.map((day) => {
          const dateISO = isoDate(day);
          const inMonth = day.getMonth() === focusDate.getMonth();
          const items = byDay.get(dateISO) ?? [];
          const holiday = isHoliday(dateISO, calendar);
          const term = termFor(dateISO, calendar);

          return (
            <div
              key={dateISO}
              className={clsx(
                'border-r border-b border-border p-1.5 min-h-[96px] flex flex-col gap-1 cursor-pointer transition-colors hover:bg-bg-elevated/50 relative',
                !inMonth && 'bg-bg-base/50 opacity-60',
                holiday && 'bg-red-500/5',
              )}
              onClick={() => onDayClick(day)}
            >
              <div className="flex items-center justify-between">
                <span className={clsx(
                  'text-xs font-rajdhani font-bold',
                  isToday(day) ? 'w-5 h-5 rounded-full bg-accent-amber text-bg-base flex items-center justify-center' : 'text-text-primary',
                )}>
                  {day.getDate()}
                </span>
                {term && <span className="text-[8px] font-mono text-text-dim uppercase">{term.label.split(' ')[0]}{term.label.split(' ')[1]}</span>}
              </div>
              {holiday && (
                <div className="text-[8px] font-mono text-red-400 uppercase truncate" title={holiday.label}>{holiday.label}</div>
              )}
              <div className="flex-1 flex flex-col gap-0.5 min-h-0 overflow-hidden">
                {items.slice(0, 4).map((o, i) => {
                  const color = typeColor(o.block.type, o.block.color);
                  return (
                    <button
                      key={i}
                      onClick={(e) => { e.stopPropagation(); onOccClick(o); }}
                      className="text-left text-[9px] font-mono truncate px-1 py-0.5 rounded hover:brightness-125 transition-all"
                      style={{ background: `${color}22`, color, borderLeft: `2px solid ${color}` }}
                      title={`${o.block.title} · ${fmtTime(o.startISO)}`}
                    >
                      {fmtTime(o.startISO)} {o.block.title}
                    </button>
                  );
                })}
                {items.length > 4 && (
                  <span className="text-[9px] font-mono text-text-dim">+{items.length - 4} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
