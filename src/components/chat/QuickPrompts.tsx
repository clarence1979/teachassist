import {
  FileText,
  Presentation,
  NotebookPen,
  HelpCircle,
  ClipboardCheck,
  GitCompare,
  CalendarDays,
  ImageDown,
  type LucideIcon,
} from 'lucide-react';

interface Prompt {
  label: string;
  shortLabel: string;
  prompt: string;
  icon: LucideIcon;
}

const PROMPTS: Prompt[] = [
  { label: 'Generate a worksheet…', shortLabel: 'Worksheet', prompt: 'Generate a worksheet on ', icon: FileText },
  { label: 'Make slides for…', shortLabel: 'Slides', prompt: 'Make slides for ', icon: Presentation },
  { label: 'Write student notes on…', shortLabel: 'Notes', prompt: 'Write student notes on ', icon: NotebookPen },
  { label: 'Create a quiz on…', shortLabel: 'Quiz', prompt: 'Create a quiz on ', icon: HelpCircle },
  { label: 'Build a rubric for…', shortLabel: 'Rubric', prompt: 'Build a rubric for ', icon: ClipboardCheck },
  { label: 'Differentiate this lesson…', shortLabel: 'Differentiate', prompt: 'Differentiate this lesson so it works for ', icon: GitCompare },
  { label: 'Plan my week…', shortLabel: 'Plan week', prompt: 'Plan my week based on my current timetable and task list.', icon: CalendarDays },
  { label: 'Import my school timetable…', shortLabel: 'Import', prompt: 'I\'ll upload a screenshot of my school timetable — please parse it and create the blocks.', icon: ImageDown },
];

interface Props {
  onPick: (prompt: string) => void;
  compact?: boolean;
}

export function QuickPrompts({ onPick, compact = false }: Props) {
  return (
    <div className={compact ? 'px-2 pt-1.5 pb-2 border-t border-border bg-bg-panel' : 'px-4 pt-2 pb-3 border-t border-border bg-bg-panel'}>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-thin pb-0.5" style={{ WebkitOverflowScrolling: 'touch' }}>
        {PROMPTS.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.label}
              onClick={() => onPick(p.prompt)}
              className={
                compact
                  ? 'shrink-0 flex items-center gap-1 px-2 py-1 bg-bg-elevated border border-border rounded-btn text-[10px] font-rajdhani font-semibold text-text-secondary hover:border-accent-cyan hover:text-accent-cyan active:text-accent-cyan transition-colors'
                  : 'shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-bg-elevated border border-border rounded-btn text-xs font-rajdhani font-semibold text-text-secondary hover:border-accent-cyan hover:text-accent-cyan transition-colors'
              }
            >
              <Icon size={compact ? 10 : 11} className="shrink-0" />
              <span>{compact ? p.shortLabel : p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
