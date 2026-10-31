import type { BlockOccurrence } from './recurrence';
import { parseLocal } from './dates';

export type ConflictMap = Map<string, string[]>;

/**
 * Detect overlapping occurrences. Returns a Map whose key is a unique occurrence key
 * (block id + occurrence date) and value is the array of conflicting keys.
 */
export function detectConflicts(occurrences: BlockOccurrence[]): ConflictMap {
  const map: ConflictMap = new Map();
  if (occurrences.length < 2) return map;

  const sorted = [...occurrences].sort((a, b) => parseLocal(a.startISO).getTime() - parseLocal(b.startISO).getTime());

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const aStart = parseLocal(a.startISO).getTime();
    const aEnd = parseLocal(a.endISO).getTime();
    const aKey = occKey(a);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const bStart = parseLocal(b.startISO).getTime();
      if (bStart >= aEnd) break; // sorted — no further overlaps possible
      const bEnd = parseLocal(b.endISO).getTime();
      if (bStart < aEnd && bEnd > aStart) {
        const bKey = occKey(b);
        if (!map.has(aKey)) map.set(aKey, []);
        if (!map.has(bKey)) map.set(bKey, []);
        map.get(aKey)!.push(bKey);
        map.get(bKey)!.push(aKey);
      }
    }
  }
  return map;
}

export function occKey(o: BlockOccurrence): string {
  return `${o.block.id}__${o.occurrenceDate}`;
}
