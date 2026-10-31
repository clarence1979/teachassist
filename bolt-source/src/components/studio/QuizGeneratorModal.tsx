import { useState } from 'react';
import {
  X, Loader2, Sparkles, AlertCircle, CheckCircle2,
  FileText, FileType2, Download, HelpCircle, Code2,
  PlayCircle, Trophy, RotateCcw,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../../contexts/CredentialsContext';
import { useAppStore } from '../../store/appStore';
import { useDb } from '../../db/DbContext';
import { artifactsRepo } from '../../db/repos';
import { complete } from '../../lib/llm';
import {
  buildQuizPrompt, parseQuizJson, DIFFICULTY_LABELS, buildResultsCsv,
  type Quiz, type QuizRequest, type QuizQuestion,
  type QuestionType, type BloomLevel, type DifficultyLevel,
} from '../../lib/studio/quizSchema';
import { QTYPE_LABELS, BLOOM_LABELS } from '../../lib/studio/worksheetSchema';
import {
  buildQuizPdf, buildQuizDocx,
  downloadBase64Pdf, downloadBase64Docx, downloadText,
} from '../../lib/studio/quizBuilders';

type Stage = 'form' | 'generating' | 'preview' | 'error';
type Tab = 'interactive' | 'pdf';

interface Props { onClose: () => void; seed?: { topic?: string; yearLevel?: string } }

const YEAR_LEVELS = ['Prep','Year 1','Year 2','Year 3','Year 4','Year 5','Year 6','Year 7','Year 8','Year 9','Year 10','Year 11','Year 12'];
const ALL_QTYPES: QuestionType[] = ['multiple_choice','true_false','short_answer','long_answer','fill_blank','matching','ordering','code_trace','worked_example'];
const ALL_DIFFS: DifficultyLevel[] = ['easy','medium','hard','mixed'];
const ALL_BLOOM: BloomLevel[] = ['remember','understand','apply','analyze','evaluate','create'];

type AnswerState = Record<string, string | string[] | Record<string, string>>;
type GradeResult = Record<string, 'correct' | 'incorrect' | 'ungraded'>;

export function QuizGeneratorModal({ onClose, seed }: Props) {
  const { getKey } = useCredentials();
  const { activeProvider, activeModel, notifyArtifactGenerated } = useAppStore();
  const db = useDb();

  const [topic, setTopic] = useState(seed?.topic ?? '');
  const [yearLevel, setYearLevel] = useState(seed?.yearLevel ?? 'Year 9');
  const [questionCount, setQuestionCount] = useState(10);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>(['multiple_choice','true_false','short_answer']);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('mixed');
  const [timeLimitMin, setTimeLimitMin] = useState<number | ''>(30);
  const [curriculumStandard, setCurriculumStandard] = useState('');
  const [bloomFocus, setBloomFocus] = useState<BloomLevel | ''>('');
  const [includeAnswerKey, setIncludeAnswerKey] = useState(true);
  const [randomiseOrder, setRandomiseOrder] = useState(false);
  const [notes, setNotes] = useState('');

  const [state, setState] = useState<{ stage: Stage; step?: string; error?: string }>({ stage: 'form' });
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [pdfB64, setPdfB64] = useState<string | null>(null);
  const [docxB64, setDocxB64] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('interactive');
  const [showPrompt, setShowPrompt] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');
  const [saved, setSaved] = useState(false);

  // Interactive grading state
  const [answers, setAnswers] = useState<AnswerState>({});
  const [results, setResults] = useState<GradeResult | null>(null);

  const toggleType = (t: QuestionType) => setSelectedTypes((arr) => arr.includes(t) ? arr.filter((x) => x !== t) : [...arr, t]);

  const handleGenerate = async () => {
    const apiKey = getKey(activeProvider);
    if (!apiKey) { setState({ stage: 'error', error: `No ${activeProvider} API key.` }); return; }
    if (!topic.trim()) { setState({ stage: 'error', error: 'Topic is required.' }); return; }
    if (!selectedTypes.length) { setState({ stage: 'error', error: 'Select at least one question type.' }); return; }

    const req: QuizRequest = {
      topic: topic.trim(), yearLevel, questionCount, questionTypes: selectedTypes, difficulty,
      timeLimitMin: typeof timeLimitMin === 'number' ? timeLimitMin : undefined,
      curriculumStandard: curriculumStandard.trim() || undefined,
      bloomFocus: bloomFocus || undefined, includeAnswerKey, randomiseOrder,
      notes: notes.trim() || undefined,
    };
    const prompt = buildQuizPrompt(req);
    setLastPrompt(prompt);
    setState({ stage: 'generating', step: 'Drafting quiz...' });

    try {
      const { text } = await complete({ provider: activeProvider, model: activeModel, apiKey, system: 'You are an expert teacher. Output ONLY valid JSON — no prose, no fences.', messages: [{ role: 'user', content: prompt }], maxTokens: 10000, temperature: 0.4 });
      let parsed: Quiz;
      try { parsed = parseQuizJson(text); } catch (e) { throw new Error(`Failed to parse quiz JSON: ${(e as Error).message}`); }
      if (randomiseOrder) parsed = { ...parsed, questions: [...parsed.questions].sort(() => Math.random() - 0.5) };

      setState({ stage: 'generating', step: 'Building PDF and DOCX...' });
      const [pdf, docx] = await Promise.all([buildQuizPdf(parsed, { includeAnswerKey }), buildQuizDocx(parsed, { includeAnswerKey })]);

      const savedArtifact = await artifactsRepo.create(db, {
        type: 'quiz', title: parsed.title || topic.trim(), data: pdf, mediaType: 'application/pdf',
        meta: { topic: parsed.topic, yearLevel: parsed.yearLevel, questionCount: parsed.questions.length, totalPoints: parsed.totalPoints, difficulty, includeAnswerKey, quiz: parsed, docxBase64: docx, generatedAt: Date.now(), provider: activeProvider, model: activeModel },
      });
      notifyArtifactGenerated(savedArtifact.id);

      setQuiz(parsed); setPdfB64(pdf); setDocxB64(docx); setSaved(true);
      setState({ stage: 'preview' });
    } catch (e) { setState({ stage: 'error', error: (e as Error).message }); }
  };

  const handleReset = () => { setQuiz(null); setPdfB64(null); setDocxB64(null); setAnswers({}); setResults(null); setSaved(false); setState({ stage: 'form' }); };
  const dn = () => (quiz?.title ?? topic).replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'quiz';

  const handleSubmitQuiz = () => {
    if (!quiz) return;
    const out: GradeResult = {};
    for (const q of quiz.questions) out[q.id] = gradeQ(q, answers[q.id]);
    setResults(out);
  };

  const totalGradable = quiz?.questions.filter((q) => ['multiple_choice','true_false','fill_blank'].includes(q.type)).length ?? 0;
  const correct = results ? Object.values(results).filter((r) => r === 'correct').length : 0;
  const score = totalGradable ? Math.round((correct / totalGradable) * 100) : 0;

  const handleExportCsv = () => {
    if (!quiz || !results) return;
    const csv = buildResultsCsv(quiz, answers, results);
    downloadText(csv, `${dn()}_results.csv`, 'text/csv');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-6xl h-[92vh] bg-bg-panel border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-btn bg-bg-panel border border-border"><HelpCircle size={16} className="text-accent-cyan" /></div>
            <div>
              <h2 className="font-orbitron font-bold text-text-primary text-sm tracking-wide uppercase">Quiz / Test Generator</h2>
              <p className="font-mono text-[10px] text-text-dim tracking-wider">PDF · DOCX · INTERACTIVE · CSV EXPORT</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {state.stage === 'preview' && <button onClick={() => setShowPrompt((s) => !s)} className="px-2 py-1 rounded-btn border border-border text-[10px] font-mono text-text-dim hover:text-accent-cyan hover:border-accent-cyan transition-colors flex items-center gap-1"><Code2 size={11} />{showPrompt ? 'Hide' : 'View'} prompt</button>}
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan hover:bg-bg-panel transition-colors"><X size={16} /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {showPrompt && <div className="shrink-0 border-b border-border bg-bg-elevated max-h-40 overflow-y-auto p-3"><pre className="text-[10px] font-mono text-text-secondary whitespace-pre-wrap">{lastPrompt}</pre></div>}

          {state.stage === 'form' && (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <Field label="Topic" required><input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Algebra — linear equations" className="input" /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Year level"><select value={yearLevel} onChange={(e) => setYearLevel(e.target.value)} className="input">{YEAR_LEVELS.map((y) => <option key={y}>{y}</option>)}</select></Field>
                    <Field label="Question count"><input type="number" min={3} max={50} value={questionCount} onChange={(e) => setQuestionCount(Math.max(3, Math.min(50, Number(e.target.value) || 10)))} className="input" /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Time limit (min)"><input type="number" min={5} max={180} value={timeLimitMin} onChange={(e) => setTimeLimitMin(e.target.value === '' ? '' : Number(e.target.value))} className="input" /></Field>
                    <Field label="Curriculum (optional)"><input type="text" value={curriculumStandard} onChange={(e) => setCurriculumStandard(e.target.value)} placeholder="e.g. VCMNA346" className="input" /></Field>
                  </div>
                  <Field label="Difficulty">
                    <div className="grid grid-cols-4 gap-1.5">
                      {ALL_DIFFS.map((d) => <button key={d} onClick={() => setDifficulty(d)} className={clsx('px-2 py-1.5 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', d === difficulty ? 'border-accent-cyan text-accent-cyan bg-bg-elevated' : 'border-border text-text-secondary hover:border-text-dim')}>{DIFFICULTY_LABELS[d]}</button>)}
                    </div>
                  </Field>
                  <Field label="Bloom's focus (optional)">
                    <select value={bloomFocus} onChange={(e) => setBloomFocus(e.target.value as BloomLevel | '')} className="input">
                      <option value="">Mixed (auto)</option>
                      {ALL_BLOOM.map((b) => <option key={b} value={b}>{BLOOM_LABELS[b]}</option>)}
                    </select>
                  </Field>
                  <Field label="Notes (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. No calculators. Metric units." className="input" /></Field>
                </div>
                <div className="space-y-4">
                  <Field label="Question types" required>
                    <div className="grid grid-cols-2 gap-1.5">
                      {ALL_QTYPES.map((t) => { const on = selectedTypes.includes(t); return <button key={t} onClick={() => toggleType(t)} className={clsx('px-3 py-1.5 rounded-btn border text-xs text-left font-rajdhani font-semibold transition-colors', on ? 'border-accent-cyan text-accent-cyan bg-bg-elevated' : 'border-border text-text-secondary hover:border-text-dim')}>{QTYPE_LABELS[t]}</button>; })}
                    </div>
                  </Field>
                  <div className="space-y-2">
                    {([
                      { key: 'answerKey', label: 'Include answer key page', value: includeAnswerKey, set: setIncludeAnswerKey },
                      { key: 'randomise', label: 'Randomise question order', value: randomiseOrder, set: setRandomiseOrder },
                    ] as const).map(({ key, label, value, set }) => (
                      <label key={key} className={clsx('flex items-center gap-3 p-2.5 rounded-btn border cursor-pointer transition-colors', value ? 'border-accent-cyan bg-accent-cyan/5' : 'border-border hover:border-text-dim')}>
                        <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} className="accent-accent-cyan" />
                        <span className="text-xs font-rajdhani font-semibold text-text-primary">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {state.stage === 'generating' && (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
              <Loader2 size={48} className="text-accent-cyan animate-spin" />
              <div className="font-rajdhani font-bold text-lg text-text-primary">{state.step}</div>
            </div>
          )}
          {state.stage === 'error' && <ErrStage error={state.error ?? ''} onRetry={handleReset} />}

          {state.stage === 'preview' && quiz && (
            <>
              <div className="shrink-0 flex border-b border-border bg-bg-elevated">
                {([{ id: 'interactive', label: 'Interactive', icon: PlayCircle }, { id: 'pdf', label: 'PDF preview', icon: FileText }] as const).map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => setActiveTab(id)} className={clsx('px-4 py-2 flex items-center gap-2 text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', activeTab === id ? 'text-accent-cyan border-b-2 border-accent-cyan' : 'text-text-dim hover:text-text-primary')}>
                    <Icon size={13} />{label}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-5">
                {activeTab === 'interactive' && (
                  <InteractiveQuiz
                    quiz={quiz} answers={answers} results={results}
                    onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
                    onSubmit={handleSubmitQuiz} onReset={() => { setAnswers({}); setResults(null); }}
                    score={score} correct={correct} totalGradable={totalGradable}
                  />
                )}
                {activeTab === 'pdf' && pdfB64 && <iframe title="PDF" src={`data:application/pdf;base64,${pdfB64}`} className="w-full h-full border border-border rounded-btn bg-white" />}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border bg-bg-elevated gap-3">
          <div className="font-mono text-[10px] text-text-dim tracking-wider">
            {state.stage === 'preview' && saved && <span className="flex items-center gap-1.5 text-accent-green"><CheckCircle2 size={11} />SAVED TO LIBRARY</span>}
            {state.stage === 'form' && 'CONFIGURE QUIZ'}
            {state.stage === 'generating' && 'WORKING...'}
          </div>
          <div className="flex items-center gap-2">
            {state.stage === 'form' && (<>
              <button onClick={onClose} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Cancel</button>
              <button onClick={handleGenerate} disabled={!topic.trim() || !selectedTypes.length} className="px-4 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 transition-all flex items-center gap-2"><Sparkles size={13} />Generate</button>
            </>)}
            {state.stage === 'preview' && quiz && (<>
              <button onClick={handleReset} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">New</button>
              {results && <button onClick={handleExportCsv} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-accent-green hover:border-accent-green text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"><Trophy size={13} />CSV</button>}
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

// ─── Interactive quiz ────────────────────────────────────────────────────────

function InteractiveQuiz({ quiz, answers, results, onAnswer, onSubmit, onReset, score, correct, totalGradable }: {
  quiz: Quiz; answers: AnswerState; results: GradeResult | null;
  onAnswer: (id: string, v: AnswerState[string]) => void;
  onSubmit: () => void; onReset: () => void;
  score: number; correct: number; totalGradable: number;
}) {
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <div className="p-4 border border-border rounded-btn bg-bg-elevated flex items-center gap-4">
        <div className="flex-1">
          <div className="font-orbitron font-bold text-text-primary">{quiz.title}</div>
          <div className="text-xs font-mono text-text-dim mt-0.5">{quiz.yearLevel}  ·  {quiz.totalPoints} pts{quiz.timeLimitMin ? `  ·  ${quiz.timeLimitMin} min` : ''}</div>
        </div>
      </div>
      {quiz.instructions && <div className="p-3 border border-accent-cyan/30 bg-accent-cyan/5 rounded-btn text-sm text-text-primary">{quiz.instructions}</div>}

      <div className="space-y-4">
        {quiz.questions.map((q, i) => <QuizQCard key={q.id} q={q} num={i + 1} answer={answers[q.id]} result={results?.[q.id]} onAnswer={(v) => onAnswer(q.id, v)} showAnswer={!!results} />)}
      </div>

      {results && (
        <div className="p-4 border border-border rounded-btn bg-bg-elevated flex items-center gap-4">
          <Trophy size={24} className={clsx(score >= 80 ? 'text-accent-green' : score >= 50 ? 'text-accent-amber' : 'text-accent-red')} />
          <div className="flex-1">
            <div className="font-rajdhani font-bold text-text-primary">Score: {correct} / {totalGradable} auto-graded ({score}%)</div>
            <div className="text-xs text-text-dim">{quiz.questions.length - totalGradable} questions need teacher review</div>
          </div>
          <div className="w-24 h-2 bg-bg-panel rounded-full overflow-hidden">
            <div className={clsx('h-full', score >= 80 ? 'bg-accent-green' : score >= 50 ? 'bg-accent-amber' : 'bg-accent-red')} style={{ width: `${score}%` }} />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pb-4">
        <button onClick={onReset} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"><RotateCcw size={13} />Reset</button>
        <button onClick={onSubmit} className="px-4 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-1.5"><CheckCircle2 size={13} />Submit</button>
      </div>
    </div>
  );
}


function QuizQCard({ q, num, answer, result, onAnswer, showAnswer }: {
  q: QuizQuestion; num: number; answer: AnswerState[string] | undefined;
  result: 'correct' | 'incorrect' | 'ungraded' | undefined;
  onAnswer: (v: AnswerState[string]) => void; showAnswer: boolean;
}) {
  return (
    <div className={clsx('p-4 rounded-btn border', result === 'correct' ? 'border-accent-green/50 bg-accent-green/5' : result === 'incorrect' ? 'border-accent-red/50 bg-accent-red/5' : 'border-border')}>
      <div className="flex items-start gap-2 mb-3">
        <span className="font-rajdhani font-bold text-accent-cyan shrink-0">{num}.</span>
        <div className="flex-1">
          <p className="text-sm text-text-primary">{q.prompt.replace(/\{\{\d+\}\}/g, '______')} <span className="text-text-dim text-xs">[{q.points}pt]</span></p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] font-mono text-text-dim uppercase">{QTYPE_LABELS[q.type]}</span>
            {q.difficulty && <span className={clsx('text-[9px] font-mono uppercase', q.difficulty === 'easy' ? 'text-accent-green' : q.difficulty === 'hard' ? 'text-accent-red' : 'text-accent-amber')}>{q.difficulty}</span>}
          </div>
        </div>
        {result === 'correct' && <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-green shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
        {result === 'incorrect' && <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-red shrink-0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>}
      </div>
      <div className="pl-5">
        {q.type === 'multiple_choice' && (
          <div className="space-y-1.5">
            {q.choices?.map((c) => (
              <label key={c.id} className={clsx('flex items-center gap-2 px-3 py-2 rounded-btn border cursor-pointer transition-colors', answer === c.id ? 'border-accent-cyan bg-bg-elevated' : 'border-border hover:border-text-dim')}>
                <input type="radio" name={q.id} value={c.id} checked={answer === c.id} onChange={() => onAnswer(c.id)} className="accent-accent-cyan" />
                <span className="text-sm"><span className="font-mono text-accent-cyan mr-2">{c.id}.</span>{c.text}</span>
              </label>
            ))}
          </div>
        )}
        {q.type === 'true_false' && (
          <div className="flex gap-2">
            {['true','false'].map((v) => <button key={v} onClick={() => onAnswer(v)} className={clsx('px-4 py-1.5 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors', answer === v ? 'border-accent-cyan text-accent-cyan bg-bg-elevated' : 'border-border text-text-secondary hover:border-text-dim')}>{v}</button>)}
          </div>
        )}
        {(q.type === 'short_answer' || q.type === 'long_answer' || q.type === 'worked_example') && (
          <textarea value={typeof answer === 'string' ? answer : ''} onChange={(e) => onAnswer(e.target.value)} rows={q.type === 'long_answer' || q.type === 'worked_example' ? 5 : 2} className="input mt-1" placeholder="Your answer..." />
        )}
        {q.type === 'code_trace' && (<>
          {q.code && <pre className="p-3 mt-1 bg-bg-elevated border border-border rounded-btn text-xs font-mono text-text-primary overflow-x-auto">{q.code}</pre>}
          <textarea value={typeof answer === 'string' ? answer : ''} onChange={(e) => onAnswer(e.target.value)} rows={3} className="input mt-2 font-mono text-xs" placeholder="Expected output..." />
        </>)}
        {q.type === 'fill_blank' && (
          <div className="space-y-2 mt-1">
            {(q.blanks ?? ['']).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs font-mono text-text-dim">{i + 1}.</span>
                <input type="text" value={Array.isArray(answer) ? (answer[i] ?? '') : ''} onChange={(e) => { const arr = Array.isArray(answer) ? [...answer] : Array(q.blanks?.length ?? 1).fill(''); arr[i] = e.target.value; onAnswer(arr); }} className="input flex-1" placeholder={`Blank ${i + 1}`} />
              </div>
            ))}
          </div>
        )}
        {q.type === 'matching' && q.pairs && (
          <div className="space-y-2 mt-1">
            {q.pairs.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm flex-1">{p.left}</span>
                <select value={(typeof answer === 'object' && !Array.isArray(answer) ? (answer as Record<string, string>)[String(i)] : '') ?? ''} onChange={(e) => onAnswer({ ...(typeof answer === 'object' && !Array.isArray(answer) ? answer as Record<string, string> : {}), [String(i)]: e.target.value })} className="input w-48">
                  <option value="">Select...</option>
                  {q.pairs!.map((pp, j) => <option key={j} value={pp.right}>{String.fromCharCode(65 + j)}. {pp.right}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
        {showAnswer && result === 'incorrect' && q.answer && <p className="mt-2 text-xs text-accent-green"><span className="font-semibold">Answer:</span> {q.answer}</p>}
        {showAnswer && q.explanation && <p className="mt-1 text-xs text-text-dim italic">{q.explanation}</p>}
      </div>
    </div>
  );
}

function gradeQ(q: QuizQuestion, a: AnswerState[string] | undefined): 'correct' | 'incorrect' | 'ungraded' {
  const norm = (s: string) => s.trim().toLowerCase();
  if (a === undefined) return ['multiple_choice','true_false','fill_blank'].includes(q.type) ? 'incorrect' : 'ungraded';
  if (q.type === 'multiple_choice' || q.type === 'true_false') return q.answer && norm(String(a)) === norm(q.answer) ? 'correct' : 'incorrect';
  if (q.type === 'fill_blank') { if (!Array.isArray(a) || !q.blanks) return 'incorrect'; return q.blanks.every((b, i) => norm(String(a[i] ?? '')) === norm(b)) ? 'correct' : 'incorrect'; }
  return 'ungraded';
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
