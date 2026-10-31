import { useState } from 'react';
import {
  X, Loader2, Sparkles, AlertCircle, CheckCircle2,
  FileType2, Download, Target, Code2, Plus, Trash2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../../contexts/CredentialsContext';
import { useAppStore } from '../../store/appStore';
import { useDb } from '../../db/DbContext';
import { artifactsRepo } from '../../db/repos';
import { complete } from '../../lib/llm';
import {
  buildRubricPrompt, parseRubricJson, STYLE_LABELS, STYLE_DESCRIPTIONS,
  type Rubric, type RubricRequest, type RubricStyle,
} from '../../lib/studio/rubricSchema';
import {
  buildRubricPdf, buildRubricDocx,
  downloadBase64Pdf, downloadBase64Docx,
} from '../../lib/studio/rubricBuilders';

type Stage = 'form' | 'generating' | 'preview' | 'error';

interface Props { onClose: () => void; seed?: { topic?: string; yearLevel?: string; objectives?: string[] } }

const YEAR_LEVELS = ['','Prep','Year 1','Year 2','Year 3','Year 4','Year 5','Year 6','Year 7','Year 8','Year 9','Year 10','Year 11','Year 12'];
const STYLES: RubricStyle[] = ['analytic', 'holistic', 'single_point'];

export function RubricGeneratorModal({ onClose, seed }: Props) {
  const { getKey } = useCredentials();
  const { activeProvider, activeModel, notifyArtifactGenerated } = useAppStore();
  const db = useDb();

  const [task, setTask] = useState(seed?.topic ?? '');
  const [yearLevel, setYearLevel] = useState(seed?.yearLevel ?? 'Year 9');
  const [style, setStyle] = useState<RubricStyle>('analytic');
  const [criteriaCount, setCriteriaCount] = useState(4);
  const [levelCount, setLevelCount] = useState(4);
  const [maxScore, setMaxScore] = useState<number | ''>(20);
  const [curriculumStandard, setCurriculumStandard] = useState('');
  const [objectives, setObjectives] = useState<string[]>(seed?.objectives?.length ? seed.objectives : ['']);
  const [notes, setNotes] = useState('');

  const [state, setState] = useState<{ stage: Stage; step?: string; error?: string }>({ stage: 'form' });
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [pdfB64, setPdfB64] = useState<string | null>(null);
  const [docxB64, setDocxB64] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');
  const [saved, setSaved] = useState(false);

  const handleGenerate = async () => {
    const apiKey = getKey(activeProvider);
    if (!apiKey) { setState({ stage: 'error', error: `No ${activeProvider} API key.` }); return; }
    if (!task.trim()) { setState({ stage: 'error', error: 'Task description is required.' }); return; }

    const req: RubricRequest = {
      task: task.trim(), yearLevel: yearLevel || undefined, style, criteriaCount, levelCount,
      maxScore: typeof maxScore === 'number' ? maxScore : 20,
      objectives: objectives.filter(Boolean),
      curriculumStandard: curriculumStandard.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    const prompt = buildRubricPrompt(req);
    setLastPrompt(prompt);
    setState({ stage: 'generating', step: 'Drafting rubric...' });

    try {
      const { text } = await complete({ provider: activeProvider, model: activeModel, apiKey, system: 'You are an expert teacher. Output ONLY valid JSON — no prose, no fences.', messages: [{ role: 'user', content: prompt }], maxTokens: 6000, temperature: 0.4 });
      let parsed: Rubric;
      try { parsed = parseRubricJson(text); } catch (e) { throw new Error(`Failed to parse rubric JSON: ${(e as Error).message}`); }

      setState({ stage: 'generating', step: 'Building PDF and DOCX...' });
      const [pdf, docx] = await Promise.all([buildRubricPdf(parsed), buildRubricDocx(parsed)]);

      const savedArtifact = await artifactsRepo.create(db, {
        type: 'rubric', title: parsed.title || task.trim(), data: pdf, mediaType: 'application/pdf',
        meta: { task: parsed.task, yearLevel: parsed.yearLevel, style: parsed.style, maxScore: parsed.maxScore, criteriaCount: parsed.criteria.length, rubric: parsed, docxBase64: docx, generatedAt: Date.now(), provider: activeProvider, model: activeModel },
      });
      notifyArtifactGenerated(savedArtifact.id);

      setRubric(parsed); setPdfB64(pdf); setDocxB64(docx); setSaved(true);
      setState({ stage: 'preview' });
    } catch (e) { setState({ stage: 'error', error: (e as Error).message }); }
  };

  const handleReset = () => { setRubric(null); setPdfB64(null); setDocxB64(null); setSaved(false); setState({ stage: 'form' }); };
  const dn = () => (rubric?.title ?? task).replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'rubric';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-5xl h-[92vh] bg-bg-panel border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-btn bg-bg-panel border border-border"><Target size={16} className="text-accent-green" /></div>
            <div>
              <h2 className="font-orbitron font-bold text-text-primary text-sm tracking-wide uppercase">Rubric Generator</h2>
              <p className="font-mono text-[10px] text-text-dim tracking-wider">ANALYTIC · HOLISTIC · SINGLE-POINT · PDF · DOCX</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {state.stage === 'preview' && <button onClick={() => setShowPrompt((s) => !s)} className="px-2 py-1 rounded-btn border border-border text-[10px] font-mono text-text-dim hover:text-accent-cyan hover:border-accent-cyan transition-colors flex items-center gap-1"><Code2 size={11} />{showPrompt ? 'Hide' : 'View'} prompt</button>}
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan transition-colors"><X size={16} /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {showPrompt && <div className="shrink-0 border-b border-border bg-bg-elevated max-h-40 overflow-y-auto p-3"><pre className="text-[10px] font-mono text-text-secondary whitespace-pre-wrap">{lastPrompt}</pre></div>}

          {state.stage === 'form' && (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <Field label="Assessment task" required>
                    <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={3} placeholder="e.g. Persuasive essay arguing for or against school uniforms" className="input" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Year level">
                      <select value={yearLevel} onChange={(e) => setYearLevel(e.target.value)} className="input">{YEAR_LEVELS.map((y) => <option key={y || 'none'} value={y}>{y || '— none —'}</option>)}</select>
                    </Field>
                    <Field label="Max score">
                      <input type="number" min={1} max={200} value={maxScore} onChange={(e) => setMaxScore(e.target.value === '' ? '' : Number(e.target.value))} className="input" />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Criteria count"><input type="number" min={1} max={10} value={criteriaCount} onChange={(e) => setCriteriaCount(Math.max(1, Math.min(10, Number(e.target.value) || 4)))} className="input" /></Field>
                    <Field label="Level count"><input type="number" min={2} max={6} value={levelCount} onChange={(e) => setLevelCount(Math.max(2, Math.min(6, Number(e.target.value) || 4)))} className="input" /></Field>
                  </div>
                  <Field label="Curriculum (optional)">
                    <input type="text" value={curriculumStandard} onChange={(e) => setCurriculumStandard(e.target.value)} placeholder="e.g. VCELA462" className="input" />
                  </Field>
                  <Field label="Notes (optional)">
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. Focus on argument structure. Include citation accuracy criterion." className="input" />
                  </Field>
                </div>
                <div className="space-y-4">
                  <Field label="Rubric style">
                    <div className="space-y-2">
                      {STYLES.map((s) => (
                        <button key={s} onClick={() => setStyle(s)} className={clsx('w-full p-3 rounded-btn border text-left transition-colors', s === style ? 'border-accent-green bg-accent-green/10' : 'border-border hover:border-text-dim')}>
                          <div className={clsx('font-rajdhani font-bold text-sm', s === style ? 'text-accent-green' : 'text-text-primary')}>{STYLE_LABELS[s]}</div>
                          <div className="text-[10px] text-text-dim mt-0.5">{STYLE_DESCRIPTIONS[s]}</div>
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Learning objectives (optional)" hint="Auto-fills criteria if provided.">
                    <div className="space-y-2">
                      {objectives.map((o, i) => (
                        <div key={i} className="flex gap-2">
                          <input type="text" value={o} onChange={(e) => setObjectives((arr) => arr.map((x, j) => j === i ? e.target.value : x))} placeholder={`Objective ${i + 1}`} className="input flex-1" />
                          {objectives.length > 1 && <button onClick={() => setObjectives((arr) => arr.filter((_, j) => j !== i))} className="p-2 rounded-btn border border-border text-text-dim hover:text-red-400 hover:border-red-400 transition-colors"><Trash2 size={13} /></button>}
                        </div>
                      ))}
                      <button onClick={() => setObjectives((a) => [...a, ''])} className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn border border-border text-text-dim hover:text-accent-green hover:border-accent-green text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors"><Plus size={12} />Add</button>
                    </div>
                  </Field>
                </div>
              </div>
            </div>
          )}

          {state.stage === 'generating' && <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center"><Loader2 size={48} className="text-accent-green animate-spin" /><div className="font-rajdhani font-bold text-lg text-text-primary">{state.step}</div></div>}
          {state.stage === 'error' && <ErrStage error={state.error ?? ''} onRetry={handleReset} />}

          {state.stage === 'preview' && rubric && (
            <div className="flex-1 min-h-0 flex flex-col p-5 gap-3">
              {pdfB64 && <iframe title="Rubric PDF" src={`data:application/pdf;base64,${pdfB64}`} className="flex-1 min-h-0 border border-border rounded-btn bg-white" />}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border bg-bg-elevated gap-3">
          <div className="font-mono text-[10px] text-text-dim tracking-wider">
            {state.stage === 'preview' && saved && <span className="flex items-center gap-1.5 text-accent-green"><CheckCircle2 size={11} />SAVED TO LIBRARY</span>}
            {state.stage === 'form' && 'CONFIGURE RUBRIC'}
            {state.stage === 'generating' && 'WORKING...'}
          </div>
          <div className="flex items-center gap-2">
            {state.stage === 'form' && (<>
              <button onClick={onClose} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Cancel</button>
              <button onClick={handleGenerate} disabled={!task.trim()} className="px-4 py-2 rounded-btn bg-accent-green text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 transition-all flex items-center gap-2"><Sparkles size={13} />Generate</button>
            </>)}
            {state.stage === 'preview' && rubric && (<>
              <button onClick={handleReset} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">New</button>
              {docxB64 && <button onClick={() => downloadBase64Docx(docxB64, `${dn()}.docx`)} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-accent-cyan hover:border-accent-cyan text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"><FileType2 size={13} />.docx</button>}
              {pdfB64 && <button onClick={() => downloadBase64Pdf(pdfB64, `${dn()}.pdf`)} className="px-3 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-1.5"><Download size={13} />.pdf</button>}
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
      <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-1.5">{label}{required && <span className="text-accent-cyan ml-1">*</span>}</label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-text-dim">{hint}</p>}
    </div>
  );
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
