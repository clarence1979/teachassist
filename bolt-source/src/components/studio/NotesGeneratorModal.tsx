import { useState } from 'react';
import {
  X, Loader2, Sparkles, AlertCircle, CheckCircle2,
  FileText, FileType2, Download, BookOpen, Code2, Eye,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../../contexts/CredentialsContext';
import { useAppStore } from '../../store/appStore';
import { useDb } from '../../db/DbContext';
import { artifactsRepo } from '../../db/repos';
import { complete } from '../../lib/llm';
import {
  buildNotesPrompt, parseNotesJson, DEPTH_LABELS,
  type StudentNotes, type NotesRequest, type NotesDepth,
} from '../../lib/studio/notesSchema';
import {
  buildNotesPdf, buildNotesDocx, buildNotesMd,
  downloadBase64Pdf, downloadBase64Docx, downloadText,
} from '../../lib/studio/notesBuilders';

type Stage = 'form' | 'generating' | 'preview' | 'error';
type OutputTab = 'html' | 'pdf';

interface Props { onClose: () => void; seed?: { topic?: string; yearLevel?: string } }

const YEAR_LEVELS = ['Prep','Year 1','Year 2','Year 3','Year 4','Year 5','Year 6','Year 7','Year 8','Year 9','Year 10','Year 11','Year 12','Undergraduate'];
const DEPTHS: NotesDepth[] = ['overview', 'standard', 'detailed'];

export function NotesGeneratorModal({ onClose, seed }: Props) {
  const { getKey } = useCredentials();
  const { activeProvider, activeModel, notifyArtifactGenerated } = useAppStore();
  const db = useDb();

  const [topic, setTopic] = useState(seed?.topic ?? '');
  const [yearLevel, setYearLevel] = useState(seed?.yearLevel ?? 'Year 9');
  const [depth, setDepth] = useState<NotesDepth>('standard');
  const [includeDiagrams, setIncludeDiagrams] = useState(false);
  const [includeGlossary, setIncludeGlossary] = useState(true);
  const [includeSelfCheck, setIncludeSelfCheck] = useState(true);
  const [curriculumStandard, setCurriculumStandard] = useState('');
  const [notes, setNotes] = useState('');

  const [state, setState] = useState<{ stage: Stage; step?: string; error?: string }>({ stage: 'form' });
  const [studentNotes, setStudentNotes] = useState<StudentNotes | null>(null);
  const [pdfB64, setPdfB64] = useState<string | null>(null);
  const [docxB64, setDocxB64] = useState<string | null>(null);
  const [mdText, setMdText] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OutputTab>('html');
  const [showPrompt, setShowPrompt] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');
  const [saved, setSaved] = useState(false);

  const handleGenerate = async () => {
    const apiKey = getKey(activeProvider);
    if (!apiKey) { setState({ stage: 'error', error: `No ${activeProvider} API key.` }); return; }
    if (!topic.trim()) { setState({ stage: 'error', error: 'Topic is required.' }); return; }

    const req: NotesRequest = {
      topic: topic.trim(), yearLevel, depth,
      includeDiagrams, includeGlossary, includeSelfCheck,
      curriculumStandard: curriculumStandard.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    const prompt = buildNotesPrompt(req);
    setLastPrompt(prompt);
    setState({ stage: 'generating', step: 'Drafting student notes...' });

    try {
      const { text } = await complete({ provider: activeProvider, model: activeModel, apiKey, system: 'You are an expert teacher. Output ONLY valid JSON — no prose, no fences.', messages: [{ role: 'user', content: prompt }], maxTokens: 10000, temperature: 0.4 });
      let parsed: StudentNotes;
      try { parsed = parseNotesJson(text); } catch (e) { throw new Error(`Failed to parse notes JSON: ${(e as Error).message}`); }

      setState({ stage: 'generating', step: 'Building exports...' });
      const [pdf, docx, md] = await Promise.all([buildNotesPdf(parsed), buildNotesDocx(parsed), Promise.resolve(buildNotesMd(parsed))]);

      const savedArtifact = await artifactsRepo.create(db, {
        type: 'notes', title: parsed.title || topic.trim(), data: pdf, mediaType: 'application/pdf',
        meta: { topic: parsed.topic, yearLevel: parsed.yearLevel, depth, includeGlossary, includeSelfCheck, notes: parsed, docxBase64: docx, mdText: md, generatedAt: Date.now(), provider: activeProvider, model: activeModel },
      });
      notifyArtifactGenerated(savedArtifact.id);

      setStudentNotes(parsed); setPdfB64(pdf); setDocxB64(docx); setMdText(md);
      setSaved(true); setState({ stage: 'preview' });
    } catch (e) { setState({ stage: 'error', error: (e as Error).message }); }
  };

  const handleReset = () => { setStudentNotes(null); setPdfB64(null); setDocxB64(null); setMdText(null); setSaved(false); setState({ stage: 'form' }); };
  const dn = () => (studentNotes?.title ?? topic).replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'notes';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-5xl h-[90vh] bg-bg-panel border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-btn bg-bg-panel border border-border"><BookOpen size={16} className="text-accent-amber" /></div>
            <div>
              <h2 className="font-orbitron font-bold text-text-primary text-sm tracking-wide uppercase">Student Notes Generator</h2>
              <p className="font-mono text-[10px] text-text-dim tracking-wider">PDF · DOCX · MARKDOWN · HTML READER</p>
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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <Field label="Topic" required><input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Cell division and mitosis" className="input" /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Year level"><select value={yearLevel} onChange={(e) => setYearLevel(e.target.value)} className="input">{YEAR_LEVELS.map((y) => <option key={y}>{y}</option>)}</select></Field>
                    <Field label="Curriculum (optional)"><input type="text" value={curriculumStandard} onChange={(e) => setCurriculumStandard(e.target.value)} placeholder="e.g. ACSSU149" className="input" /></Field>
                  </div>
                  <Field label="Extra instructions (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="e.g. Include Australian examples. Suitable for remote learners." className="input" /></Field>
                </div>
                <div className="space-y-4">
                  <Field label="Depth" hint="Overview = 2-3 sections, Standard = 4-6, Detailed = 6-10 with sub-sections.">
                    <div className="grid grid-cols-3 gap-2">
                      {DEPTHS.map((d) => (
                        <button key={d} onClick={() => setDepth(d)} className={clsx('p-3 rounded-btn border text-left transition-colors', d === depth ? 'border-accent-amber bg-accent-amber/10' : 'border-border hover:border-text-dim')}>
                          <div className={clsx('font-rajdhani font-bold text-sm', d === depth ? 'text-accent-amber' : 'text-text-primary')}>{DEPTH_LABELS[d]}</div>
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Inclusions">
                    <div className="space-y-2">
                      {([
                        { key: 'diagrams', label: 'Diagrams (ASCII / textual)', value: includeDiagrams, set: setIncludeDiagrams },
                        { key: 'glossary', label: 'Glossary page', value: includeGlossary, set: setIncludeGlossary },
                        { key: 'selfcheck', label: 'Self-check questions', value: includeSelfCheck, set: setIncludeSelfCheck },
                      ] as const).map(({ key, label, value, set }) => (
                        <label key={key} className={clsx('flex items-center gap-3 p-2.5 rounded-btn border cursor-pointer transition-colors', value ? 'border-accent-amber bg-accent-amber/10' : 'border-border hover:border-text-dim')}>
                          <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} className="accent-accent-amber" />
                          <span className="text-xs font-rajdhani font-semibold text-text-primary">{label}</span>
                        </label>
                      ))}
                    </div>
                  </Field>
                </div>
              </div>
            </div>
          )}

          {state.stage === 'generating' && <GenStage step={state.step ?? ''} color="accent-amber" />}
          {state.stage === 'error' && <ErrStage error={state.error ?? ''} onRetry={handleReset} />}

          {state.stage === 'preview' && studentNotes && (
            <>
              <div className="shrink-0 flex border-b border-border bg-bg-elevated">
                {([{ id: 'html', label: 'HTML reader', icon: Eye }, { id: 'pdf', label: 'PDF preview', icon: FileText }] as const).map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => setActiveTab(id)} className={clsx('px-4 py-2 flex items-center gap-2 text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', activeTab === id ? 'text-accent-amber border-b-2 border-accent-amber' : 'text-text-dim hover:text-text-primary')}>
                    <Icon size={13} />{label}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-5">
                {activeTab === 'html' && <HtmlReader notes={studentNotes} />}
                {activeTab === 'pdf' && pdfB64 && <iframe title="PDF" src={`data:application/pdf;base64,${pdfB64}`} className="w-full h-full border border-border rounded-btn bg-white" />}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border bg-bg-elevated gap-3">
          <div className="font-mono text-[10px] text-text-dim tracking-wider">
            {state.stage === 'preview' && saved && <span className="flex items-center gap-1.5 text-accent-green"><CheckCircle2 size={11} />SAVED TO LIBRARY</span>}
            {state.stage === 'form' && 'CONFIGURE NOTES'}
            {state.stage === 'generating' && 'WORKING...'}
          </div>
          <div className="flex items-center gap-2">
            {state.stage === 'form' && (<>
              <button onClick={onClose} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Cancel</button>
              <button onClick={handleGenerate} disabled={!topic.trim()} className="px-4 py-2 rounded-btn bg-accent-amber text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"><Sparkles size={13} />Generate</button>
            </>)}
            {state.stage === 'preview' && studentNotes && (<>
              <button onClick={handleReset} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">New</button>
              {mdText && <button onClick={() => downloadText(mdText, `${dn()}.md`)} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-accent-cyan hover:border-accent-cyan text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"><Code2 size={13} />.md</button>}
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

// ─── HTML reader view ─────────────────────────────────────────────────────────

function HtmlReader({ notes }: { notes: StudentNotes }) {
  const [openSections, setOpenSections] = useState<Set<number>>(new Set(notes.blocks.map((_, i) => i)));
  const toggle = (i: number) => setOpenSections((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="p-4 border border-border rounded-btn bg-bg-elevated">
        <h1 className="font-orbitron font-bold text-xl text-text-primary mb-1">{notes.title}</h1>
        <p className="text-xs font-mono text-text-dim">{notes.yearLevel}  ·  {DEPTH_LABELS[notes.depth]}</p>
      </div>
      {notes.objectives?.length && (
        <div className="p-4 border border-accent-cyan/30 bg-accent-cyan/5 rounded-btn">
          <div className="text-[10px] font-mono tracking-widest text-accent-cyan mb-2">LEARNING OBJECTIVES</div>
          <ul className="space-y-1">{notes.objectives.map((o, i) => <li key={i} className="text-sm text-text-primary flex gap-2"><span className="text-accent-cyan font-mono">{i + 1}.</span>{o}</li>)}</ul>
        </div>
      )}
      {notes.blocks.map((block, bi) => (
        <div key={bi} className="border border-border rounded-btn overflow-hidden">
          <button onClick={() => toggle(bi)} className="w-full flex items-center justify-between px-4 py-3 bg-bg-elevated hover:bg-bg-panel transition-colors text-left">
            <h2 className="font-rajdhani font-bold text-base text-text-primary">{block.heading}</h2>
            <span className="text-text-dim font-mono text-xs">{openSections.has(bi) ? '▲' : '▼'}</span>
          </button>
          {openSections.has(bi) && (
            <div className="p-4 space-y-3 bg-bg-panel">
              {block.paragraphs?.map((p, i) => <p key={i} className="text-sm text-text-secondary leading-relaxed">{p}</p>)}
              {block.bullets && <ul className="space-y-1">{block.bullets.map((b, i) => <li key={i} className="text-sm text-text-primary flex gap-2"><span className="text-accent-cyan">•</span>{b}</li>)}</ul>}
              {block.example && <div className="p-3 bg-bg-elevated border border-border rounded-btn"><div className="text-[10px] font-mono text-accent-cyan mb-2 tracking-widest">WORKED EXAMPLE</div><pre className="text-xs font-mono text-text-primary whitespace-pre-wrap">{block.example}</pre></div>}
              {block.diagram && <div className="p-3 bg-bg-elevated border border-border rounded-btn"><div className="text-[10px] font-mono text-accent-cyan mb-2 tracking-widest">DIAGRAM</div><pre className="text-xs font-mono text-text-secondary whitespace-pre">{block.diagram}</pre></div>}
              {block.callout && (
                <div className={clsx('p-3 rounded-btn border', block.callout.type === 'tip' ? 'border-accent-green/40 bg-accent-green/5' : block.callout.type === 'warning' ? 'border-accent-amber/40 bg-accent-amber/5' : 'border-accent-cyan/40 bg-accent-cyan/5')}>
                  <div className={clsx('text-[10px] font-mono tracking-widest mb-1', block.callout.type === 'tip' ? 'text-accent-green' : block.callout.type === 'warning' ? 'text-accent-amber' : 'text-accent-cyan')}>{block.callout.type.toUpperCase()}</div>
                  <p className="text-sm text-text-primary">{block.callout.text}</p>
                </div>
              )}
              {block.subSections?.map((ss, si) => (
                <div key={si} className="pl-3 border-l-2 border-border space-y-2">
                  <h3 className="font-rajdhani font-semibold text-sm text-accent-cyan">{ss.heading}</h3>
                  {ss.paragraphs.map((pp, i) => <p key={i} className="text-sm text-text-secondary">{pp}</p>)}
                  {ss.bullets && <ul className="space-y-1">{ss.bullets.map((b, i) => <li key={i} className="text-sm text-text-primary flex gap-2"><span className="text-text-dim">–</span>{b}</li>)}</ul>}
                  {ss.example && <pre className="p-2 bg-bg-elevated rounded text-xs font-mono text-text-primary whitespace-pre-wrap">{ss.example}</pre>}
                </div>
              ))}
              {block.quickCheck?.length && (
                <div className="p-3 bg-bg-elevated border border-border rounded-btn">
                  <div className="text-[10px] font-mono text-accent-cyan tracking-widest mb-2">QUICK CHECK</div>
                  <ol className="space-y-1">{block.quickCheck.map((q, i) => <li key={i} className="text-sm text-text-primary flex gap-2"><span className="text-accent-cyan font-mono">{i + 1}.</span>{q}</li>)}</ol>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {notes.glossary?.length && (
        <div className="border border-border rounded-btn overflow-hidden">
          <div className="px-4 py-3 bg-bg-elevated"><h2 className="font-rajdhani font-bold text-base text-text-primary">Glossary</h2></div>
          <div className="p-4 grid grid-cols-1 gap-2 bg-bg-panel">
            {notes.glossary.map((g, i) => <div key={i} className="flex gap-2 text-sm"><span className="font-semibold text-accent-cyan min-w-24">{g.term}</span><span className="text-text-secondary">{g.definition}</span></div>)}
          </div>
        </div>
      )}
      {notes.selfCheck?.length && (
        <div className="p-4 border border-accent-green/30 bg-accent-green/5 rounded-btn">
          <div className="text-[10px] font-mono text-accent-green tracking-widest mb-3">SELF-CHECK QUESTIONS</div>
          <ol className="space-y-2">{notes.selfCheck.map((q, i) => <li key={i} className="text-sm text-text-primary flex gap-2"><span className="text-accent-green font-mono font-bold">{i + 1}.</span>{q}</li>)}</ol>
        </div>
      )}
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

function GenStage({ step, color }: { step: string; color: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
      <Loader2 size={48} className={`text-${color} animate-spin`} />
      <div className="font-rajdhani font-bold text-lg text-text-primary">{step}</div>
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
