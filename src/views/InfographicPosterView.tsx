import { useState } from 'react';
import { Loader2, Download, ImagePlus, AlertCircle, X } from 'lucide-react';
import { clsx } from 'clsx';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/generate-infographic-image`;

const COLOR_THEMES = [
  { id: 'blue-white', label: 'Blue / White', primary: '#1d4ed8', bg: '#ffffff', header: '#1e40af' },
  { id: 'dark-navy', label: 'Dark Navy', primary: '#0ea5e9', bg: '#0f172a', header: '#1e3a5f' },
  { id: 'green-teal', label: 'Green / Teal', primary: '#059669', bg: '#f0fdf4', header: '#065f46' },
  { id: 'purple', label: 'Purple', primary: '#7c3aed', bg: '#faf5ff', header: '#5b21b6' },
] as const;

type ColorThemeId = typeof COLOR_THEMES[number]['id'];

interface FormState {
  title: string;
  authors: string;
  organization: string;
  year: string;
  motivation: string;
  method: string;
  results: string;
  analysis: string;
  takeaways: string;
  colorTheme: ColorThemeId;
}

const INITIAL: FormState = {
  title: '',
  authors: '',
  organization: '',
  year: new Date().getFullYear().toString(),
  motivation: '',
  method: '',
  results: '',
  analysis: '',
  takeaways: '',
  colorTheme: 'blue-white',
};

function buildPrompt(f: FormState): string {
  const theme = COLOR_THEMES.find((t) => t.id === f.colorTheme) ?? COLOR_THEMES[0];
  return `Generate a highly detailed, professional research paper infographic poster in landscape orientation (wide format). The design should match the visual complexity and information density of an academic AI/ML paper summary infographic.

Layout: Dense multi-column grid layout. Use a ${theme.id === 'dark-navy' ? 'dark navy/black background' : 'light cream/white background'} with colored section headers (${theme.primary}). Include a large bold title at the top center, authors listed beneath it, and an organization logo/badge in the top right corner.

Title: "${f.title}"
Authors: "${f.authors}"
Organization: "${f.organization}" · Year: "${f.year}"

The infographic must contain exactly these 6 labeled sections arranged in a grid:

1. TOP-LEFT PANEL — "MOTIVATION & KEY IDEA" (green header, icon: lightbulb)
Content: "${f.motivation}"
Style: Bulleted list with small icons, key terms bolded.

2. TOP-CENTER PANEL — "METHOD" (blue header, icon: gear/cog)
Content: "${f.method}"
Style: Include a numbered two-stage process list AND a neural network architecture diagram showing stacked blocks (e.g., Transformer layers with arrows, feed-forward, attention blocks labeled). Show a pipeline diagram with boxes and arrows.

3. TOP-RIGHT PANEL — "DIAGRAM / TASK FORMATTING"
Content: Show visual diagrams of task input formatting. Draw labeled rows of colored boxes (Start, Text, Extract, Transformer, Linear) for task types: Classification, Entailment, Similarity, Multiple Choice. Use small pastel boxes connected by arrows.

4. BOTTOM-LEFT PANEL — "EVALUATION" (purple header, icon: trophy/checkmark)
Content: "${f.analysis}"
Style: Bulleted list of task families and benchmark names.

5. BOTTOM-CENTER PANEL — "MAIN RESULTS" (orange/yellow header, icon: bar chart)
Content: "${f.results}"
Style: Include a data table with 3 columns (Benchmark, Ours, Prior best, Delta) and rows of numbers. Use alternating row shading. Delta column should show green positive numbers with + prefix.

