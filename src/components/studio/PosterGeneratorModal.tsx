import { useState, useRef } from 'react';
import {
  X, Sparkles, AlertCircle, CheckCircle2, Download,
  Upload, Image as ImageIcon, Wand2, RotateCcw, Layers,
  User, Trash2, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../../contexts/CredentialsContext';
import { useAppStore } from '../../store/appStore';
import { useDb } from '../../db/DbContext';
import { artifactsRepo } from '../../db/repos';
import { complete } from '../../lib/llm';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const POSTER_FN_URL = `${SUPABASE_URL}/functions/v1/generate-poster`;

type Stage = 'form' | 'enhancing' | 'generating' | 'preview' | 'error';

interface Props {
  onClose: () => void;
}

interface PosterStyle {
  key: string;
  label: string;
  description: string;
  promptPrefix: string;
  accentColor: string;
}

const POSTER_STYLES: PosterStyle[] = [
  {
    key: 'advertising',
    label: 'Brand / Ad Campaign',
    description: 'High-impact commercial poster with bold typography and cinematic photography',
    accentColor: '#ef4444',
    promptPrefix: 'A hyper-detailed, ultra-premium advertising campaign poster. Bold oversized typography bleeds off-frame. Cinematic studio lighting, photorealistic product photography, high-impact commercial composition.',
  },
  {
    key: 'fashion',
    label: 'Fashion Editorial',
    description: 'Luxury fashion campaign with graffiti, urban aesthetics and editorial styling',
    accentColor: '#3b82f6',
    promptPrefix: 'Premium luxury fashion editorial campaign poster. Urban streetwear aesthetics, bold graffiti-style typography, cinematic editorial photography, high-fashion styling, mixed-media collage elements.',
  },
  {
    key: 'anime',
    label: 'Anime / Techwear',
    description: 'High-quality anime art in modern techwear style with dynamic characters',
    accentColor: '#f59e0b',
    promptPrefix: 'A high-quality anime poster design in modern Techwear style. Dynamic composition, cinematic balance, detailed character art, Japanese typography accents, action poses with strong visual chemistry.',
  },
  {
    key: 'product',
    label: 'Product Launch',
    description: 'Social-media-ready product campaign with lifestyle photography and bold claims',
    accentColor: '#10b981',
    promptPrefix: 'Ultra-realistic premium product advertisement poster. Luxury lifestyle photography, clean modern layout, bold claim typography, social-media-ready vertical composition, studio lighting with dramatic highlights.',
  },
  {
    key: 'music',
    label: 'Music / Concert',
    description: 'Gen-Z tech-fashion editorial with neon, collage and urban culture energy',
    accentColor: '#8b5cf6',
    promptPrefix: 'High-impact music/concert campaign poster. Gen-Z tech-fashion editorial style, neon energy effects, handcrafted mixed-media collage, futuristic urban branding, explosive cinematic composition.',
  },
  {
    key: 'custom',
    label: 'Custom Style',
    description: 'Write your own prompt — AI will enhance it into a detailed poster brief',
    accentColor: '#64748b',
    promptPrefix: '',
  },
];

const SIZES = [
  { label: 'Portrait (9:16)', value: '1024x1536' as const, hint: 'Instagram / print poster' },
  { label: 'Square (1:1)', value: '1024x1024' as const, hint: 'Social media post' },
  { label: 'Landscape (16:9)', value: '1536x1024' as const, hint: 'Banner / display' },
];

async function callPosterFunction(prompt: string, size: string, heroImageB64?: string, heroMediaType?: string): Promise<{ b64: string; mediaType: string }> {
  const res = await fetch(POSTER_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ prompt, size, heroImageB64, heroMediaType }),
  });
  if (!res.ok) {
    let msg = `Poster generation failed (HTTP ${res.status})`;
    try { const e = await res.json(); msg = (e as { error?: string })?.error ?? msg; } catch { /* noop */ }
    throw new Error(msg);
  }
  const data = await res.json() as { b64?: string; mediaType?: string; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.b64) throw new Error('No image returned.');
  return { b64: data.b64, mediaType: data.mediaType ?? 'image/png' };
}

