import { useRef, useState } from 'react';
import {
  Loader2, Download, ImagePlus, AlertCircle, X, Sparkles,
  ChevronDown, ChevronUp, RefreshCw, Cpu, Wand2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { renderPoster, posterToPng, POSTER_THEMES, type PosterData } from '../lib/studio/researchPosterRenderer';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const EDGE_AUTOFILL_URL = `${SUPABASE_URL}/functions/v1/autofill-infographic`;
const EDGE_GENERATE_URL = `${SUPABASE_URL}/functions/v1/generate-infographic-image`;

const COLOR_THEMES = Object.values(POSTER_THEMES).map(t => ({
  id: t.id,
  label: t.id === 'blue-white' ? 'Blue / White'
       : t.id === 'dark-navy' ? 'Dark Navy'
       : t.id === 'green-teal' ? 'Green / Teal'
       : 'Purple',
  swatch: t.accent,
}));

type GenMode = 'svg' | 'ai';

interface FormState {
  title: string;
  authors: string;
  organization: string;
  motivation: string;
  method: string;
  results: string;
  analysis: string;
  takeaways: string;
  colorTheme: string;
}

const INITIAL: FormState = {
  title: '',
  authors: '',
  organization: '',
  motivation: '',
  method: '',
  results: '',
  analysis: '',
  takeaways: '',
  colorTheme: 'blue-white',
};

function validate(f: FormState): string | null {
  if (!f.title.trim()) return 'Title is required.';
  if (!f.motivation.trim()) return 'Motivation is required. Use AI Auto-Fill or enter manually.';
  if (!f.method.trim()) return 'Method is required. Use AI Auto-Fill or enter manually.';
  if (!f.results.trim()) return 'Results is required. Use AI Auto-Fill or enter manually.';
  if (!f.analysis.trim()) return 'Analysis is required. Use AI Auto-Fill or enter manually.';
  if (!f.takeaways.trim()) return 'Takeaways is required. Use AI Auto-Fill or enter manually.';
  return null;
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
  filled?: boolean;
}
function Field({ label, hint, children, filled }: FieldProps) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-[11px] font-rajdhani font-semibold uppercase tracking-wider text-text-secondary">
        {label}
        {filled && (
          <span className="text-[9px] font-inter normal-case tracking-normal text-emerald-400 border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">
            AI filled
          </span>
        )}
        {hint && <span className="ml-0.5 text-text-dim normal-case tracking-normal font-inter font-normal">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full bg-bg-elevated border border-border rounded-btn px-3 py-2 text-sm text-text-primary placeholder-text-dim focus:outline-none focus:ring-1 focus:ring-accent-cyan focus:border-accent-cyan transition-colors';
const filledCls = 'border-emerald-500/40 bg-emerald-500/5';

export function InfographicPosterView() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [filledFields, setFilledFields] = useState<Set<string>>(new Set());
  const [genMode, setGenMode] = useState<GenMode>('svg');
  const [generating, setGenerating] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [svgPreview, setSvgPreview] = useState<string | null>(null);
  const [aiImageB64, setAiImageB64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const currentYear = new Date().getFullYear().toString();

  const set = (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
      setFilledFields((s) => { const n = new Set(s); n.delete(field); return n; });
    };

  // Clear preview when mode changes
  const switchMode = (mode: GenMode) => {
    setGenMode(mode);
    setSvgPreview(null);
    setAiImageB64(null);
    setError(null);
  };

  const handleAutofill = async () => {
    if (!form.title.trim()) { setError('Enter a title before auto-filling.'); return; }
    setError(null);
    setAutofilling(true);
    try {
      const res = await fetch(EDGE_AUTOFILL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ title: form.title }),
      });
      const data = await res.json() as {
        motivation?: string; method?: string; results?: string;
        analysis?: string; takeaways?: string; error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setForm((f) => ({
        ...f,
        motivation: data.motivation ?? f.motivation,
        method: data.method ?? f.method,
        results: data.results ?? f.results,
        analysis: data.analysis ?? f.analysis,
        takeaways: data.takeaways ?? f.takeaways,
      }));
      setFilledFields(new Set(['motivation', 'method', 'results', 'analysis', 'takeaways']));
      setShowManual(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto-fill failed.');
    } finally {
      setAutofilling(false);
    }
  };

  const handleGenerateSvg = async () => {
    const err = validate(form);
    if (err) { setError(err); return; }
    setError(null);
    setGenerating(true);
    setSvgPreview(null);

    try {
      const data: PosterData = {
        title: form.title,
        authors: form.authors,
        organization: form.organization,
        year: currentYear,
        motivation: form.motivation,
        method: form.method,
        results: form.results,
        analysis: form.analysis,
        takeaways: form.takeaways,
        theme: POSTER_THEMES[form.colorTheme] ?? POSTER_THEMES['blue-white'],
      };
      const svg = renderPoster(data);
      setSvgPreview(svg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Render failed.');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateAi = async () => {
    const err = validate(form);
    if (err) { setError(err); return; }
    setError(null);
    setGenerating(true);
    setAiImageB64(null);

    try {
      const res = await fetch(EDGE_GENERATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          title: form.title,
          authors: form.authors,
          organization: form.organization,
          year: currentYear,
          motivation: form.motivation,
          method: form.method,
          results: form.results,
          analysis: form.analysis,
          takeaways: form.takeaways,
          theme: form.colorTheme,
        }),
      });
      const data = await res.json() as { b64?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (!data.b64) throw new Error('No image data returned.');
      setAiImageB64(data.b64);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = genMode === 'svg' ? handleGenerateSvg : handleGenerateAi;

  const handleDownload = async () => {
    if (genMode === 'svg' && svgPreview) {
      try {
        const b64 = await posterToPng(svgPreview);
        const a = document.createElement('a');
        a.href = `data:image/png;base64,${b64}`;
        a.download = `${form.title.replace(/[^a-z0-9_-]/gi, '_') || 'infographic'}.png`;
        document.body.appendChild(a); a.click(); a.remove();
      } catch {
        setError('PNG export failed.');
      }
    } else if (genMode === 'ai' && aiImageB64) {
      const a = document.createElement('a');
      a.href = `data:image/png;base64,${aiImageB64}`;
      a.download = `${form.title.replace(/[^a-z0-9_-]/gi, '_') || 'infographic'}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    }
  };

  const hasPreview = genMode === 'svg' ? !!svgPreview : !!aiImageB64;

  const contentFilled =
    filledFields.size >= 5 ||
    (form.motivation.trim() && form.method.trim() && form.results.trim() &&
     form.analysis.trim() && form.takeaways.trim());

  return (
    <div className="flex h-full overflow-hidden bg-bg-base">
      {/* ── Left: form ─────────────────────────────────────────────────── */}
      <div className="w-[38%] shrink-0 flex flex-col border-r border-border overflow-y-auto">
        <div className="px-5 py-4 border-b border-border shrink-0">
          <h1 className="font-orbitron text-sm font-bold tracking-widest text-accent-cyan uppercase">
            Infographic Poster
          </h1>
          <p className="text-xs text-text-dim mt-0.5">Enter the basics — let AI do the rest.</p>
        </div>

        <div className="flex-1 px-5 py-4 space-y-5">
          {/* ── Generation Mode Selector ── */}
          <div className="space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-dim border-b border-border pb-1">
              Generation Method
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => switchMode('svg')}
                className={clsx(
                  'flex flex-col items-start gap-1 px-3 py-3 rounded-btn border text-left transition-all',
                  genMode === 'svg'
                    ? 'border-accent-cyan bg-accent-cyan/10'
                    : 'border-border hover:border-text-dim',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Cpu size={13} className={genMode === 'svg' ? 'text-accent-cyan' : 'text-text-dim'} />
                  <span className={clsx('font-rajdhani font-bold text-xs uppercase tracking-wider', genMode === 'svg' ? 'text-accent-cyan' : 'text-text-secondary')}>
                    SVG Renderer
                  </span>
                </div>
                <p className="text-[10px] text-text-dim leading-tight">Instant, pixel-perfect text. Crisp at any scale.</p>
              </button>

              <button
                onClick={() => switchMode('ai')}
                className={clsx(
                  'flex flex-col items-start gap-1 px-3 py-3 rounded-btn border text-left transition-all',
                  genMode === 'ai'
                    ? 'border-amber-400 bg-amber-400/10'
                    : 'border-border hover:border-text-dim',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Wand2 size={13} className={genMode === 'ai' ? 'text-amber-300' : 'text-text-dim'} />
                  <span className={clsx('font-rajdhani font-bold text-xs uppercase tracking-wider', genMode === 'ai' ? 'text-amber-300' : 'text-text-secondary')}>
                    gpt-image-2
                  </span>
                </div>
                <p className="text-[10px] text-text-dim leading-tight">AI-rendered visuals. Richer diagrams & aesthetics.</p>
              </button>
            </div>

            {genMode === 'ai' && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-btn bg-amber-400/8 border border-amber-400/25 text-amber-300/80 text-[11px]">
                <Wand2 size={11} className="shrink-0 mt-0.5" />
                <span>Uses OpenAI gpt-image-2 (medium quality, 1536×1024). Takes ~30–60s and incurs API cost (~$0.06/image).</span>
              </div>
            )}
          </div>

          {/* ── Core fields ── */}
          <div className="space-y-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-dim border-b border-border pb-1">
              Paper Details
            </div>
            <Field label="Title">
              <input
                className={inputCls}
                placeholder="e.g. Attention Is All You Need"
                value={form.title}
                onChange={set('title')}
              />
            </Field>
            <Field label="Your Name">
              <input
                className={inputCls}
                placeholder="e.g. Jane Smith"
                value={form.authors}
                onChange={set('authors')}
              />
            </Field>
            <Field label="Organization">
              <input
                className={inputCls}
                placeholder="e.g. MIT, OpenAI, Stanford"
                value={form.organization}
                onChange={set('organization')}
              />
            </Field>
            <div className="flex items-center gap-2 px-3 py-2 rounded-btn bg-bg-elevated border border-border text-xs text-text-dim">
              <span className="font-mono">Year</span>
              <span className="ml-auto font-semibold text-text-secondary">{currentYear}</span>
              <span className="text-[10px]">auto</span>
            </div>
          </div>

          {/* ── AI Auto-fill ── */}
          <div className="space-y-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-dim border-b border-border pb-1">
              Content
            </div>

            <button
              onClick={handleAutofill}
              disabled={autofilling || !form.title.trim()}
              className={clsx(
                'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-btn border font-rajdhani font-bold text-sm uppercase tracking-widest transition-all',
                autofilling || !form.title.trim()
                  ? 'border-border text-text-dim cursor-not-allowed opacity-60'
                  : 'border-amber-400/60 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 hover:border-amber-400',
              )}
            >
              {autofilling
                ? <><Loader2 size={14} className="animate-spin" /> Researching topic…</>
                : <><Sparkles size={14} /> AI Auto-Fill Content</>}
            </button>

            {autofilling && (
              <p className="text-[11px] text-text-dim text-center">
                AI is researching your topic and populating all sections…
              </p>
            )}

            {contentFilled && !autofilling && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-btn bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
                <Sparkles size={12} />
                <span>All sections filled. Edit below or generate the poster.</span>
              </div>
            )}

            {/* Expandable manual edit */}
            <div className="rounded-btn border border-border overflow-hidden">
              <button
                onClick={() => setShowManual((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
              >
                <span>Edit / Review Content Sections</span>
                {showManual ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>

              {showManual && (
                <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border bg-bg-elevated/30">
                  <Field label="1. Motivation & Key Idea" filled={filledFields.has('motivation')}>
                    <textarea
                      className={clsx(inputCls, 'resize-y min-h-[72px]', filledFields.has('motivation') && filledCls)}
                      placeholder="What problem does this solve? Core insight…"
                      value={form.motivation}
                      onChange={set('motivation')}
                    />
                  </Field>
                  <Field label="2. Method" filled={filledFields.has('method')}>
                    <textarea
                      className={clsx(inputCls, 'resize-y min-h-[72px]', filledFields.has('method') && filledCls)}
                      placeholder="Approach, architecture, training…"
                      value={form.method}
                      onChange={set('method')}
                    />
                  </Field>
                  <Field label="3. Results" hint="(rows: Benchmark, Ours, Prior, Delta)" filled={filledFields.has('results')}>
                    <textarea
                      className={clsx(inputCls, 'resize-y min-h-[72px]', filledFields.has('results') && filledCls)}
                      placeholder={"GLUE, 89.4, 87.1, +2.3\nSQuAD, 93.2, 91.8, +1.4"}
                      value={form.results}
                      onChange={set('results')}
                    />
                  </Field>
                  <Field label="4. Analysis" filled={filledFields.has('analysis')}>
                    <textarea
                      className={clsx(inputCls, 'resize-y min-h-[72px]', filledFields.has('analysis') && filledCls)}
                      placeholder="Key findings, ablation results…"
                      value={form.analysis}
                      onChange={set('analysis')}
                    />
                  </Field>
                  <Field label="5. Takeaways" hint="(4 items separated by |)" filled={filledFields.has('takeaways')}>
                    <textarea
                      className={clsx(inputCls, 'resize-y min-h-[60px]', filledFields.has('takeaways') && filledCls)}
                      placeholder="Pre-training matters | Scale helps | ..."
                      value={form.takeaways}
                      onChange={set('takeaways')}
                    />
                  </Field>
                </div>
              )}
            </div>
          </div>

          {/* ── Colour theme ── */}
          <div className="space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-dim border-b border-border pb-1">
              Colour Theme
            </div>
            <div className="grid grid-cols-2 gap-2">
              {COLOR_THEMES.map((th) => (
                <button
                  key={th.id}
                  onClick={() => setForm((f) => ({ ...f, colorTheme: th.id }))}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-2 rounded-btn border text-xs font-rajdhani font-semibold transition-all',
                    form.colorTheme === th.id
                      ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan'
                      : 'border-border text-text-secondary hover:border-text-dim hover:text-text-primary',
                  )}
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: th.swatch }} />
                  {th.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Generate button ── */}
        <div className="px-5 py-4 border-t border-border shrink-0 space-y-3">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-btn bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="shrink-0 hover:text-red-300"><X size={12} /></button>
            </div>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating || autofilling}
            className={clsx(
              'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-btn font-rajdhani font-bold text-sm uppercase tracking-widest transition-all disabled:opacity-60 disabled:cursor-not-allowed',
              genMode === 'ai'
                ? 'bg-amber-400 text-bg-base hover:brightness-110'
                : 'bg-accent-cyan text-bg-base hover:brightness-110',
            )}
          >
            {generating ? (
              <><Loader2 size={15} className="animate-spin" /> {genMode === 'ai' ? 'Generating with AI…' : 'Rendering…'}</>
            ) : hasPreview ? (
              <><RefreshCw size={15} /> Regenerate</>
            ) : (
              <>{genMode === 'ai' ? <Wand2 size={15} /> : <ImagePlus size={15} />}
                {genMode === 'ai' ? 'Generate with gpt-image-2' : 'Generate Infographic'}</>
            )}
          </button>
        </div>
      </div>

      {/* ── Right: preview ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-bg-panel">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-rajdhani font-semibold uppercase tracking-widest text-text-secondary">
              Preview
            </span>
            {hasPreview && (
              <span className={clsx(
                'text-[10px] font-mono px-2 py-0.5 rounded-full border',
                genMode === 'ai'
                  ? 'text-amber-300 border-amber-400/30 bg-amber-400/10'
                  : 'text-accent-cyan border-accent-cyan/30 bg-accent-cyan/10',
              )}>
                {genMode === 'ai' ? 'gpt-image-2' : 'SVG Renderer'}
              </span>
            )}
          </div>
          {hasPreview && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn border border-accent-cyan text-accent-cyan text-xs font-rajdhani font-semibold uppercase tracking-wider hover:bg-accent-cyan/10 transition-colors"
            >
              <Download size={12} />
              Download PNG
            </button>
          )}
        </div>

        <div ref={previewRef} className="flex-1 overflow-auto flex items-start justify-center p-4">
          {generating ? (
            <div className="flex flex-col items-center gap-4 text-text-dim mt-16">
              <Loader2 size={36} className="animate-spin text-accent-cyan" />
              <p className="text-sm font-rajdhani tracking-wide">
                {genMode === 'ai' ? 'Generating with gpt-image-2…' : 'Rendering poster…'}
              </p>
              {genMode === 'ai' && (
                <p className="text-xs text-text-dim">This can take 30–60 seconds</p>
              )}
            </div>
          ) : genMode === 'svg' && svgPreview ? (
            <div
              className="w-full rounded-lg overflow-hidden shadow-2xl border border-border"
              style={{ maxWidth: '100%' }}
              dangerouslySetInnerHTML={{ __html: svgPreview }}
            />
          ) : genMode === 'ai' && aiImageB64 ? (
            <div className="w-full flex flex-col items-center gap-4">
              <img
                src={`data:image/png;base64,${aiImageB64}`}
                alt="AI-generated infographic"
                className="w-full rounded-lg shadow-2xl border border-border object-contain"
                style={{ maxHeight: 'calc(100vh - 160px)' }}
              />
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-5 py-2.5 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-sm uppercase tracking-widest hover:brightness-110 transition-all"
              >
                <Download size={14} />
                Download PNG
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 text-text-dim max-w-sm text-center mt-16">
              <div className="w-16 h-16 rounded-full bg-bg-elevated border border-border flex items-center justify-center">
                <ImagePlus size={24} className="text-text-dim" />
              </div>
              <div>
                <p className="text-sm font-rajdhani tracking-wide text-text-secondary mb-1">No poster yet</p>
                <p className="text-xs">Enter a title, name, and organization — then click AI Auto-Fill, then Generate.</p>
              </div>
              <div className="flex flex-col gap-1.5 text-[11px] text-left w-full bg-bg-elevated rounded-btn border border-border px-4 py-3">
                <div className="flex items-center gap-2 text-text-secondary font-rajdhani font-semibold uppercase text-[10px] tracking-wider mb-1">
                  <Sparkles size={10} className="text-amber-300" /> Quick Start
                </div>
                <div className="flex items-center gap-2 text-text-dim"><span className="text-accent-cyan font-bold">1.</span> Enter title, name, organization</div>
                <div className="flex items-center gap-2 text-text-dim"><span className="text-amber-300 font-bold">2.</span> Click AI Auto-Fill</div>
                <div className="flex items-center gap-2 text-text-dim"><span className="text-text-secondary font-bold">3.</span> Choose generation method</div>
                <div className="flex items-center gap-2 text-text-dim"><span className="text-accent-cyan font-bold">4.</span> Generate Infographic</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