6. BOTTOM-RIGHT PANEL — "ANALYSIS" (teal header, icon: magnifying glass)
Content: "${f.analysis}"
Style: Include two small line charts side by side. Chart A shows multiple colored curves (y: accuracy, x: # of layers transferred). Chart B shows log-scale x-axis curves (y: task performance, x: # of pre-training updates).

FOOTER BAR: A full-width dark footer with 4 icon+text takeaway boxes side by side. Each takeaway has a small circular icon on the left and 2 lines of bold + normal text. Takeaways: "${f.takeaways}"

Typography: Use a clean sans-serif font. Section headers bold and white on colored backgrounds (${theme.primary}). Body text at 8-9pt equivalent. Numbers and metrics in bold. Labels inside diagrams very small.

Color theme: Primary color ${theme.primary}, background ${theme.bg}, section header background ${theme.header}.

Overall style: Matches the visual density and professionalism of an NLP/AI research poster. Not minimalist — every panel should be filled with text, diagrams, or charts. Highly structured grid, no wasted whitespace.`;
}

function validate(f: FormState): string | null {
  if (!f.title.trim()) return 'Title is required.';
  if (!f.motivation.trim()) return 'Motivation & Key Idea is required.';
  if (!f.method.trim()) return 'Method is required.';
  if (!f.results.trim()) return 'Results is required.';
  if (!f.analysis.trim()) return 'Analysis is required.';
  if (!f.takeaways.trim()) return 'Takeaways is required.';
  return null;
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}
function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-rajdhani font-semibold uppercase tracking-wider text-text-secondary">
        {label}
        {hint && <span className="ml-1 text-text-dim normal-case tracking-normal font-inter font-normal">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = 'w-full bg-bg-elevated border border-border rounded-btn px-3 py-2 text-sm text-text-primary placeholder-text-dim focus:outline-none focus:ring-1 focus:ring-accent-cyan focus:border-accent-cyan transition-colors';

export function InfographicPosterView() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleGenerate = async () => {
    const err = validate(form);
    if (err) { setError(err); return; }
    setError(null);
    setLoading(true);
    setImageB64(null);
    try {
      const prompt = buildPrompt(form);
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ imagePrompt: prompt }),
      });
      const data = await res.json() as { b64?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (!data.b64) throw new Error('No image data returned.');
      setImageB64(data.b64);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate image.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!imageB64) return;
    const a = document.createElement('a');
    a.href = `data:image/png;base64,${imageB64}`;
    a.download = `${form.title.replace(/[^a-z0-9_\-]/gi, '_') || 'infographic'}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <div className="flex h-full overflow-hidden bg-bg-base">
      {/* ── Left: form ───────────────────────────────────────────────────────── */}
      <div className="w-[40%] shrink-0 flex flex-col border-r border-border overflow-y-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <h1 className="font-orbitron text-sm font-bold tracking-widest text-accent-cyan uppercase">
            Infographic Poster
          </h1>
          <p className="text-xs text-text-dim mt-0.5">Fill in the fields to generate a research infographic.</p>
        </div>

        <div className="flex-1 px-5 py-4 space-y-4">
          {/* Metadata */}
          <div className="space-y-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-dim border-b border-border pb-1">
              Paper Details
            </div>
            <Field label="Title">
              <input className={inputCls} placeholder="e.g. Improving Language Understanding by Generative Pre-Training" value={form.title} onChange={set('title')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Authors">
                <input className={inputCls} placeholder="Author 1, Author 2" value={form.authors} onChange={set('authors')} />
              </Field>
              <Field label="Year">
                <input className={inputCls} placeholder="2024" value={form.year} onChange={set('year')} />
              </Field>
            </div>
            <Field label="Organization">
              <input className={inputCls} placeholder="e.g. OpenAI, DeepMind, MIT" value={form.organization} onChange={set('organization')} />
            </Field>
          </div>

          {/* Content sections */}
          <div className="space-y-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-dim border-b border-border pb-1">
              Content Sections
            </div>
            <Field label="1. Motivation & Key Idea">
              <textarea className={clsx(inputCls, 'resize-y min-h-[72px]')} placeholder="What problem does this paper solve? What is the core insight?" value={form.motivation} onChange={set('motivation')} />
            </Field>
            <Field label="2. Method">
              <textarea className={clsx(inputCls, 'resize-y min-h-[72px]')} placeholder="How does it work? Key architectural choices, training approach..." value={form.method} onChange={set('method')} />
            </Field>
            <Field label="3. Results / Benchmark Table" hint="(comma-separated rows)">
              <textarea className={clsx(inputCls, 'resize-y min-h-[72px]')} placeholder="GLUE 89.4, 87.1, +2.3 | SQuAD 93.2, 91.8, +1.4 ..." value={form.results} onChange={set('results')} />
            </Field>
            <Field label="4. Analysis">
              <textarea className={clsx(inputCls, 'resize-y min-h-[72px]')} placeholder="Ablation studies, layer transfer analysis, key findings..." value={form.analysis} onChange={set('analysis')} />
            </Field>
            <Field label="5. Takeaways">
              <textarea className={clsx(inputCls, 'resize-y min-h-[72px]')} placeholder="4 key takeaways, separated by | e.g. Pre-training matters | Scale helps | ..." value={form.takeaways} onChange={set('takeaways')} />
            </Field>
          </div>

          {/* Color theme */}
          <div className="space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-dim border-b border-border pb-1">
              Colour Theme
            </div>
            <div className="grid grid-cols-2 gap-2">
              {COLOR_THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setForm((f) => ({ ...f, colorTheme: t.id }))}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-2 rounded-btn border text-xs font-rajdhani font-semibold transition-all',
                    form.colorTheme === t.id
                      ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan'
                      : 'border-border text-text-secondary hover:border-text-dim hover:text-text-primary',
                  )}
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.primary }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Generate button */}
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
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-sm uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><Loader2 size={15} className="animate-spin" /> Generating…</>
            ) : (
              <><ImagePlus size={15} /> Generate Infographic</>
            )}
          </button>
        </div>
      </div>

      {/* ── Right: preview ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-bg-panel">
        {/* Preview header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <span className="text-xs font-rajdhani font-semibold uppercase tracking-widest text-text-secondary">
            Preview
          </span>
          {imageB64 && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn border border-accent-cyan text-accent-cyan text-xs font-rajdhani font-semibold uppercase tracking-wider hover:bg-accent-cyan/10 transition-colors"
            >
              <Download size={12} />
              Download PNG
            </button>
          )}
        </div>

        {/* Preview body */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-6">
          {loading ? (
            <div className="flex flex-col items-center gap-4 text-text-dim">
              <Loader2 size={36} className="animate-spin text-accent-cyan" />
              <p className="text-sm font-rajdhani tracking-wide">Generating your infographic…</p>
              <p className="text-xs text-text-dim">This can take up to 30 seconds</p>
            </div>
          ) : imageB64 ? (
            <div className="w-full flex flex-col items-center gap-4">
              <img
                src={`data:image/png;base64,${imageB64}`}
                alt="Generated infographic"
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
            <div className="flex flex-col items-center gap-3 text-text-dim max-w-xs text-center">
              <div className="w-16 h-16 rounded-full bg-bg-elevated border border-border flex items-center justify-center">
                <ImagePlus size={24} className="text-text-dim" />
              </div>
              <p className="text-sm font-rajdhani tracking-wide text-text-secondary">No infographic yet</p>
              <p className="text-xs">Fill in the form on the left and click <strong className="text-text-primary">Generate Infographic</strong> to create your poster.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