function fileToBase64(file: File): Promise<{ b64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      const b64 = result.slice(commaIdx + 1);
      resolve({ b64, mediaType: file.type });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function PosterGeneratorModal({ onClose }: Props) {
  const { getKey } = useCredentials();
  const { activeProvider, activeModel, notifyArtifactGenerated } = useAppStore();
  const db = useDb();

  const [styleKey, setStyleKey] = useState('advertising');
  const [userIntent, setUserIntent] = useState('');
  const [enhancedPrompt, setEnhancedPrompt] = useState('');
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [size, setSize] = useState<'1024x1024' | '1536x1024' | '1024x1536'>('1024x1536');
  const [heroFile, setHeroFile] = useState<{ b64: string; mediaType: string; name: string } | null>(null);

  const [stage, setStage] = useState<Stage>('form');
  const [error, setError] = useState('');
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [imageMediaType, setImageMediaType] = useState('image/png');
  const [saved, setSaved] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentStyle = POSTER_STYLES.find(s => s.key === styleKey)!;

  const handleHeroUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await fileToBase64(file);
      setHeroFile({ ...result, name: file.name });
    } catch {
      setError('Failed to load image.');
    }
    e.target.value = '';
  };

  const buildSystemPrompt = () =>
    `You are a world-class creative director specializing in hyper-detailed AI image generation prompts for gpt-image-2.
Your job is to expand a user's brief into a single, rich, detailed prompt (200-400 words) that will produce a stunning, publication-ready poster.
Include: composition details, lighting, typography style, color palette, mood, texture, camera angle, and any relevant brand/cultural references.
Output ONLY the prompt text — no headings, no explanation, no markdown.`;

  const handleEnhance = async () => {
    const llmKey = getKey(activeProvider);
    if (!llmKey) { setError(`No ${activeProvider} API key.`); setStage('error'); return; }
    if (!userIntent.trim()) { setError('Please describe what you want on your poster.'); setStage('error'); return; }

    setStage('enhancing');
    try {
      const styleContext = currentStyle.key !== 'custom' ? `Style context: ${currentStyle.label} — ${currentStyle.description}.\nStyle prefix: ${currentStyle.promptPrefix}\n\n` : '';
      const heroContext = heroFile ? 'The user has uploaded a hero photo of a real person that must be incorporated into the poster as the central subject. Describe how to integrate their face/appearance naturally.\n\n' : '';

      const { text } = await complete({
        provider: activeProvider,
        model: activeModel,
        apiKey: llmKey,
        system: buildSystemPrompt(),
        messages: [{
          role: 'user',
          content: `${styleContext}${heroContext}User's poster brief: "${userIntent.trim()}"\n\nExpand this into a detailed image generation prompt.`,
        }],
        maxTokens: 1000,
        temperature: 0.8,
      });

      setEnhancedPrompt(text.trim());
      setStage('form');
    } catch (e) {
      setError((e as Error).message);
      setStage('error');
    }
  };

  const handleGenerate = async () => {
    const openaiKey = getKey('openai');
    if (!openaiKey) { setError('Poster generation requires an OpenAI API key. Add one in Settings.'); setStage('error'); return; }

    const finalPrompt = enhancedPrompt.trim() || (currentStyle.key !== 'custom' && userIntent.trim()
      ? `${currentStyle.promptPrefix}\n\n${userIntent.trim()}`
      : userIntent.trim());

    if (!finalPrompt) { setError('Please describe your poster first.'); setStage('error'); return; }

    setStage('generating');
    try {
      const { b64, mediaType } = await callPosterFunction(
        finalPrompt, size,
        heroFile?.b64,
        heroFile?.mediaType,
      );

      setImageB64(b64);
      setImageMediaType(mediaType);

      const savedArtifact = await artifactsRepo.create(db, {
        type: 'image',
        title: userIntent.trim().slice(0, 80) || 'Poster',
        data: b64,
        mediaType,
        meta: {
          prompt: finalPrompt,
          style: styleKey,
          size,
          hasHero: !!heroFile,
          generatedAt: Date.now(),
          provider: 'openai',
          model: 'gpt-image-2',
          category: 'poster',
        },
      });
      notifyArtifactGenerated(savedArtifact.id);
      setSaved(true);
      setStage('preview');
    } catch (e) {
      setError((e as Error).message);
      setStage('error');
    }
  };

  const handleReset = () => {
    setImageB64(null); setSaved(false); setEnhancedPrompt('');
    setError(''); setStage('form');
  };

  const handleDownload = () => {
    if (!imageB64) return;
    const ext = imageMediaType.includes('png') ? 'png' : 'jpg';
    const a = document.createElement('a');
    a.href = `data:${imageMediaType};base64,${imageB64}`;
    a.download = `poster_${Date.now()}.${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const promptReady = enhancedPrompt.trim() || userIntent.trim();

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl h-[92vh] bg-bg-panel border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-btn bg-bg-panel border border-border">
              <Layers size={16} className="text-accent-amber" />
            </div>
            <div>
              <h2 className="font-orbitron font-bold text-text-primary text-sm tracking-wide uppercase">Poster Generator</h2>
              <p className="font-mono text-[10px] text-text-dim tracking-wider">GPT-IMAGE-2 · CAMPAIGN POSTERS · HIGH QUALITY</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">

          {/* Form stage */}
          {(stage === 'form') && (
            <div className="p-5 space-y-6 max-w-4xl mx-auto">

              {/* Style picker */}
              <div>
                <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-2">
                  Poster Style
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {POSTER_STYLES.map(s => (
                    <button
                      key={s.key}
                      onClick={() => setStyleKey(s.key)}
                      className={clsx(
                        'text-left p-3 rounded-btn border transition-all',
                        s.key === styleKey
                          ? 'border-accent-amber bg-accent-amber/10'
                          : 'border-border hover:border-text-dim bg-bg-elevated',
                      )}
                    >
                      <div
                        className="w-3 h-3 rounded-full mb-2"
                        style={{ backgroundColor: s.accentColor }}
                      />
                      <div className={clsx('font-rajdhani font-bold text-xs', s.key === styleKey ? 'text-accent-amber' : 'text-text-primary')}>
                        {s.label}
                      </div>
                      <div className="text-[10px] text-text-dim mt-0.5 leading-tight">{s.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Poster brief */}
              <div>
                <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-1.5">
                  Describe your poster <span className="text-accent-amber">*</span>
                </label>
                <textarea
                  value={userIntent}
                  onChange={e => setUserIntent(e.target.value)}
                  rows={3}
                  placeholder={
                    styleKey === 'advertising' ? 'e.g. North Face winter jacket campaign with a person standing on a snowy mountain peak' :
                    styleKey === 'fashion' ? 'e.g. Urban streetwear brand drop featuring two models in a city at night' :
                    styleKey === 'anime' ? 'e.g. Anime duo poster of Goku and a real person side by side in techwear' :
                    styleKey === 'product' ? 'e.g. Premium smoothie drink launch — berry flavour, clean minimal look' :
                    styleKey === 'music' ? 'e.g. Sony headphones campaign for a Gen Z tech-fashion music festival' :
                    'Describe exactly what you want on the poster in as much detail as you like...'
                  }
                  className="input"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={handleEnhance}
                    disabled={!userIntent.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn border border-accent-amber text-accent-amber text-[11px] font-rajdhani font-semibold uppercase tracking-wider hover:bg-accent-amber/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <Wand2 size={12} /> Enhance with AI
                  </button>
                  <span className="text-[10px] text-text-dim">AI expands your brief into a detailed prompt</span>
                </div>
              </div>

              {/* Enhanced prompt editor */}
              {enhancedPrompt && (
                <div className="border border-border rounded-btn bg-bg-elevated overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Sparkles size={11} className="text-accent-amber" />
                      <span className="text-[10px] font-mono text-text-dim tracking-widest">AI-ENHANCED PROMPT</span>
                    </div>
                    <button
                      onClick={() => setEditingPrompt(p => !p)}
                      className={clsx('text-[10px] font-mono px-2 py-0.5 rounded transition-colors', editingPrompt ? 'text-accent-amber bg-accent-amber/10' : 'text-text-dim hover:text-accent-amber')}
                    >
                      {editingPrompt ? 'Done' : 'Edit'}
                    </button>
                  </div>
                  {editingPrompt ? (
                    <textarea
                      value={enhancedPrompt}
                      onChange={e => setEnhancedPrompt(e.target.value)}
                      rows={6}
                      className="w-full p-3 bg-transparent text-xs font-mono text-text-primary resize-none focus:outline-none"
                    />
                  ) : (
                    <p className="p-3 text-xs font-mono text-text-secondary leading-relaxed line-clamp-5">{enhancedPrompt}</p>
                  )}
                </div>
              )}

              {/* Hero picture + size */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Hero picture upload */}
                <div>
                  <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-1.5">
                    Hero Picture <span className="text-text-dim font-normal normal-case">(optional)</span>
                  </label>
                  <p className="text-[10px] text-text-dim mb-2">Upload a photo of a person to be incorporated into the poster as the central subject.</p>
                  {heroFile ? (
                    <div className="flex items-center gap-3 p-3 border border-border rounded-btn bg-bg-elevated">
                      <div className="p-2 rounded-btn border border-border bg-bg-panel">
                        <User size={16} className="text-accent-cyan" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-text-primary truncate">{heroFile.name}</div>
                        <div className="text-[10px] text-text-dim">Hero photo loaded</div>
                      </div>
                      <button
                        onClick={() => setHeroFile(null)}
                        className="p-1.5 rounded-btn text-text-dim hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex flex-col items-center gap-2 p-4 rounded-btn border border-dashed border-border hover:border-accent-cyan hover:bg-accent-cyan/5 transition-all text-text-dim"
                    >
                      <Upload size={20} />
                      <span className="text-[11px] font-rajdhani font-semibold uppercase tracking-wider">Upload photo</span>
                      <span className="text-[10px]">JPG or PNG</span>
                    </button>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleHeroUpload} />
                </div>

                {/* Size picker */}
                <div>
                  <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-1.5">
                    Size
                  </label>
                  <div className="space-y-2">
                    {SIZES.map(s => (
                      <button
                        key={s.value}
                        onClick={() => setSize(s.value)}
                        className={clsx(
                          'w-full flex items-center justify-between px-3 py-2.5 rounded-btn border text-left transition-colors',
                          s.value === size ? 'border-accent-amber bg-accent-amber/10' : 'border-border hover:border-text-dim',
                        )}
                      >
                        <span className={clsx('font-rajdhani font-bold text-sm', s.value === size ? 'text-accent-amber' : 'text-text-primary')}>
                          {s.label}
                        </span>
                        <span className="text-[10px] text-text-dim">{s.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Enhancing stage */}
          {stage === 'enhancing' && (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[400px]">
              <Loader2 size={40} className="text-accent-amber animate-spin" />
              <div className="font-rajdhani font-bold text-lg text-text-primary">Crafting your poster brief...</div>
              <p className="text-xs text-text-dim font-mono">AI is expanding your idea into a detailed prompt</p>
            </div>
          )}

          {/* Generating stage */}
          {stage === 'generating' && (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[400px]">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-accent-amber/20 rounded-full" />
                <div className="absolute inset-0 w-16 h-16 border-4 border-accent-amber border-t-transparent rounded-full animate-spin" />
                <Sparkles size={20} className="absolute inset-0 m-auto text-accent-amber" />
              </div>
              <div className="font-rajdhani font-bold text-lg text-text-primary">Generating your poster...</div>
              <p className="text-xs text-text-dim font-mono max-w-sm">
                {heroFile ? 'Compositing hero photo into poster design...' : 'GPT Image 2 is rendering your design...'}
              </p>
              <p className="text-[10px] text-text-dim font-mono">This may take 20–40 seconds</p>
            </div>
          )}

          {/* Error stage */}
          {stage === 'error' && (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[400px]">
              <div className="p-3 rounded-full bg-red-500/10 border border-red-500/30">
                <AlertCircle size={32} className="text-red-400" />
              </div>
              <h3 className="font-rajdhani font-bold text-lg text-text-primary">Generation failed</h3>
              <p className="text-xs text-text-secondary max-w-md font-mono whitespace-pre-wrap">{error}</p>
              <button onClick={handleReset} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">
                Back
              </button>
            </div>
          )}

          {/* Preview stage */}
          {stage === 'preview' && imageB64 && (
            <div className="flex-1 flex flex-col p-5 gap-4 min-h-0">
              <div className="flex-1 min-h-0 flex items-center justify-center border border-border rounded-btn overflow-hidden bg-neutral-900">
                <img
                  src={`data:${imageMediaType};base64,${imageB64}`}
                  alt="Generated poster"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="shrink-0 border border-border rounded-btn bg-bg-elevated overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                  <Wand2 size={11} className="text-accent-amber" />
                  <span className="text-[10px] font-mono text-text-dim tracking-widest">PROMPT USED</span>
                </div>
                <p className="p-3 text-xs font-mono text-text-secondary line-clamp-3">
                  {enhancedPrompt || userIntent}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border bg-bg-elevated gap-3">
          <div className="font-mono text-[10px] text-text-dim tracking-wider">
            {stage === 'preview' && saved && (
              <span className="flex items-center gap-1.5 text-accent-green"><CheckCircle2 size={11} /> SAVED TO LIBRARY</span>
            )}
            {stage === 'form' && (
              <span className="flex items-center gap-1">
                <ImageIcon size={11} className="text-accent-amber" />
                <span className="ml-1">GPT IMAGE 2 · PORTRAIT / SQUARE / LANDSCAPE</span>
              </span>
            )}
            {stage === 'generating' && 'GENERATING...'}
            {stage === 'enhancing' && 'ENHANCING PROMPT...'}
          </div>
          <div className="flex items-center gap-2">
            {stage === 'form' && (
              <>
                <button onClick={onClose} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!promptReady}
                  className="px-4 py-2 rounded-btn bg-accent-amber text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                >
                  <Sparkles size={13} /> Generate Poster
                </button>
              </>
            )}
            {stage === 'preview' && (
              <>
                <button onClick={handleReset} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5">
                  <RotateCcw size={13} /> New
                </button>
                <button
                  onClick={handleDownload}
                  className="px-3 py-2 rounded-btn bg-accent-amber text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-1.5"
                >
                  <Download size={13} /> Download
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
