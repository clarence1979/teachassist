import { useState } from 'react';
import {
  X, Loader2, Sparkles, AlertCircle, CheckCircle2,
  FileText, FileType2, Download, Layers,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../../contexts/CredentialsContext';
import { useAppStore } from '../../store/appStore';
import { useDb } from '../../db/DbContext';
import { artifactsRepo } from '../../db/repos';
import { complete } from '../../lib/llm';
import {
  buildDocumentPrompt, parseDocumentJson,
  DOC_TYPE_LABELS, DOC_TYPE_DESCRIPTIONS,
  type DocumentRequest, type DocumentType, type StructuredDocument,
} from '../../lib/studio/documentSchema';
import { buildDocumentPdf, downloadBase64Pdf } from '../../lib/studio/pdfRenderer';
import { buildDocumentDocx, downloadBase64Docx } from '../../lib/studio/docxBuilder';

type Stage = 'form' | 'generating' | 'preview' | 'error';

interface Props {
  onClose: () => void;
  /** Optional seed context — e.g. a lesson plan feeding follow-ups */
  seed?: { topic?: string; yearLevel?: string; documentType?: DocumentType };
  /** When true, shows "one-click follow-ups" UI after a lesson plan is produced. */
  enableFollowUps?: boolean;
  onFollowUp?: (kind: 'slides' | 'worksheet' | 'notes' | 'quiz', doc: StructuredDocument) => void;
}

const DOC_TYPES: DocumentType[] = [
  'lesson_plan_5e', 'lesson_plan_gagne', 'lesson_plan_direct',
  'handout', 'cheat_sheet', 'parent_letter', 'report_comment', 'iep_note',
];

const YEAR_LEVELS = [
  '', 'Prep', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6',
  'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11', 'Year 12',
];

export function DocumentGeneratorModal({ onClose, seed, enableFollowUps, onFollowUp }: Props) {
  const { getKey } = useCredentials();
  const { activeProvider, activeModel, notifyArtifactGenerated } = useAppStore();
  const db = useDb();

  const [documentType, setDocumentType] = useState<DocumentType>(seed?.documentType ?? 'lesson_plan_5e');
  const [topic, setTopic] = useState(seed?.topic ?? '');
  const [yearLevel, setYearLevel] = useState(seed?.yearLevel ?? 'Year 9');
  const [tone, setTone] = useState<'formal' | 'warm' | 'neutral' | 'concise'>('neutral');
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [durationMin, setDurationMin] = useState<number | ''>(50);
  const [curriculumStandard, setCurriculumStandard] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [studentName, setStudentName] = useState('');
  const [notes, setNotes] = useState('');

  const [state, setState] = useState<{ stage: Stage; step?: string; error?: string }>({ stage: 'form' });
  const [doc, setDoc] = useState<StructuredDocument | null>(null);
  const [pdfB64, setPdfB64] = useState<string | null>(null);
  const [docxB64, setDocxB64] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isLessonPlan = documentType.startsWith('lesson_plan_');
  const isParent = documentType === 'parent_letter';
  const isStudent = documentType === 'report_comment' || documentType === 'iep_note';

  const handleGenerate = async () => {
    const apiKey = getKey(activeProvider);
    if (!apiKey) { setState({ stage: 'error', error: `No ${activeProvider} API key configured.` }); return; }
    if (!topic.trim()) { setState({ stage: 'error', error: 'Topic / subject is required.' }); return; }

    setState({ stage: 'generating', step: `Drafting ${DOC_TYPE_LABELS[documentType]}...` });

    const req: DocumentRequest = {
      documentType,
      topic: topic.trim(),
      yearLevel: yearLevel || undefined,
      tone, length,
      durationMin: typeof durationMin === 'number' && isLessonPlan ? durationMin : undefined,
      curriculumStandard: curriculumStandard.trim() || undefined,
      teacherName: teacherName.trim() || undefined,
      schoolName: schoolName.trim() || undefined,
      studentName: isStudent ? studentName.trim() || undefined : undefined,
      notes: notes.trim() || undefined,
    };

    try {
      const { text } = await complete({
        provider: activeProvider,
        model: activeModel,
        apiKey,
        system: 'You are an expert teacher / school leader producing structured JSON documents. Output ONLY valid JSON — no prose, no fences.',
        messages: [{ role: 'user', content: buildDocumentPrompt(req) }],
        maxTokens: 8000,
        temperature: 0.5,
      });

      let parsed: StructuredDocument;
      try { parsed = parseDocumentJson(text, documentType); }
      catch (e) { throw new Error(`Failed to parse document JSON: ${(e as Error).message}`); }

      setState({ stage: 'generating', step: 'Rendering PDF and DOCX...' });
      const [pdf, docx] = await Promise.all([
        buildDocumentPdf(parsed),
        buildDocumentDocx(parsed),
      ]);

      const artifactType = documentType.startsWith('lesson_plan_') ? 'lesson_plan' : 'pdf';

      const savedArtifact = await artifactsRepo.create(db, {
        type: artifactType as 'lesson_plan' | 'pdf',
        title: parsed.title || topic.trim(),
        data: pdf,
        mediaType: 'application/pdf',
        meta: {
          documentType,
          topic: parsed.meta.topic,
          yearLevel: parsed.meta.yearLevel,
          durationMin: parsed.meta.durationMin,
          curriculumStandard: parsed.meta.curriculumStandard,
          teacherName: parsed.meta.teacherName,
          schoolName: parsed.meta.schoolName,
          date: parsed.meta.date,
          tone, length,
          document: parsed,
          docxBase64: docx,
          generatedAt: Date.now(),
          provider: activeProvider,
          model: activeModel,
        },
      });
      notifyArtifactGenerated(savedArtifact.id);

      setDoc(parsed);
      setPdfB64(pdf);
      setDocxB64(docx);
      setSaved(true);
      setState({ stage: 'preview' });
    } catch (e) {
      setState({ stage: 'error', error: (e as Error).message });
    }
  };

  const handleReset = () => {
    setDoc(null); setPdfB64(null); setDocxB64(null); setSaved(false);
    setState({ stage: 'form' });
  };

  const downloadName = () => {
    if (!doc) return 'document';
    return doc.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'document';
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="w-full max-w-6xl h-[92vh] bg-bg-panel border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-btn bg-bg-panel border border-border">
              <FileText size={16} className="text-accent-amber" />
            </div>
            <div>
              <h2 className="font-orbitron font-bold text-text-primary text-sm tracking-wide uppercase">
                PDF Document Generator
              </h2>
              <p className="font-mono text-[10px] text-text-dim tracking-wider">
                LESSON PLANS · HANDOUTS · LETTERS · REPORTS
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
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Document type grid */}
              <div>
                <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-2">
                  Document type
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {DOC_TYPES.map((t) => {
                    const active = t === documentType;
                    return (
                      <button key={t} onClick={() => setDocumentType(t)}
                        className={clsx(
                          'p-3 rounded-btn border text-left transition-colors',
                          active ? 'border-accent-amber bg-accent-amber/10' : 'border-border hover:border-text-dim',
                        )}>
                        <div className={clsx('font-rajdhani font-bold text-sm', active ? 'text-accent-amber' : 'text-text-primary')}>
                          {DOC_TYPE_LABELS[t]}
                        </div>
                        <div className="text-[10px] text-text-dim mt-0.5 leading-tight">
                          {DOC_TYPE_DESCRIPTIONS[t]}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="space-y-4">
                  <Field label="Topic / subject" required>
                    <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)}
                      placeholder={isParent ? 'e.g. Term 2 unit on poetry' : 'e.g. Linear equations'}
                      className="input" />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Year level">
                      <select value={yearLevel} onChange={(e) => setYearLevel(e.target.value)} className="input">
                        {YEAR_LEVELS.map((y) => <option key={y || 'none'} value={y}>{y || '— none —'}</option>)}
                      </select>
                    </Field>
                    {isLessonPlan && (
                      <Field label="Duration (min)">
                        <input type="number" min={10} max={240} value={durationMin}
                          onChange={(e) => setDurationMin(e.target.value === '' ? '' : Number(e.target.value))}
                          className="input" />
                      </Field>
                    )}
                    {!isLessonPlan && (
                      <Field label="Length">
                        <select value={length} onChange={(e) => setLength(e.target.value as typeof length)} className="input">
                          <option value="short">Short</option>
                          <option value="medium">Medium</option>
                          <option value="long">Long</option>
                        </select>
                      </Field>
                    )}
                  </div>

                  <Field label="Curriculum (optional)">
                    <input type="text" value={curriculumStandard} onChange={(e) => setCurriculumStandard(e.target.value)}
                      placeholder="e.g. VCMNA283" className="input" />
                  </Field>

                  <Field label="Tone">
                    <select value={tone} onChange={(e) => setTone(e.target.value as typeof tone)} className="input">
                      <option value="neutral">Neutral — balanced</option>
                      <option value="formal">Formal — professional</option>
                      <option value="warm">Warm — friendly</option>
                      <option value="concise">Concise — punchy</option>
                    </select>
                  </Field>
                </div>

                <div className="space-y-4">
                  <Field label="Teacher name (optional)">
                    <input type="text" value={teacherName} onChange={(e) => setTeacherName(e.target.value)}
                      placeholder="e.g. Ms. Chen" className="input" />
                  </Field>
                  <Field label="School name (optional)">
                    <input type="text" value={schoolName} onChange={(e) => setSchoolName(e.target.value)}
                      placeholder="e.g. Northfield Secondary" className="input" />
                  </Field>
                  {isStudent && (
                    <Field label="Student name (optional)" hint="Leave blank for a reusable template.">
                      <input type="text" value={studentName} onChange={(e) => setStudentName(e.target.value)}
                        placeholder="e.g. Jordan K." className="input" />
                    </Field>
                  )}
                  <Field label="Extra instructions (optional)">
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
                      placeholder="e.g. Emphasise inquiry-based pedagogy. Include at least one group task."
                      className="input" />
                  </Field>
                </div>
              </div>
            </div>
          )}

          {state.stage === 'generating' && (
            <GeneratingStage step={state.step ?? ''} />
          )}

          {state.stage === 'error' && (
            <ErrorStage error={state.error ?? 'Unknown error'} onRetry={handleReset} />
          )}

          {state.stage === 'preview' && doc && pdfB64 && (
            <div className="flex-1 min-h-0 flex flex-col p-5 gap-3">
              {enableFollowUps && isLessonPlan && onFollowUp && (
                <div className="shrink-0 p-3 border border-accent-amber/40 bg-accent-amber/5 rounded-btn">
                  <div className="flex items-center gap-2 mb-2">
                    <Layers size={14} className="text-accent-amber" />
                    <span className="text-xs font-rajdhani font-bold text-accent-amber uppercase tracking-wider">
                      One-click follow-ups
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { id: 'slides', label: 'Make slides from this' },
                      { id: 'worksheet', label: 'Make a worksheet from this' },
                      { id: 'notes', label: 'Make student notes from this' },
                      { id: 'quiz', label: 'Make a quiz from this' },
                    ] as const).map(({ id, label }) => (
                      <button key={id} onClick={() => onFollowUp(id, doc)}
                        className="px-3 py-1.5 rounded-btn border border-border text-xs font-rajdhani font-semibold text-text-primary hover:text-accent-amber hover:border-accent-amber transition-colors">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <iframe
                title="PDF preview"
                src={`data:application/pdf;base64,${pdfB64}`}
                className="flex-1 min-h-0 border border-border rounded-btn bg-white"
              />
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border bg-bg-elevated gap-3">
          <div className="font-mono text-[10px] text-text-dim tracking-wider">
            {state.stage === 'form' && 'CONFIGURE DOCUMENT'}
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
                <button onClick={handleGenerate} disabled={!topic.trim()}
                  className="px-4 py-2 rounded-btn bg-accent-amber text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2">
                  <Sparkles size={13} />
                  Generate
                </button>
              </>
            )}
            {state.stage === 'preview' && (
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
      <Loader2 size={48} className="text-accent-amber animate-spin" />
      <div className="font-rajdhani font-bold text-lg text-text-primary">{step}</div>
      <p className="text-xs text-text-dim font-mono max-w-sm">
        Drafting structured JSON, then rendering print-ready PDF and editable DOCX.
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
