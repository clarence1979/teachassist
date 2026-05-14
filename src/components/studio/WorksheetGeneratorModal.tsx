import { useState } from 'react';
import {
  X, Loader2, Sparkles, AlertCircle, CheckCircle2,
  FileText, FileType2, PlayCircle, Download, BookOpen,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../../contexts/CredentialsContext';
import { useAppStore } from '../../store/appStore';
import { useDb } from '../../db/DbContext';
import { artifactsRepo } from '../../db/repos';
import { complete } from '../../lib/llm';
import {
  buildWorksheetPrompt, parseWorksheetJson,
  QTYPE_LABELS, TIER_LABELS, BLOOM_LABELS,
  type Worksheet, type WorksheetRequest,
  type QuestionType, type DifficultyTier, type BloomLevel,
} from '../../lib/studio/worksheetSchema';
import { buildWorksheetPdf, downloadBase64Pdf } from '../../lib/studio/pdfRenderer';
import { buildWorksheetDocx, downloadBase64Docx } from '../../lib/studio/docxBuilder';
import { InteractiveWorksheet } from './InteractiveWorksheet';

type Stage = 'form' | 'generating' | 'preview' | 'error';
type Tab = 'interactive' | 'print';

interface Props {
  onClose: () => void;
}

const YEAR_LEVELS = [
  'Prep', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6',
  'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11', 'Year 12',
];

const ALL_QTYPES: QuestionType[] = [
  'multiple_choice', 'true_false', 'short_answer', 'long_answer',
  'fill_blank', 'matching', 'ordering', 'label_diagram',
  'code_trace', 'worked_example',
];

const ALL_TIERS: DifficultyTier[] = ['below', 'on', 'above', 'extension'];
const ALL_BLOOM: BloomLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

export function WorksheetGeneratorModal({ onClose }: Props) {
  const { getKey } = useCredentials();
  const { activeProvider, activeModel, notifyArtifactGenerated } = useAppStore();
  const db = useDb();

  // ─── Form state ─────────────────────────────────────────────────────────
  const [topic, setTopic] = useState('');
  const [yearLevel, setYearLevel] = useState('Year 9');
  const [curriculumStandard, setCurriculumStandard] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>([
    'multiple_choice', 'true_false', 'short_answer', 'fill_blank',
  ]);
  const [questionsPerTier, setQuestionsPerTier] = useState(6);
  const [selectedTiers, setSelectedTiers] = useState<DifficultyTier[]>(['below', 'on', 'above']);
  const [bloom, setBloom] = useState<BloomLevel | ''>('');
  const [estimatedTimeMin, setEstimatedTimeMin] = useState<number | ''>(30);
  const [includeAnswerKey, setIncludeAnswerKey] = useState(true);
  const [notes, setNotes] = useState('');

  const [state, setState] = useState<{ stage: Stage; step?: string; error?: string }>({ stage: 'form' });
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  const [pdfB64, setPdfB64] = useState<string | null>(null);
  const [docxB64, setDocxB64] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('interactive');
  const [saved, setSaved] = useState(false);

  const toggleType = (t: QuestionType) =>
    setSelectedTypes((arr) => arr.includes(t) ? arr.filter((x) => x !== t) : [...arr, t]);
  const toggleTier = (t: DifficultyTier) =>
    setSelectedTiers((arr) => arr.includes(t) ? arr.filter((x) => x !== t) : [...arr, t]);

  const handleGenerate = async () => {
    const apiKey = getKey(activeProvider);
    if (!apiKey) { setState({ stage: 'error', error: `No ${activeProvider} API key configured.` }); return; }
    if (!topic.trim()) { setState({ stage: 'error', error: 'Topic is required.' }); return; }
    if (!selectedTypes.length) { setState({ stage: 'error', error: 'Select at least one question type.' }); return; }
    if (!selectedTiers.length) { setState({ stage: 'error', error: 'Select at least one difficulty tier.' }); return; }

    setState({ stage: 'generating', step: 'Drafting differentiated worksheet...' });

    const req: WorksheetRequest = {
      topic: topic.trim(),
      yearLevel,
      curriculumStandard: curriculumStandard.trim() || undefined,
      sourceText: sourceText.trim() || undefined,
      questionTypes: selectedTypes,
      questionsPerTier,
      tiers: selectedTiers,
      bloom: bloom || undefined,
      estimatedTimeMin: typeof estimatedTimeMin === 'number' ? estimatedTimeMin : undefined,
      includeAnswerKey,
      notes: notes.trim() || undefined,
    };

    try {
      const { text } = await complete({
        provider: activeProvider,
        model: activeModel,
        apiKey,
        system: 'You are an expert teacher. Output ONLY valid JSON matching the requested schema — no prose, no fences.',
        messages: [{ role: 'user', content: buildWorksheetPrompt(req) }],
        maxTokens: 12000,
        temperature: 0.5,
      });

      let parsed: Worksheet;
      try { parsed = parseWorksheetJson(text); }
      catch (e) { throw new Error(`Failed to parse worksheet JSON: ${(e as Error).message}`); }

      setState({ stage: 'generating', step: 'Building PDF and DOCX...' });
      const [pdf, docx] = await Promise.all([
        buildWorksheetPdf(parsed, { includeAnswerKey }),
        buildWorksheetDocx(parsed, { includeAnswerKey }),
      ]);

      const savedArtifact = await artifactsRepo.create(db, {
        type: 'worksheet',
        title: parsed.title || topic.trim(),
        data: pdf,
        mediaType: 'application/pdf',
        meta: {
          topic: parsed.topic,
          yearLevel: parsed.yearLevel,
          curriculumStandard: parsed.curriculumStandard,
          tiers: parsed.tiers.map((t) => t.tier),
          questionCount: parsed.tiers.reduce((s, t) => s + t.questions.length, 0),
          includeAnswerKey,
          worksheet: parsed,
          docxBase64: docx,
          generatedAt: Date.now(),
          provider: activeProvider,
          model: activeModel,
        },
      });
      notifyArtifactGenerated(savedArtifact.id);

      setWorksheet(parsed);
      setPdfB64(pdf);
      setDocxB64(docx);
      setSaved(true);
      setState({ stage: 'preview' });
    } catch (e) {
      setState({ stage: 'error', error: (e as Error).message });
    }
  };

  const handleReset = () => {
    setWorksheet(null); setPdfB64(null); setDocxB64(null); setSaved(false);
    setState({ stage: 'form' });
  };

  const downloadName = () => {
    if (!worksheet) return 'worksheet';
    return worksheet.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'worksheet';
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl h-[92vh] bg-bg-panel border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-btn bg-bg-panel border border-border">
              <BookOpen size={16} className="text-accent-green" />
            </div>
            <div>
              <h2 className="font-orbitron font-bold text-text-primary text-sm tracking-wide uppercase">
                Worksheet Generator
              </h2>
              <p className="font-mono text-[10px] text-text-dim tracking-wider">
                DIFFERENTIATED · PDF · DOCX · INTERACTIVE
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan hover:bg-bg-panel transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {state.stage === 'form' && (
            <div className="flex-1 overflow-y-auto p-5">
              <FormStage
                topic={topic} setTopic={setTopic}
                yearLevel={yearLevel} setYearLevel={setYearLevel}
                curriculumStandard={curriculumStandard} setCurriculumStandard={setCurriculumStandard}
                sourceText={sourceText} setSourceText={setSourceText}
                selectedTypes={selectedTypes} onToggleType={toggleType}
                questionsPerTier={questionsPerTier} setQuestionsPerTier={setQuestionsPerTier}
                selectedTiers={selectedTiers} onToggleTier={toggleTier}
                bloom={bloom} setBloom={setBloom}
                estimatedTimeMin={estimatedTimeMin} setEstimatedTimeMin={setEstimatedTimeMin}
                includeAnswerKey={includeAnswerKey} setIncludeAnswerKey={setIncludeAnswerKey}
                notes={notes} setNotes={setNotes}
              />
            </div>
          )}

          {state.stage === 'generating' && (
            <GeneratingStage step={state.step ?? ''} />
          )}

          {state.stage === 'error' && (
            <ErrorStage error={state.error ?? 'Unknown error'} onRetry={handleReset} />
          )}

          {state.stage === 'preview' && worksheet && (
            <>
              <div className="shrink-0 flex border-b border-border bg-bg-elevated">
                {([
                  { id: 'interactive', label: 'Interactive', icon: PlayCircle },
                  { id: 'print', label: 'Print preview', icon: FileText },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={clsx(
                      'px-4 py-2 flex items-center gap-2 text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors',
                      activeTab === id
                        ? 'text-accent-cyan border-b-2 border-accent-cyan'
                        : 'text-text-dim hover:text-text-primary',
                    )}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-h-0 overflow-hidden p-5">
                {activeTab === 'interactive' && (
                  <InteractiveWorksheet worksheet={worksheet} />
                )}
                {activeTab === 'print' && pdfB64 && (
                  <iframe
                    title="PDF preview"
                    src={`data:application/pdf;base64,${pdfB64}`}
                    className="w-full h-full border border-border rounded-btn bg-white"
                  />
                )}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border bg-bg-elevated gap-3">
          <div className="font-mono text-[10px] text-text-dim tracking-wider">
            {state.stage === 'form' && 'CONFIGURE WORKSHEET'}
            {state.stage === 'generating' && 'WORKING...'}
            {state.stage === 'preview' && saved && (
              <span className="flex items-center gap-1.5 text-accent-green">
                <CheckCircle2 size={11} />
                SAVED TO LIBRARY
              </span>
            )}
            {state.stage === 'error' && 'ERROR'}
          </div>

          <div className="flex items-center gap-2">
            {state.stage === 'form' && (
              <>
                <button onClick={onClose}
                  className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary hover:border-text-dim text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">
                  Cancel
                </button>
                <button onClick={handleGenerate} disabled={!topic.trim() || !selectedTypes.length || !selectedTiers.length}
                  className="px-4 py-2 rounded-btn bg-accent-green text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2">
                  <Sparkles size={13} />
                  Generate
                </button>
              </>
            )}

            {state.stage === 'preview' && worksheet && (
              <>
                <button onClick={handleReset}
                  className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary hover:border-text-dim text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">
                  New
                </button>
                {docxB64 && (
                  <button onClick={() => downloadBase64Docx(docxB64, `${downloadName()}.docx`)}
                    className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-accent-cyan hover:border-accent-cyan text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5">
                    <FileType2 size={13} /> .docx
                  </button>
                )}
                {pdfB64 && (
                  <button onClick={() => downloadBase64Pdf(pdfB64, `${downloadName()}.pdf`)}
                    className="px-3 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-1.5">
                    <Download size={13} /> .pdf
                  </button>
                )}
              </>
            )}

            {state.stage === 'error' && (
              <button onClick={handleReset}
                className="px-4 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all">
                Start over
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Form stage ───────────────────────────────────────────────────────────────

function FormStage(props: {
  topic: string; setTopic: (v: string) => void;
  yearLevel: string; setYearLevel: (v: string) => void;
  curriculumStandard: string; setCurriculumStandard: (v: string) => void;
  sourceText: string; setSourceText: (v: string) => void;
  selectedTypes: QuestionType[]; onToggleType: (t: QuestionType) => void;
  questionsPerTier: number; setQuestionsPerTier: (n: number) => void;
  selectedTiers: DifficultyTier[]; onToggleTier: (t: DifficultyTier) => void;
  bloom: BloomLevel | ''; setBloom: (b: BloomLevel | '') => void;
  estimatedTimeMin: number | ''; setEstimatedTimeMin: (v: number | '') => void;
  includeAnswerKey: boolean; setIncludeAnswerKey: (v: boolean) => void;
  notes: string; setNotes: (v: string) => void;
}) {
  const {
    topic, setTopic, yearLevel, setYearLevel, curriculumStandard, setCurriculumStandard,
    sourceText, setSourceText, selectedTypes, onToggleType, questionsPerTier, setQuestionsPerTier,
    selectedTiers, onToggleTier, bloom, setBloom, estimatedTimeMin, setEstimatedTimeMin,
    includeAnswerKey, setIncludeAnswerKey, notes, setNotes,
  } = props;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left column */}
      <div className="space-y-4">
        <Field label="Topic" required>
          <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. The water cycle" className="input" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Year level">
            <select value={yearLevel} onChange={(e) => setYearLevel(e.target.value)} className="input">
              {YEAR_LEVELS.map((y) => <option key={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Estimated time (min)">
            <input type="number" min={5} max={240} value={estimatedTimeMin}
              onChange={(e) => setEstimatedTimeMin(e.target.value === '' ? '' : Number(e.target.value))}
              className="input" />
          </Field>
        </div>

        <Field label="Curriculum standard (optional)">
          <input type="text" value={curriculumStandard} onChange={(e) => setCurriculumStandard(e.target.value)}
            placeholder="e.g. VCDTCD062 / ACSSU075" className="input" />
        </Field>

        <Field label="Bloom's level (overall)" hint="Leave blank to let the AI vary per question.">
          <select value={bloom} onChange={(e) => setBloom(e.target.value as BloomLevel | '')} className="input">
            <option value="">Mixed (auto)</option>
            {ALL_BLOOM.map((b) => <option key={b} value={b}>{BLOOM_LABELS[b]}</option>)}
          </select>
        </Field>

        <Field label="Source text (optional)" hint="Paste reading material to base questions on.">
          <textarea value={sourceText} onChange={(e) => setSourceText(e.target.value)}
            rows={5} placeholder="Paste article, passage, or notes..." className="input font-mono text-xs" />
        </Field>

        <Field label="Extra instructions (optional)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            rows={2} placeholder="e.g. Avoid religious examples. Use metric units." className="input" />
        </Field>
      </div>

      {/* Right column */}
      <div className="space-y-4">
        <Field label="Differentiation tiers" required hint="Diffit-style: generate all selected tiers in one pass.">
          <div className="grid grid-cols-2 gap-2">
            {ALL_TIERS.map((t) => {
              const on = selectedTiers.includes(t);
              return (
                <button key={t} onClick={() => onToggleTier(t)}
                  className={clsx(
                    'p-2.5 rounded-btn border text-left transition-colors',
                    on ? 'border-accent-green bg-accent-green/10' : 'border-border hover:border-text-dim',
                  )}>
                  <div className={clsx('font-rajdhani font-bold text-sm', on ? 'text-accent-green' : 'text-text-primary')}>
                    {TIER_LABELS[t]}
                  </div>
                  <div className="text-[10px] text-text-dim mt-0.5">
                    {t === 'below' && 'Simplified · scaffolded'}
                    {t === 'on' && 'Grade-appropriate'}
                    {t === 'above' && 'Extended · multi-step'}
                    {t === 'extension' && 'Open-ended · synthesis'}
                  </div>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Question types" required>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_QTYPES.map((t) => {
              const on = selectedTypes.includes(t);
              return (
                <button key={t} onClick={() => onToggleType(t)}
                  className={clsx(
                    'px-3 py-1.5 rounded-btn border text-xs text-left font-rajdhani font-semibold transition-colors',
                    on ? 'border-accent-cyan text-accent-cyan bg-bg-elevated' : 'border-border text-text-secondary hover:border-text-dim',
                  )}>
                  {QTYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Questions per tier">
          <input type="number" min={2} max={30} value={questionsPerTier}
            onChange={(e) => setQuestionsPerTier(Math.max(2, Math.min(30, Number(e.target.value) || 6)))}
            className="input" />
        </Field>

        <Field label="Answer key">
          <label className={clsx(
            'flex items-center gap-3 p-3 rounded-btn border cursor-pointer transition-colors',
            includeAnswerKey ? 'border-accent-cyan bg-bg-elevated' : 'border-border hover:border-text-dim',
          )}>
            <input type="checkbox" checked={includeAnswerKey}
              onChange={(e) => setIncludeAnswerKey(e.target.checked)}
              className="accent-accent-cyan" />
            <span className="text-xs font-rajdhani font-semibold text-text-primary">
              Include separate answer key page
            </span>
          </label>
        </Field>
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-1.5">
        {label}
        {required && <span className="text-accent-cyan ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-text-dim">{hint}</p>}
    </div>
  );
}

function GeneratingStage({ step }: { step: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
      <Loader2 size={48} className="text-accent-green animate-spin" />
      <div className="font-rajdhani font-bold text-lg text-text-primary">{step}</div>
      <p className="text-xs text-text-dim font-mono max-w-sm">
        Drafting all tiers in one pass, then rendering print-ready PDF and editable DOCX.
      </p>
    </div>
  );
}

function ErrorStage({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="p-3 rounded-full bg-red-500/10 border border-red-500/30">
        <AlertCircle size={32} className="text-red-400" />
      </div>
      <h3 className="font-rajdhani font-bold text-lg text-text-primary">Generation failed</h3>
      <p className="text-xs text-text-secondary max-w-md font-mono whitespace-pre-wrap">{error}</p>
      <button onClick={onRetry}
        className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary hover:border-text-dim text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">
        Back to form
      </button>
    </div>
  );
}
