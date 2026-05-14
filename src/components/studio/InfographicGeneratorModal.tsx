import { useState } from 'react';
import {
  X, Loader2, Sparkles, AlertCircle, CheckCircle2,
  Download, Image as ImageIcon, Code2, LayoutGrid,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../../contexts/CredentialsContext';
import { useAppStore } from '../../store/appStore';
import { useDb } from '../../db/DbContext';
import { artifactsRepo } from '../../db/repos';
import { complete } from '../../lib/llm';
import { generateImage } from '../../lib/studio/imageGen';
import {
  buildInfographicPrompt, parseInfographicJson,
  ORIENTATION_LABELS, DETAIL_LABELS,
  type Infographic, type InfographicRequest,
  type InfographicOrientation, type InfographicDetail,
} from '../../lib/studio/infographicSchema';
import {
  renderInfographicSvg, svgToPngBase64, svgToBase64,
  getInfographicDims, downloadSvg, downloadPngFromBase64,
} from '../../lib/studio/infographicRenderer';

/** Model used for infographic image generation. Always GPT Image 2 regardless of the
 *  active chat model — ensures consistent, high-quality infographic output. */
const INFOGRAPHIC_IMAGE_MODEL = 'gpt-image-2';

/** Size parameter for OpenAI images API keyed by infographic orientation. */
const ORIENTATION_TO_IMAGE_SIZE: Record<InfographicOrientation, '1024x1024' | '1536x1024' | '1024x1536'> = {
  portrait: '1024x1536',
  landscape: '1536x1024',
  square: '1024x1024',
};

type Stage = 'form' | 'generating' | 'preview' | 'error';

interface Props { onClose: () => void; seed?: { topic?: string; yearLevel?: string } }

const YEAR_LEVELS = ['Prep','Year 1','Year 2','Year 3','Year 4','Year 5','Year 6','Year 7','Year 8','Year 9','Year 10','Year 11','Year 12','Undergraduate'];
const ORIENTATIONS: InfographicOrientation[] = ['portrait', 'landscape', 'square'];
const DETAILS: InfographicDetail[] = ['brief', 'standard', 'detailed'];

export function InfographicGeneratorModal({ onClose, seed }: Props) {
  const { getKey } = useCredentials();
  const { activeProvider, activeModel, notifyArtifactGenerated } = useAppStore();
  const db = useDb();

  const [topic, setTopic] = useState(seed?.topic ?? '');
  const [yearLevel, setYearLevel] = useState(seed?.yearLevel ?? 'Year 9');
  const [orientation, setOrientation] = useState<InfographicOrientation>('portrait');
  const [detail, setDetail] = useState<InfographicDetail>('standard');
  const [focus, setFocus] = useState('');
  const [curriculumStandard, setCurriculumStandard] = useState('');

  const [state, setState] = useState<{ stage: Stage; step?: string; error?: string }>({ stage: 'form' });
  const [info, setInfo] = useState<Infographic | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [pngB64, setPngB64] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');
  const [saved, setSaved] = useState(false);

  const handleGenerate = async () => {
    const planningKey = getKey(activeProvider);
    const openaiKey = getKey('openai');
    if (!planningKey) { setState({ stage: 'error', error: `No ${activeProvider} API key.` }); return; }
    if (!openaiKey) { setState({ stage: 'error', error: 'Infographic rendering requires an OpenAI API key (GPT Image 2). Add one in Settings.' }); return; }
    if (!topic.trim()) { setState({ stage: 'error', error: 'Topic is required.' }); return; }

    const req: InfographicRequest = {
      topic: topic.trim(), yearLevel, orientation, detail,
      focus: focus.trim() || undefined,
      curriculumStandard: curriculumStandard.trim() || undefined,
    };

    const prompt = buildInfographicPrompt(req);
    setLastPrompt(prompt);
    setState({ stage: 'generating', step: 'Designing infographic layout...' });

    try {
      const { text } = await complete({
        provider: activeProvider,
        model: activeModel,
        apiKey: planningKey,
        system: 'You are an expert visual teacher. Output ONLY valid JSON — no prose, no fences, no markdown.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 6000,
        temperature: 0.6,
      });

      let parsed: Infographic;
      try { parsed = parseInfographicJson(text); } catch (e) { throw new Error(`Failed to parse infographic JSON: ${(e as Error).message}`); }

      setState({ stage: 'generating', step: 'Rendering SVG layout...' });
      const svgString = renderInfographicSvg(parsed);
      const { w, h } = getInfographicDims(parsed.orientation);

      setState({ stage: 'generating', step: 'Generating with GPT Image 2...' });
      const imagePrompt = buildImagePromptFromInfographic(parsed);
      let png: string;
      try {
        png = await generateImage({
          apiKey: openaiKey,
          prompt: imagePrompt,
          size: ORIENTATION_TO_IMAGE_SIZE[parsed.orientation],
          model: INFOGRAPHIC_IMAGE_MODEL,
        });
      } catch (imgErr) {
        // If GPT Image 2 is not yet accessible on this key, fall back to rasterising the SVG.
        console.warn('[infographic] GPT Image 2 failed, falling back to SVG raster:', imgErr);
        setState({ stage: 'generating', step: 'Rasterising SVG fallback...' });
        png = await svgToPngBase64(svgString, w, h);
      }

      const savedArtifact = await artifactsRepo.create(db, {
        type: 'infographic',
        title: parsed.title || topic.trim(),
        data: png,
        mediaType: 'image/png',
        meta: {
          topic: parsed.topic, yearLevel: parsed.yearLevel,
          orientation: parsed.orientation, detail: parsed.detail,
          infographic: parsed,
          svgBase64: svgToBase64(svgString),
          generatedAt: Date.now(),
          provider: activeProvider, model: activeModel,
          imageModel: INFOGRAPHIC_IMAGE_MODEL,
          imagePrompt,
        },
      });
      notifyArtifactGenerated(savedArtifact.id);

      setInfo(parsed);
      setSvg(svgString);
      setPngB64(png);
      setSaved(true);
      setState({ stage: 'preview' });
    } catch (e) {
      setState({ stage: 'error', error: (e as Error).message });
    }
  };

  const handleReset = () => {
    setInfo(null); setSvg(null); setPngB64(null); setSaved(false);
    setState({ stage: 'form' });
  };

  const dn = () => (info?.title ?? topic).replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'infographic';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-6xl h-[92vh] bg-bg-panel border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-btn bg-bg-panel border border-border"><LayoutGrid size={16} className="text-accent-green" /></div>
            <div>
              <h2 className="font-orbitron font-bold text-text-primary text-sm tracking-wide uppercase">Infographic Generator</h2>
              <p className="font-mono text-[10px] text-text-dim tracking-wider">NOTEBOOKLM-STYLE · SVG · PNG</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {state.stage === 'preview' && (
              <button onClick={() => setShowPrompt((s) => !s)} className="px-2 py-1 rounded-btn border border-border text-[10px] font-mono text-text-dim hover:text-accent-cyan hover:border-accent-cyan transition-colors flex items-center gap-1">
                <Code2 size={11} /> {showPrompt ? 'Hide' : 'View'} prompt
              </button>
            )}
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan hover:bg-bg-panel transition-colors"><X size={16} /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {showPrompt && (
            <div className="shrink-0 border-b border-border bg-bg-elevated max-h-40 overflow-y-auto p-3">
              <pre className="text-[10px] font-mono text-text-secondary whitespace-pre-wrap">{lastPrompt}</pre>
            </div>
          )}

          {state.stage === 'form' && (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl mx-auto">
                <div className="space-y-4">
                  <Field label="Topic" required>
                    <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Photosynthesis in plants" className="input" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Year level">
                      <select value={yearLevel} onChange={(e) => setYearLevel(e.target.value)} className="input">
                        {YEAR_LEVELS.map((y) => <option key={y}>{y}</option>)}
                      </select>
                    </Field>
                    <Field label="Curriculum (optional)">
                      <input type="text" value={curriculumStandard} onChange={(e) => setCurriculumStandard(e.target.value)} placeholder="e.g. ACSSU149" className="input" />
                    </Field>
                  </div>
                  <Field label="Focus / angle (optional)" hint="What should the infographic emphasise?">
                    <textarea value={focus} onChange={(e) => setFocus(e.target.value)} rows={3} placeholder="e.g. Emphasise the role of chlorophyll and the energy cycle." className="input" />
                  </Field>
                </div>

                <div className="space-y-4">
                  <Field label="Orientation" hint="Portrait for posters, Landscape for wall displays, Square for social.">
                    <div className="grid grid-cols-3 gap-2">
                      {ORIENTATIONS.map((o) => {
                        const dims = getInfographicDims(o);
                        const aspectW = 40;
                        const aspectH = aspectW * (dims.h / dims.w);
                        return (
                          <button key={o} onClick={() => setOrientation(o)} className={clsx('p-3 rounded-btn border text-center transition-colors', o === orientation ? 'border-accent-green bg-accent-green/10' : 'border-border hover:border-text-dim')}>
                            <div className="flex justify-center mb-2">
                              <div className="border-2 rounded-sm" style={{ width: aspectW, height: aspectH, borderColor: o === orientation ? 'var(--accent-green)' : 'var(--border)' }} />
                            </div>
                            <div className={clsx('font-rajdhani font-bold text-xs', o === orientation ? 'text-accent-green' : 'text-text-primary')}>{ORIENTATION_LABELS[o]}</div>
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                  <Field label="Detail level" hint="Brief = 3-4 sections. Standard = 4-6. Detailed = 6-8 with timeline.">
                    <div className="grid grid-cols-3 gap-2">
                      {DETAILS.map((d) => (
                        <button key={d} onClick={() => setDetail(d)} className={clsx('p-3 rounded-btn border text-center transition-colors', d === detail ? 'border-accent-green bg-accent-green/10' : 'border-border hover:border-text-dim')}>
                          <div className={clsx('font-rajdhani font-bold text-sm', d === detail ? 'text-accent-green' : 'text-text-primary')}>{DETAIL_LABELS[d]}</div>
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
              </div>
            </div>
          )}

          {state.stage === 'generating' && <GenStage step={state.step ?? ''} />}
          {state.stage === 'error' && <ErrStage error={state.error ?? ''} onRetry={handleReset} />}

          {state.stage === 'preview' && info && svg && pngB64 && (
            <div className="flex-1 min-h-0 overflow-auto p-5 bg-bg-base">
              <div className="max-w-4xl mx-auto">
                <div className="bg-white border border-border rounded-btn overflow-hidden shadow-xl">
                  <img src={`data:image/png;base64,${pngB64}`} alt={info.title} className="w-full h-auto block" />
                </div>
                <div className="mt-4 p-4 border border-border rounded-btn bg-bg-panel">
                  <div className="text-[10px] font-mono text-text-dim tracking-widest mb-2">STRUCTURE</div>
                  <div className="text-xs text-text-secondary space-y-1">
                    <div><span className="text-accent-green">{info.sections.length}</span> sections{info.timeline ? ` · ${info.timeline.length}-point timeline` : ''}{info.headline ? ' · headline stat' : ''}{info.keyTakeaway ? ' · key takeaway' : ''}</div>
                    <div className="text-text-dim">Palette: <span style={{ color: info.palette.primary }}>primary</span> · <span style={{ color: info.palette.accent }}>accent</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border bg-bg-elevated gap-3">
          <div className="font-mono text-[10px] text-text-dim tracking-wider">
            {state.stage === 'preview' && saved && <span className="flex items-center gap-1.5 text-accent-green"><CheckCircle2 size={11} />SAVED TO LIBRARY</span>}
            {state.stage === 'form' && 'CONFIGURE INFOGRAPHIC'}
            {state.stage === 'generating' && 'WORKING...'}
          </div>
          <div className="flex items-center gap-2">
            {state.stage === 'form' && (<>
              <button onClick={onClose} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Cancel</button>
              <button onClick={handleGenerate} disabled={!topic.trim()} className="px-4 py-2 rounded-btn bg-accent-green text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"><Sparkles size={13} />Generate</button>
            </>)}
            {state.stage === 'preview' && info && svg && pngB64 && (<>
              <button onClick={handleReset} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">New</button>
              <button onClick={() => downloadSvg(svg, `${dn()}.svg`)} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-accent-cyan hover:border-accent-cyan text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"><Code2 size={13} />.svg</button>
              <button onClick={() => downloadPngFromBase64(pngB64, `${dn()}.png`)} className="px-3 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-1.5"><Download size={13} />.png</button>
            </>)}
            {state.stage === 'error' && <button onClick={handleReset} className="px-4 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all">Start over</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-1.5">
        {label}{required && <span className="text-accent-green ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-text-dim">{hint}</p>}
    </div>
  );
}

function GenStage({ step }: { step: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
      <Loader2 size={48} className="text-accent-green animate-spin" />
      <div className="font-rajdhani font-bold text-lg text-text-primary">{step}</div>
      <ImageIcon size={16} className="text-text-dim" />
    </div>
  );
}

/**
 * Compose a rich image-generation prompt from the planned infographic.
 * Ensures all semantic content (title, sections, timeline, takeaway, palette, orientation)
 * is passed to GPT Image 2 so the rendered output is informationally complete.
 */
function buildImagePromptFromInfographic(info: Infographic): string {
  const lines: string[] = [];
  lines.push(`Create a high-quality educational infographic poster titled "${info.title}".`);
  lines.push(`Subject: ${info.topic}. Target audience: ${info.yearLevel}. Orientation: ${info.orientation}. Detail level: ${info.detail}.`);
  if (info.headline) {
    lines.push(`Headline statistic: "${info.headline.value}" — ${info.headline.label}.`);
  }
  if (info.sections?.length) {
    lines.push('Sections (render each as a visually distinct card with icon/illustration + heading + short body text):');
    info.sections.forEach((s, i) => {
      const body = s.body ?? (s.bullets ? s.bullets.join('; ') : '');
      lines.push(`  ${i + 1}. ${s.heading}${body ? ': ' + body : ''}${s.stat ? ` [stat: ${s.stat.value} — ${s.stat.label}]` : ''}${s.icon ? ` [icon: ${s.icon}]` : ''}`);
    });
  }
  if (info.timeline?.length) {
    lines.push('Include a horizontal timeline with these points:');
    info.timeline.forEach((p) => { lines.push(`  • ${p.label}: ${p.description}`); });
  }
  if (info.keyTakeaway) {
    lines.push(`Key takeaway banner at the bottom: "${info.keyTakeaway}".`);
  }
  lines.push(`Use this colour palette: primary ${info.palette.primary}, accent ${info.palette.accent}, background ${info.palette.background ?? '#ffffff'}.`);
  lines.push('Style: clean, modern, NotebookLM-style flat illustrations, sans-serif typography, generous white space, clear visual hierarchy, icons for each section, accessible text contrast. All text must be spelled correctly and legible.');
  return lines.join('\n');
}

function ErrStage({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="p-3 rounded-full bg-red-500/10 border border-red-500/30"><AlertCircle size={32} className="text-red-400" /></div>
      <h3 className="font-rajdhani font-bold text-lg text-text-primary">Generation failed</h3>
      <p className="text-xs text-text-secondary max-w-md font-mono whitespace-pre-wrap">{error}</p>
      <button onClick={onRetry} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Back</button>
    </div>
  );
}
