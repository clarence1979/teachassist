import { useState } from 'react';
import {
  Presentation, FileText, ClipboardList, NotebookPen,
  HelpCircle, Target, Image as ImageIcon, Wand2,
  ArrowRight, Lock, GraduationCap, LayoutGrid, Layers,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { SlideGeneratorModal } from '../components/studio/SlideGeneratorModal';
import { WorksheetGeneratorModal } from '../components/studio/WorksheetGeneratorModal';
import { DocumentGeneratorModal } from '../components/studio/DocumentGeneratorModal';
import { NotesGeneratorModal } from '../components/studio/NotesGeneratorModal';
import { QuizGeneratorModal } from '../components/studio/QuizGeneratorModal';
import { RubricGeneratorModal } from '../components/studio/RubricGeneratorModal';
import { ImageGeneratorModal } from '../components/studio/ImageGeneratorModal';
import { InfographicGeneratorModal } from '../components/studio/InfographicGeneratorModal';
import { PosterGeneratorModal } from '../components/studio/PosterGeneratorModal';
import type { DocumentType, StructuredDocument } from '../lib/studio/documentSchema';

type ArtifactKey =
  | 'slides' | 'pdf' | 'worksheet' | 'notes' | 'quiz' | 'rubric' | 'image' | 'lesson_plan' | 'infographic' | 'poster';

interface ArtifactCard {
  key: ArtifactKey;
  icon: LucideIcon;
  title: string;
  description: string;
  accent: 'cyan' | 'green' | 'amber';
  active: boolean;
  badge?: string;
}

const ARTIFACTS: ArtifactCard[] = [
  {
    key: 'slides',
    icon: Presentation,
    title: 'Slide Deck',
    description: 'Themed .pptx with title slides, bullets, speaker notes. Optional AI images.',
    accent: 'cyan', active: true,
  },
  {
    key: 'lesson_plan',
    icon: GraduationCap,
    title: 'Lesson Plan',
    description: '5E, Gagne, or Direct Instruction. One-click follow-ups to slides, worksheets, notes, quiz.',
    accent: 'amber', active: true,
  },
  {
    key: 'worksheet',
    icon: ClipboardList,
    title: 'Worksheet',
    description: 'Diffit-style: 10 question types, Below/On/Above/Extension tiers in one pass.',
    accent: 'green', active: true,
  },
  {
    key: 'quiz',
    icon: HelpCircle,
    title: 'Quiz / Test',
    description: '9 question types, point values, time limit, interactive HTML auto-grading + CSV export.',
    accent: 'cyan', active: true,
  },
  {
    key: 'notes',
    icon: NotebookPen,
    title: 'Student Notes',
    description: 'Structured notes with glossary, worked examples, self-check. PDF · DOCX · Markdown · HTML reader.',
    accent: 'amber', active: true,
  },
  {
    key: 'rubric',
    icon: Target,
    title: 'Rubric',
    description: 'Analytic, holistic, or single-point. Auto-fills criteria from objectives. A4 landscape PDF.',
    accent: 'green', active: true,
  },
  {
    key: 'pdf',
    icon: FileText,
    title: 'Document',
    description: 'Handouts, cheat sheets, parent letters, report comments, IEP notes. PDF + DOCX.',
    accent: 'amber', active: true,
  },
  {
    key: 'image',
    icon: ImageIcon,
    title: 'AI Image',
    description: 'gpt-image-1 posters, diagrams, slide imagery. Edit prompt and regenerate. Saved to Library.',
    accent: 'cyan', active: true,
    badge: 'OpenAI',
  },
  {
    key: 'infographic',
    icon: LayoutGrid,
    title: 'Infographic',
    description: 'NotebookLM-style single-page infographic. Portrait, landscape or square. Brief, standard or detailed.',
    accent: 'green', active: true,
    badge: 'NEW',
  },
  {
    key: 'poster',
    icon: Layers,
    title: 'Poster',
    description: 'Campaign-quality advertising and creative posters. Upload a hero photo to be placed in the scene.',
    accent: 'amber', active: true,
    badge: 'GPT-2',
  },
];

const AC = {
  cyan: { text: 'text-accent-cyan', border: 'hover:border-accent-cyan', bg: 'bg-accent-cyan/10', rail: 'bg-accent-cyan' },
  green: { text: 'text-accent-green', border: 'hover:border-accent-green', bg: 'bg-accent-green/10', rail: 'bg-accent-green' },
  amber: { text: 'text-accent-amber', border: 'hover:border-accent-amber', bg: 'bg-accent-amber/10', rail: 'bg-accent-amber' },
};

interface FollowUpSeed {
  topic?: string;
  yearLevel?: string;
  objectives?: string[];
  kind: ArtifactKey;
}

export function StudioView() {
  const [open, setOpen] = useState<ArtifactKey | null>(null);
  const [docSeed, setDocSeed] = useState<{ topic?: string; yearLevel?: string; documentType?: DocumentType } | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpSeed | null>(null);

  const close = () => { setOpen(null); setDocSeed(null); setFollowUp(null); };

  const openCard = (key: ArtifactKey) => {
    if (key === 'lesson_plan') setDocSeed({ documentType: 'lesson_plan_5e' });
    else if (key === 'pdf') setDocSeed({ documentType: 'handout' });
    setOpen(key);
  };

  const handleFollowUp = (kind: 'slides' | 'worksheet' | 'notes' | 'quiz', doc: StructuredDocument) => {
    const seed: FollowUpSeed = { topic: doc.meta.topic || doc.title, yearLevel: doc.meta.yearLevel, kind: kind as ArtifactKey };
    setFollowUp(seed);
    setOpen(null);
    setTimeout(() => setOpen(kind as ArtifactKey), 50);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto grid-bg">
      <div className="max-w-6xl mx-auto p-6 lg:p-10">
        {/* Header */}
        <div className="flex items-start gap-4 mb-8">
          <div className="p-3 rounded-btn bg-bg-elevated border border-border">
            <Wand2 size={24} className="text-accent-cyan" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-orbitron text-2xl font-bold text-text-primary tracking-wide">STUDIO</h1>
              <span className="font-mono text-[10px] text-text-dim tracking-widest px-2 py-0.5 border border-border rounded">ARTIFACT FORGE</span>
            </div>
            <p className="text-text-secondary text-sm mt-1 font-inter max-w-2xl">
              Generate structured classroom artifacts. Every output is saved to your Library with metadata and full structured data.
            </p>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {ARTIFACTS.map((a) => {
            const Icon = a.icon;
            const colors = AC[a.accent];
            return (
              <button
                key={a.key}
                onClick={() => a.active && openCard(a.key)}
                disabled={!a.active}
                className={clsx(
                  'group relative text-left p-4 rounded-lg border border-border bg-bg-panel transition-all overflow-hidden',
                  a.active ? clsx('cursor-pointer', colors.border, 'hover:bg-bg-elevated hover:-translate-y-0.5 hover:shadow-lg') : 'opacity-50 cursor-not-allowed',
                )}
              >
                {a.active && <div className={clsx('absolute top-0 right-0 w-14 h-0.5', colors.rail)} />}
                <div className="flex items-start justify-between mb-3">
                  <div className={clsx('p-2 rounded-btn border border-border', a.active ? colors.bg : 'bg-bg-elevated')}>
                    <Icon size={18} className={a.active ? colors.text : 'text-text-dim'} />
                  </div>
                  <div className="flex items-center gap-1">
                    {a.badge && <span className="text-[8px] font-mono px-1.5 py-0.5 border border-border rounded text-text-dim">{a.badge}</span>}
                    {!a.active && <span className="text-[9px] font-mono text-text-dim px-1.5 py-0.5 border border-border rounded flex items-center gap-0.5"><Lock size={9} />SOON</span>}
                    {a.active && <ArrowRight size={14} className="text-text-dim group-hover:text-accent-cyan group-hover:translate-x-0.5 transition-all" />}
                  </div>
                </div>
                <h3 className="font-rajdhani font-bold text-base text-text-primary leading-tight mb-1">{a.title}</h3>
                <p className="text-[11px] text-text-secondary leading-relaxed">{a.description}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-10 flex items-center gap-2 font-mono text-[10px] text-text-dim tracking-widest">
          <div className="h-px flex-1 bg-border" />
          <span>ALL ARTIFACTS SAVED TO LIBRARY · PDF · DOCX · JSON</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      </div>

      {/* Modals */}
      {open === 'slides' && (
        <SlideGeneratorModal
          key={followUp?.topic ?? 'slides'}
          onClose={close}
        />
      )}
      {open === 'worksheet' && (
        <WorksheetGeneratorModal
          key={followUp?.topic ?? 'ws'}
          onClose={close}
        />
      )}
      {(open === 'pdf') && (
        <DocumentGeneratorModal key="doc" onClose={close} seed={docSeed ?? undefined} />
      )}
      {open === 'lesson_plan' && (
        <DocumentGeneratorModal
          key="lp"
          onClose={close}
          seed={docSeed ?? undefined}
          enableFollowUps
          onFollowUp={handleFollowUp}
        />
      )}
      {open === 'notes' && (
        <NotesGeneratorModal
          key={followUp?.topic ?? 'notes'}
          onClose={close}
          seed={followUp ? { topic: followUp.topic, yearLevel: followUp.yearLevel } : undefined}
        />
      )}
      {open === 'quiz' && (
        <QuizGeneratorModal
          key={followUp?.topic ?? 'quiz'}
          onClose={close}
          seed={followUp ? { topic: followUp.topic, yearLevel: followUp.yearLevel } : undefined}
        />
      )}
      {open === 'rubric' && (
        <RubricGeneratorModal
          key={followUp?.topic ?? 'rubric'}
          onClose={close}
          seed={followUp ? { topic: followUp.topic, yearLevel: followUp.yearLevel, objectives: followUp.objectives } : undefined}
        />
      )}
      {open === 'image' && (
        <ImageGeneratorModal onClose={close} />
      )}
      {open === 'poster' && (
        <PosterGeneratorModal onClose={close} />
      )}
      {open === 'infographic' && (
        <InfographicGeneratorModal
          key={followUp?.topic ?? 'info'}
          onClose={close}
          seed={followUp ? { topic: followUp.topic, yearLevel: followUp.yearLevel } : undefined}
        />
      )}
    </div>
  );
}
