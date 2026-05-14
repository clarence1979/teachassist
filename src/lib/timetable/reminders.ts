import type { TimetableBlock } from '../../db/schema';
import { expandOccurrences } from './recurrence';

const scheduled = new Map<string, number>();

export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

function fire(title: string, body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, tag: `reminder-${title}-${body}` });
  } catch (e) {
    console.warn('[reminders] notification failed', e);
  }
}

export function clearAllReminders() {
  for (const id of scheduled.values()) clearTimeout(id);
  scheduled.clear();
}

/**
 * Schedule reminder notifications for every occurrence in the next `lookaheadMs` window.
 * Call this on mount and after any block change.
 */
export function rescheduleReminders(blocks: TimetableBlock[], lookaheadMs = 24 * 60 * 60 * 1000) {
  clearAllReminders();
  if (typeof window === 'undefined') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = Date.now();
  const until = new Date(now + lookaheadMs);
  const occs = expandOccurrences(blocks, new Date(now), until);

  for (const occ of occs) {
    const offset = occ.block.reminderOffsetMin;
    if (typeof offset !== 'number' || offset < 0) continue;
    const startMs = new Date(occ.startISO).getTime();
    const fireAt = startMs - offset * 60000;
    const delay = fireAt - now;
    if (delay <= 0 || delay > lookaheadMs) continue;
    const key = `${occ.block.id}_${occ.startISO}`;
    const when = new Date(startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const tid = window.setTimeout(() => {
      fire(
        occ.block.title,
        offset === 0 ? `Starting now (${when})` : `Starts in ${offset} min (${when})${occ.block.location ? ' · ' + occ.block.location : ''}`,
      );
      scheduled.delete(key);
    }, delay);
    scheduled.set(key, tid);
  }
}

export const REMINDER_OPTIONS: Array<{ value: number | undefined; label: string }> = [
  { value: undefined, label: 'No reminder' },
  { value: 0, label: 'At start time' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 24 * 60, label: '1 day before' },
];
