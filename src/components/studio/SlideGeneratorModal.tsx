import { useState } from 'react';
import {
  X,
  Loader2,
  Download,
  Sparkles,
  Image as ImageIcon,
  AlertCircle,
  Plus,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../../contexts/CredentialsContext';
import { useAppStore } from '../../store/appStore';
import { useDb } from '../../db/DbContext';
import { artifactsRepo } from '../../db/repos';
import { complete } from '../../lib/llm';
import {
  buildSlideGenPrompt,
  parseDeckJson,
  type SlideDeck,
  type SlideDeckRequest,
} from '../../lib/studio/slideSchema';
import { SLIDE_THEMES, getTheme, type SlideTheme } from '../../lib/studio/slideThemes';
import { buildPptx, downloadBase64Pptx } from '../../lib/studio/pptxBuilder';
import { buildSlidesPdf } from '../../lib/studio/slidesPdfBuilder';
import { downloadBase64Pdf } from '../../lib/studio/pdfRenderer';
import { generateImagePng } from '../../lib/studio/imageGen';
import { populatePexelsImages } from '../../lib/studio/pexelsImages';
import { SlidePreview } from './SlidePreview';

type Stage = 'form' | 'generating' | 'preview' | 'error';

interface StageState {
  stage: Stage;
  step?: string;
  progress?: number;
  total?: number;
  error?: string;
}

interface Props {
  onClose: () => void;
}

const YEAR_LEVELS = [
  'Prep', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6',
  'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11', 'Year 12',
  'Undergraduate',
];

export function SlideGeneratorModal({ onClose }: Props) {
  const { getKey } = useCredentials();
  const { activeProvider, activeModel, notifyArtifactGenerated } = useAppStore();
  const db = useDb();

  // ─── Form state ─────────────────────────────────────────────────────────
  const [topic, setTopic] = useState('');
  const [yearLevel, setYearLevel] = useState('Year 9');
  const [slideCount, setSlideCount] = useState(10);
  const [durationMin, setDurationMin] = useState<number | ''>(50);
  const [curriculumStandard, setCurriculumStandard] = useState('');
  const [objectives, setObjectives] = useState<string[]>(['']);
  const [includeImages, setIncludeImages] = useState(false);
  const [themeId, setThemeId] = useState<string>(SLIDE_THEMES[0].id);

  // ─── Runtime state ──────────────────────────────────────────────────────
  const [state, setState] = useState<StageState>({ stage: 'form' });
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [pptxBase64, setPptxBase64] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);

  const theme: SlideTheme = getTheme(themeId);
  const openaiKey = getKey('openai');
  const canGenerateImages = !!openaiKey && includeImages;

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleAddObjective = () => setObjectives((o) => [...o, '']);
  const handleRemoveObjective = (i: number) =>
    setObjectives((o) => o.filter((_, idx) => idx !== i));
  const handleObjectiveChange = (i: number, v: string) =>
    setObjectives((o) => o.map((x, idx) => (idx === i ? v : x)));

  const handleGenerate = async () => {
    const apiKey = getKey(activeProvider);
    if (!apiKey) {
      setState({ stage: 'error', error: `No ${activeProvider} API key configured.` });
      return;
    }
    if (!topic.trim()) {
      setState({ stage: 'error', error: 'Topic is required.' });
      return;
    }

    setState({ stage: 'generating', step: 'Drafting slide deck...' });

    const req: SlideDeckRequest = {
      topic: topic.trim(),
      yearLevel,
      slideCount,
      durationMin: typeof durationMin === 'number' ? durationMin : undefined,
      curriculumStandard: curriculumStandard.trim() || undefined,
      objectives: objectives.map((o) => o.trim()).filter(Boolean),
      includeImages: canGenerateImages,
    };

    try {
      // 1) Ask the LLM for structured deck JSON
      const { text } = await complete({
        provider: activeProvider,
        model: activeModel,
        apiKey,
        system:
          'You are a senior curriculum designer and master classroom teacher. You design lessons that are vivid, specific, age-appropriate, and pedagogically rigorous — with hooks, worked examples, misconceptions, checks for understanding, and real-world relevance. You output ONLY valid JSON matching the requested schema — no prose, no code fences, no commentary.',
        messages: [{ role: 'user', content: buildSlideGenPrompt(req) }],
        maxTokens: 16000,
        temperature: 0.75,
      });

      let parsed: SlideDeck;
      try {
        parsed = parseDeckJson(text);
      } catch (e) {
        throw new Error(
          `Failed to parse deck JSON: ${(e as Error).message}. Try again or pick a different model.`,
        );
      }

      // 2) Optionally generate images
      if (canGenerateImages && openaiKey) {
        const slidesWithPrompts = parsed.slides
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => !!s.imagePrompt);

        for (let k = 0; k < slidesWithPrompts.length; k++) {
          const { s, i } = slidesWithPrompts[k];
          setState({
            stage: 'generating',
            step: `Generating image ${k + 1} of ${slidesWithPrompts.length}...`,
            progress: k + 1,
            total: slidesWithPrompts.length,
          });
          try {
            const b64 = await generateImagePng({
              aspect_ratio: '4:3',
              prompt: [
                `Create an educational illustration for a ${parsed.yearLevel} lesson on "${parsed.topic}".`,
                `Subject: ${s.imagePrompt}`,
                'Rendering rules — this MUST be a didactic learning visual, NOT a decorative stock photo:',
                '• Flat vector / infographic style with generous white space.',
                '• Clearly labelled parts with short plain-English captions next to each element.',
                '• If the concept is a process or algorithm, show numbered steps (1, 2, 3, 4 …) laid out left-to-right or top-to-bottom with arrows connecting them.',
                '• If it is a comparison, use a side-by-side split or a two-column diagram.',
                '• If it is a worked example (maths / computing), show the calculation or transformation stepwise with intermediate values visible.',
                '• Use a limited high-contrast palette (2–3 colours + neutral grey). No photorealism, no faces, no cluttered backgrounds.',
                '• Spelling MUST be correct. Numbers MUST be legible. Avoid garbled text.',
                '• Absolutely no watermarks, no logos, no copyrighted characters. Classroom-safe.',
              ].join('\n'),
            });
            parsed.slides[i] = { ...s, imageBase64: b64 };
          } catch (e) {
            console.warn('Image generation failed for slide', i, e);
          }
        }
      }

      // 2b) Fill any remaining content slides with Pexels photos (free, keyword-based).
      setState({ stage: 'generating', step: 'Fetching images from Pexels...', progress: 0, total: parsed.slides.length });
      await populatePexelsImages(parsed.slides, {
        deckTopic: parsed.topic,
        onProgress: (completed, total) => {
          setState({
            stage: 'generating',
            step: `Fetching images from Pexels (${completed}/${total})...`,
            progress: completed,
            total,
          });
        },
      });

      // 3) Build pptx + pdf
      setState({ stage: 'generating', step: 'Assembling PowerPoint and PDF...' });
      const [b64, pdfBytesB64] = await Promise.all([buildPptx(parsed, theme), buildSlidesPdf(parsed, theme)]);

      // 4) Persist artifact
      const artifact = await artifactsRepo.create(db, {
        type: 'slides',
        title: parsed.title || topic.trim(),
        data: b64,
        mediaType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        meta: {
          topic: parsed.topic,
          yearLevel: parsed.yearLevel,
          slideCount: parsed.slides.length,
          themeId: theme.id,
          themeName: theme.name,
          durationMin: parsed.durationMin,
          objectives: parsed.objectives,
          subtitle: parsed.subtitle,
          deck: parsed,
          generatedAt: Date.now(),
          provider: activeProvider,
          model: activeModel,
        },
      });

      notifyArtifactGenerated(artifact.id);
      setDeck(parsed);
      setPptxBase64(b64);
      setPdfBase64(pdfBytesB64);
      setArtifactId(artifact.id);
      setState({ stage: 'preview' });
    } catch (e) {
      setState({ stage: 'error', error: (e as Error).message });
    }
  };

  const handleDownloadPptx = () => {
    if (!pptxBase64 || !deck) return;
    const safeName = deck.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'deck';
    downloadBase64Pptx(pptxBase64, `${safeName}.pptx`);
  };

  const handleDownloadPdf = () => {
    if (!pdfBase64 || !deck) return;
    const safeName = deck.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'deck';
    downloadBase64Pdf(pdfBase64, `${safeName}.pdf`);
  };

  const handleReset = () => {
    setDeck(null);
    setPptxBase64(null);
    setPdfBase64(null);
    setArtifactId(null);
    setState({ stage: 'form' });
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl h-[90vh] bg-bg-panel border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-btn bg-bg-panel border border-border">
              <Sparkles size={16} className="text-accent-cyan" />
            </div>
            <div>
              <h2 className="font-orbitron font-bold text-text-primary text-sm tracking-wide uppercase">
                Slide Deck Generator
              </h2>
              <p className="font-mono text-[10px] text-text-dim tracking-wider">
                PPTX / SPEAKER NOTES / THEMED
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan hover:bg-bg-panel transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {state.stage === 'form' && (
            <FormStage
              topic={topic} setTopic={setTopic}
              yearLevel={yearLevel} setYearLevel={setYearLevel}
              slideCount={slideCount} setSlideCount={setSlideCount}
              durationMin={durationMin} setDurationMin={setDurationMin}
              curriculumStandard={curriculumStandard} setCurriculumStandard={setCurriculumStandard}
              objectives={objectives}
              onAddObjective={handleAddObjective}
              onRemoveObjective={handleRemoveObjective}
              onObjectiveChange={handleObjectiveChange}
              includeImages={includeImages} setIncludeImages={setIncludeImages}
              themeId={themeId} setThemeId={setThemeId}
              hasOpenAIKey={!!openaiKey}
            />
          )}

          {state.stage === 'generating' && (
            <GeneratingStage step={state.step ?? ''} progress={state.progress} total={state.total} />
          )}

          {state.stage === 'error' && (
            <ErrorStage error={state.error ?? 'Unknown error'} onRetry={handleReset} />
          )}

          {state.stage === 'preview' && deck && (
            <div className="h-full p-5">
              <SlidePreview deck={deck} theme={theme} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border bg-bg-elevated gap-3">
          <div className="font-mono text-[10px] text-text-dim tracking-wider">
            {state.stage === 'form' && 'CONFIGURE DECK'}
            {state.stage === 'generating' && 'WORKING...'}
            {state.stage === 'preview' && artifactId && (
              <span className="flex items-center gap-1.5 text-accent-cyan">
                <CheckCircle2 size={11} />
                SAVED TO LIBRARY
              </span>
            )}
            {state.stage === 'error' && 'ERROR'}
          </div>

          <div className="flex items-center gap-2">
            {state.stage === 'form' && (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary hover:border-text-dim text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!topic.trim()}
                  className="px-4 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                >
                  <Sparkles size={13} />
                  Generate deck
                </button>
              </>
            )}

            {state.stage === 'preview' && (
              <>
                <button
                  onClick={handleReset}
                  className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary hover:border-text-dim text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors"
                >
                  New deck
                </button>
                <button
                  onClick={handleDownloadPdf}
                  disabled={!pdfBase64}
                  className="px-4 py-2 rounded-btn border border-accent-cyan text-accent-cyan font-rajdhani font-bold text-xs uppercase tracking-wider hover:bg-accent-cyan/10 disabled:opacity-40 transition-all flex items-center gap-2"
                >
                  <Download size={13} />
                  Download .pdf
                </button>
                <button
                  onClick={handleDownloadPptx}
                  className="px-4 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-2"
                >
                  <Download size={13} />
                  Download .pptx
                </button>
              </>
            )}

            {state.stage === 'error' && (
              <button
                onClick={handleReset}
                className="px-4 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all"
              >
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
  slideCount: number; setSlideCount: (v: number) => void;
  durationMin: number | ''; setDurationMin: (v: number | '') => void;
  curriculumStandard: string; setCurriculumStandard: (v: string) => void;
  objectives: string[];
  onAddObjective: () => void;
  onRemoveObjective: (i: number) => void;
  onObjectiveChange: (i: number, v: string) => void;
  includeImages: boolean; setIncludeImages: (v: boolean) => void;
  themeId: string; setThemeId: (v: string) => void;
  hasOpenAIKey: boolean;
}) {
  const {
    topic, setTopic, yearLevel, setYearLevel, slideCount, setSlideCount,
    durationMin, setDurationMin, curriculumStandard, setCurriculumStandard,
    objectives, onAddObjective, onRemoveObjective, onObjectiveChange,
    includeImages, setIncludeImages, themeId, setThemeId, hasOpenAIKey,
  } = props;

  return (
    <div className="p-5 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
      {/* Left column — inputs */}
      <div className="space-y-4">
        <Field label="Topic" required hint="What's the lesson about?">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Photosynthesis and cellular respiration"
            className="input"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Year level">
            <select
              value={yearLevel}
              onChange={(e) => setYearLevel(e.target.value)}
              className="input"
            >
              {YEAR_LEVELS.map((y) => <option key={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Slide count">
            <input
              type="number"
              min={3}
              max={40}
              value={slideCount}
              onChange={(e) => setSlideCount(Math.max(3, Math.min(40, Number(e.target.value) || 10)))}
              className="input"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)">
            <input
              type="number"
              min={10}
              max={240}
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value === '' ? '' : Number(e.target.value))}
              className="input"
            />
          </Field>
          <Field label="Curriculum (optional)">
            <input
              type="text"
              value={curriculumStandard}
              onChange={(e) => setCurriculumStandard(e.target.value)}
              placeholder="e.g. VCE Biology Unit 3"
              className="input"
            />
          </Field>
        </div>

        <Field label="Learning objectives (optional)" hint="Leave blank to let the AI infer them.">
          <div className="space-y-2">
            {objectives.map((o, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={o}
                  onChange={(e) => onObjectiveChange(i, e.target.value)}
                  placeholder={`Objective ${i + 1}`}
                  className="input flex-1"
                />
                {objectives.length > 1 && (
                  <button
                    onClick={() => onRemoveObjective(i)}
                    aria-label="Remove objective"
                    className="p-2 rounded-btn border border-border text-text-dim hover:text-red-400 hover:border-red-400 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={onAddObjective}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn border border-border text-text-dim hover:text-accent-cyan hover:border-accent-cyan text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors"
            >
              <Plus size={12} /> Add objective
            </button>
          </div>
        </Field>

        <Field label="Images" hint={hasOpenAIKey ? 'Generates one image per applicable slide using the best available OpenAI image model.' : 'Add an OpenAI API key in Settings to enable image generation.'}>
          <label className={clsx(
            'flex items-center gap-3 p-3 rounded-btn border cursor-pointer transition-colors',
            includeImages ? 'border-accent-cyan bg-bg-elevated' : 'border-border hover:border-text-dim',
            !hasOpenAIKey && 'opacity-50 cursor-not-allowed',
          )}>
            <input
              type="checkbox"
              checked={includeImages}
              disabled={!hasOpenAIKey}
              onChange={(e) => setIncludeImages(e.target.checked)}
              className="accent-accent-cyan"
            />
            <ImageIcon size={14} className="text-accent-cyan" />
            <span className="text-xs font-rajdhani font-semibold text-text-primary">
              Include AI-generated images
            </span>
          </label>
        </Field>
      </div>

      {/* Right column — themes */}
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-2">
            Theme
          </label>
          <div className="grid grid-cols-2 gap-3">
            {SLIDE_THEMES.map((t) => {
              const active = t.id === themeId;
              return (
                <button
                  key={t.id}
                  onClick={() => setThemeId(t.id)}
                  className={clsx(
                    'relative text-left p-3 rounded-btn border transition-all',
                    active
                      ? 'border-accent-cyan ring-1 ring-accent-cyan'
                      : 'border-border hover:border-text-dim',
                  )}
                >
                  <div
                    className="aspect-video rounded-sm mb-2 overflow-hidden relative border border-black/20"
                    style={{ backgroundColor: `#${t.titleBackground}` }}
                  >
                    <div
                      className="absolute bottom-2 left-2 right-2"
                    >
                      <div
                        className="h-0.5 w-6 mb-1"
                        style={{ backgroundColor: `#${t.accent}` }}
                      />
                      <div
                        className="font-rajdhani font-bold text-[11px] leading-tight"
                        style={{ color: `#${t.textPrimary}` }}
                      >
                        Sample title
                      </div>
                      <div
                        className="font-mono text-[7px] tracking-widest mt-0.5"
                        style={{ color: `#${t.textSecondary}` }}
                      >
                        SUBTITLE TEXT
                      </div>
                    </div>
                  </div>
                  <div className="font-rajdhani font-bold text-xs text-text-primary">
                    {t.name}
                  </div>
                  <div className="text-[10px] text-text-dim leading-tight mt-0.5">
                    {t.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
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

// ─── Generating stage ─────────────────────────────────────────────────────────

function GeneratingStage({ step, progress, total }: { step: string; progress?: number; total?: number }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="relative">
        <Loader2 size={48} className="text-accent-cyan animate-spin" />
      </div>
      <div className="font-rajdhani font-bold text-lg text-text-primary">
        {step}
      </div>
      {typeof progress === 'number' && typeof total === 'number' && (
        <div className="w-64">
          <div className="h-1 bg-bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-cyan transition-all"
              style={{ width: `${(progress / total) * 100}%` }}
            />
          </div>
          <div className="mt-2 font-mono text-xs text-text-dim">
            {progress} / {total}
          </div>
        </div>
      )}
      <p className="text-xs text-text-dim font-mono max-w-sm">
        Drafting structured JSON, generating any images, then assembling a themed .pptx file.
      </p>
    </div>
  );
}

// ─── Error stage ──────────────────────────────────────────────────────────────

function ErrorStage({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="p-3 rounded-full bg-red-500/10 border border-red-500/30">
        <AlertCircle size={32} className="text-red-400" />
      </div>
      <h3 className="font-rajdhani font-bold text-lg text-text-primary">Generation failed</h3>
      <p className="text-xs text-text-secondary max-w-md font-mono whitespace-pre-wrap">
        {error}
      </p>
      <button
        onClick={onRetry}
        className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary hover:border-text-dim text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors"
      >
        Back to form
      </button>
    </div>
  );
}
