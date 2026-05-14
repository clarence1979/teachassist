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
  prompt: string;
  icon: LucideIcon;
}

const PROMPTS: Prompt[] = [
  { label: 'Generate a worksheet…', prompt: 'Generate a worksheet on ', icon: FileText },
  { label: 'Make slides for…', prompt: 'Make slides for ', icon: Presentation },
  { label: 'Write student notes on…', prompt: 'Write student notes on ', icon: NotebookPen },
  { label: 'Create a quiz on…', prompt: 'Create a quiz on ', icon: HelpCircle },
  { label: 'Build a rubric for…', prompt: 'Build a rubric for ', icon: ClipboardCheck },
  { label: 'Differentiate this lesson…', prompt: 'Differentiate this lesson so it works for ', icon: GitCompare },
  { label: 'Plan my week…', prompt: 'Plan my week based on my current timetable and task list.', icon: CalendarDays },
  { label: 'Import my school timetable…', prompt: 'I\'ll upload a screenshot of my school timetable — please parse it and create the blocks.', icon: ImageDown },
];

interface Props {
  onPick: (prompt: string) => void;
}

export function QuickPrompts({ onPick }: Props) {
  return (
    <div className="px-4 pt-2 pb-3 border-t border-border bg-bg-panel">
      <div className="flex gap-2 overflow-x-auto scrollbar-thin">
        {PROMPTS.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.label}
              onClick={() => onPick(p.prompt)}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-bg-elevated border border-border rounded-btn text-xs font-rajdhani font-semibold text-text-secondary hover:border-accent-cyan hover:text-accent-cyan transition-colors"
            >
              <Icon size={11} className="shrink-0" />
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
