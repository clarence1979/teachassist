import type { BlockType } from '../../db/schema';

export const BLOCK_TYPES: Array<{ value: BlockType; label: string; color: string }> = [
  { value: 'class',    label: 'Class',    color: '#22d3ee' },
  { value: 'prep',     label: 'Prep',     color: '#22c55e' },
  { value: 'meeting',  label: 'Meeting',  color: '#f59e0b' },
  { value: 'duty',     label: 'Duty',     color: '#ef4444' },
  { value: 'pd',       label: 'PD',       color: '#2563eb' },
  { value: 'personal', label: 'Personal', color: '#64748b' },
  { value: 'custom',   label: 'Custom',   color: '#06b6d4' },
];

export function typeColor(t: BlockType, custom?: string): string {
  if (t === 'custom' && custom) return custom;
  return BLOCK_TYPES.find((x) => x.value === t)?.color ?? '#64748b';
}
