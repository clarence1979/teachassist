import { useState, useRef } from 'react';
import {
  X, Sparkles, AlertCircle, CheckCircle2,
  Download, Image as ImageIcon, RotateCcw, Edit3, Wand2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../../store/appStore';
import { useDb } from '../../db/DbContext';
import { artifactsRepo } from '../../db/repos';
import { generateImage } from '../../lib/studio/imageGen';

type Stage = 'form' | 'generating' | 'preview' | 'error';

interface Props {
  onClose: () => void;
  seed?: { prompt?: string; topic?: string };
}

const USE_CASES = [
  { label: 'Classroom poster', template: 'Educational classroom poster about [topic] for [year level] students. Clear, bold, informative, safe for school.' },
  { label: 'Diagram / illustration', template: 'Educational diagram illustrating [topic]. Clean scientific style, labelled, white background, classroom safe.' },
  { label: 'Label-the-diagram base', template: 'Unlabelled scientific diagram of [topic] for students to label. Clean line drawing, clear structures, white background.' },
  { label: 'Slide illustration', template: 'Concept illustration for a lesson slide about [topic]. Engaging, colourful, modern, classroom appropriate.' },
  { label: 'Custom prompt', template: '' },
];

const ASPECT_RATIOS: { label: string; value: '1:1' | '16:9' | '9:16' }[] = [
  { label: 'Landscape (16:9)', value: '16:9' },
  { label: 'Square (1:1)', value: '1:1' },
  { label: 'Portrait (9:16)', value: '9:16' },
];

export function ImageGeneratorModal({ onClose, seed }: Props) {
  const { notifyArtifactGenerated } = useAppStore();
  const db = useDb();

  const [useCase, setUseCase] = useState(seed?.prompt ? 4 : 0);
  const [prompt, setPrompt] = useState(seed?.prompt ?? '');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16'>('16:9');
  const [editMode, setEditMode] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');

  const [state, setState] = useState<{ stage: Stage; error?: string }>({ stage: 'form' });
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [usedPrompt, setUsedPrompt] = useState('');
  const [saved, setSaved] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const getEffectivePrompt = () => {
    const tmpl = USE_CASES[useCase].template;
    if (!tmpl || useCase === 4) return prompt.trim();
    return prompt.trim()
      ? tmpl.replace('[topic]', prompt).replace('[year level]', 'students')
      : tmpl.replace('[topic]', 'the given subject').replace('[year level]', 'students');
  };

  const handleGenerate = async (overridePrompt?: string) => {
    const finalPrompt = overridePrompt ?? getEffectivePrompt();
    if (!finalPrompt) { setState({ stage: 'error', error: 'Please enter a prompt or topic.' }); return; }

    setState({ stage: 'generating' });
    setUsedPrompt(finalPrompt);
    try {
      const b64 = await generateImage({ prompt: finalPrompt, aspect_ratio: aspectRatio });
      setImageB64(b64);

      const savedArtifact = await artifactsRepo.create(db, {
        type: 'image',
        title: finalPrompt.slice(0, 80),
        data: b64,
        mediaType: 'image/webp',
        meta: { prompt: finalPrompt, aspectRatio, useCase: USE_CASES[useCase].label, generatedAt: Date.now(), provider: 'replicate' },
      });
      notifyArtifactGenerated(savedArtifact.id);
      setSaved(true);
      setState({ stage: 'preview' });
    } catch (e) { setState({ stage: 'error', error: (e as Error).message }); }
  };

  const handleRegenerate = () => {
    setSaved(false);
    handleGenerate(editMode ? editPrompt : undefined);
    setEditMode(false);
  };

  const handleReset = () => { setImageB64(null); setSaved(false); setEditMode(false); setState({ stage: 'form' }); };

  const handleDownload = () => {
    if (!imageB64) return;
    const a = document.createElement('a');
    a.href = `data:image/webp;base64,${imageB64}`;
    a.download = `image_${Date.now()}.webp`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-4xl h-[88vh] bg-bg-panel border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-btn bg-bg-panel border border-border"><ImageIcon size={16} className="text-accent-cyan" /></div>
            <div>
              <h2 className="font-orbitron font-bold text-text-primary text-sm tracking-wide uppercase">AI Image Generator</h2>
              <p className="font-mono text-[10px] text-text-dim tracking-wider">AI IMAGE · WEBP · CLASSROOM SAFE</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan transition-colors"><X size={16} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {state.stage === 'form' && (
            <div className="p-5 space-y-5">
              <div>
                <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-2">Use case</label>
                <div className="flex flex-wrap gap-2">
                  {USE_CASES.map((uc, i) => (
                    <button key={i} onClick={() => setUseCase(i)} className={clsx('px-3 py-1.5 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', i === useCase ? 'border-accent-cyan text-accent-cyan bg-bg-elevated' : 'border-border text-text-secondary hover:border-text-dim')}>
                      {uc.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-1.5">
                  {useCase < 4 ? 'Topic / subject' : 'Custom prompt'}
                </label>
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={useCase === 4 ? 4 : 2}
                  placeholder={useCase === 4 ? 'Describe the image you want in detail...' : 'e.g. the water cycle, Year 7 science'}
                  className="input"
                />
                {useCase < 4 && USE_CASES[useCase].template && (
                  <p className="mt-1 text-[10px] text-text-dim font-mono">
                    Template: {USE_CASES[useCase].template.replace('[topic]', prompt.trim() || '…').replace('[year level]', 'students')}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-2">Aspect ratio</label>
                <div className="flex flex-wrap gap-2">
                  {ASPECT_RATIOS.map((ar) => (
                    <button key={ar.value} onClick={() => setAspectRatio(ar.value)} className={clsx('px-3 py-1.5 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', ar.value === aspectRatio ? 'border-accent-cyan text-accent-cyan bg-bg-elevated' : 'border-border text-text-secondary hover:border-text-dim')}>
                      {ar.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {state.stage === 'generating' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-accent-cyan/20 rounded-full" />
                <div className="absolute inset-0 w-16 h-16 border-4 border-accent-cyan border-t-transparent rounded-full animate-spin" />
                <Sparkles size={20} className="absolute inset-0 m-auto text-accent-cyan" />
              </div>
              <div className="font-rajdhani font-bold text-lg text-text-primary">Generating image...</div>
              <p className="text-xs text-text-dim font-mono max-w-sm whitespace-pre-wrap">{usedPrompt.slice(0, 120)}{usedPrompt.length > 120 ? '...' : ''}</p>
            </div>
          )}

          {state.stage === 'error' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="p-3 rounded-full bg-red-500/10 border border-red-500/30"><AlertCircle size={32} className="text-red-400" /></div>
              <h3 className="font-rajdhani font-bold text-lg text-text-primary">Generation failed</h3>
              <p className="text-xs text-text-secondary max-w-md font-mono whitespace-pre-wrap">{state.error}</p>
              <button onClick={handleReset} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Back</button>
            </div>
          )}

          {state.stage === 'preview' && imageB64 && (
            <div className="flex-1 flex flex-col p-5 gap-4 min-h-0">
              <div className="flex-1 min-h-0 flex items-center justify-center border border-border rounded-btn overflow-hidden bg-white">
                <img src={`data:image/webp;base64,${imageB64}`} alt="Generated" className="max-w-full max-h-full object-contain" />
              </div>

              <div className="shrink-0 border border-border rounded-btn bg-bg-elevated overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Wand2 size={12} className="text-accent-cyan" />
                    <span className="text-[10px] font-mono text-text-dim tracking-widest">USED PROMPT</span>
                  </div>
                  <button onClick={() => { setEditMode((e) => !e); setEditPrompt(usedPrompt); }} className={clsx('flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors', editMode ? 'text-accent-cyan bg-accent-cyan/10' : 'text-text-dim hover:text-accent-cyan')}>
                    <Edit3 size={11} />{editMode ? 'Editing' : 'Edit'}
                  </button>
                </div>
                {editMode ? (
                  <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={3} className="w-full p-3 bg-transparent text-xs font-mono text-text-primary resize-none focus:outline-none" />
                ) : (
                  <p className="p-3 text-xs font-mono text-text-secondary">{usedPrompt}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border bg-bg-elevated gap-3">
          <div className="font-mono text-[10px] text-text-dim tracking-wider">
            {state.stage === 'preview' && saved && <span className="flex items-center gap-1.5 text-accent-green"><CheckCircle2 size={11} />SAVED TO LIBRARY</span>}
            {state.stage === 'form' && 'READY'}
            {state.stage === 'generating' && 'GENERATING...'}
          </div>
          <div className="flex items-center gap-2">
            {state.stage === 'form' && (<>
              <button onClick={onClose} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Cancel</button>
              <button onClick={() => handleGenerate()} disabled={!prompt.trim() && useCase === 4} className="px-4 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 transition-all flex items-center gap-2"><Sparkles size={13} />Generate</button>
            </>)}
            {state.stage === 'preview' && (<>
              <button onClick={handleReset} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"><RotateCcw size={13} />New</button>
              <button onClick={handleRegenerate} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-accent-amber hover:border-accent-amber text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5">
                <Sparkles size={13} />{editMode ? 'Regenerate with edit' : 'Regenerate'}
              </button>
              <button onClick={handleDownload} className="px-3 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-1.5"><Download size={13} />.webp</button>
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
