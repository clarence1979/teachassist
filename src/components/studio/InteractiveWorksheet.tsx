import { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, RotateCcw, Award, Circle } from 'lucide-react';
import { clsx } from 'clsx';
import type { Worksheet, Question } from '../../lib/studio/worksheetSchema';
import { TIER_LABELS, QTYPE_LABELS } from '../../lib/studio/worksheetSchema';

/**
 * Interactive worksheet with client-side auto-grading for:
 *   multiple_choice, true_false, fill_blank, ordering (partial), matching (partial).
 * Other question types (short/long answer, worked_example, code_trace, label_diagram)
 * are rendered but not auto-graded — student response is stored for review.
 */

interface Props {
  worksheet: Worksheet;
}

type AnswerState = Record<string, string | string[] | Record<string, string>>;
type ResultState = Record<string, 'correct' | 'incorrect' | 'ungraded'>;

export function InteractiveWorksheet({ worksheet }: Props) {
  const [activeTierIdx, setActiveTierIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [results, setResults] = useState<ResultState | null>(null);

  const tier = worksheet.tiers[activeTierIdx];

  const gradable = useMemo(() => {
    return tier.questions.filter((q) =>
      ['multiple_choice', 'true_false', 'fill_blank', 'ordering', 'matching'].includes(q.type),
    );
  }, [tier]);

  const handleAnswer = (qId: string, value: AnswerState[string]) => {
    setAnswers((a) => ({ ...a, [qId]: value }));
  };

  const handleSubmit = () => {
    const out: ResultState = {};
    for (const q of tier.questions) {
      out[q.id] = gradeQuestion(q, answers[q.id]);
    }
    setResults(out);
  };

  const handleReset = () => {
    setAnswers({});
    setResults(null);
  };

  const correctCount = results
    ? Object.entries(results).filter(([, r]) => r === 'correct').length
    : 0;
  const gradableCount = gradable.length;
  const scorePct = gradableCount ? Math.round((correctCount / gradableCount) * 100) : 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tier tabs */}
      <div className="shrink-0 flex gap-2 border-b border-border pb-3 mb-4">
        {worksheet.tiers.map((t, i) => (
          <button
            key={t.tier}
            onClick={() => { setActiveTierIdx(i); setResults(null); }}
            className={clsx(
              'px-3 py-1.5 text-xs font-rajdhani font-semibold uppercase tracking-wider rounded-btn border transition-colors',
              i === activeTierIdx
                ? 'border-accent-cyan text-accent-cyan bg-bg-elevated'
                : 'border-border text-text-dim hover:text-text-primary hover:border-text-dim',
            )}
          >
            {TIER_LABELS[t.tier]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-2">
        {tier.readingLevelNote && (
          <p className="text-xs text-text-dim italic mb-3">{tier.readingLevelNote}</p>
        )}
        {tier.instructions && (
          <div className="mb-4 p-3 border border-accent-cyan/40 bg-accent-cyan/5 rounded-btn">
            <div className="text-[10px] font-mono tracking-widest text-accent-cyan mb-1">INSTRUCTIONS</div>
            <p className="text-sm text-text-primary">{tier.instructions}</p>
          </div>
        )}

        <div className="space-y-5">
          {tier.questions.map((q, i) => (
            <QuestionRenderer
              key={q.id}
              q={q}
              num={i + 1}
              answer={answers[q.id]}
              result={results?.[q.id]}
              onAnswer={(v) => handleAnswer(q.id, v)}
              showAnswer={!!results}
            />
          ))}
        </div>
      </div>

      {/* Score bar */}
      <div className="shrink-0 mt-4 border-t border-border pt-3">
        {results && (
          <div className="mb-3 p-3 bg-bg-elevated border border-border rounded-btn flex items-center gap-3">
            <Award size={20} className="text-accent-cyan" />
            <div className="flex-1">
              <div className="font-rajdhani font-bold text-text-primary">
                Score: {correctCount} / {gradableCount} auto-gradable
              </div>
              <div className="text-xs text-text-dim font-mono">
                {scorePct}% · {tier.questions.length - gradableCount} questions need teacher review
              </div>
            </div>
            <div className="w-24 h-2 bg-bg-panel rounded-full overflow-hidden">
              <div
                className={clsx(
                  'h-full transition-all',
                  scorePct >= 80 ? 'bg-accent-green' : scorePct >= 50 ? 'bg-accent-amber' : 'bg-accent-red',
                )}
                style={{ width: `${scorePct}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={handleReset}
            className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary hover:border-text-dim text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"
          >
            <RotateCcw size={13} />
            Reset
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-1.5"
          >
            <CheckCircle2 size={13} />
            Submit & grade
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Question renderer ─────────────────────────────────────────────────────────

function QuestionRenderer({
  q, num, answer, result, onAnswer, showAnswer,
}: {
  q: Question;
  num: number;
  answer: AnswerState[string] | undefined;
  result: 'correct' | 'incorrect' | 'ungraded' | undefined;
  onAnswer: (v: AnswerState[string]) => void;
  showAnswer: boolean;
}) {
  const marks = q.marks ? `  [${q.marks} mark${q.marks === 1 ? '' : 's'}]` : '';

  return (
    <div
      className={clsx(
        'p-3 rounded-btn border',
        result === 'correct' && 'border-accent-green/50 bg-accent-green/5',
        result === 'incorrect' && 'border-accent-red/50 bg-accent-red/5',
        !result && 'border-border',
      )}
    >
      <div className="flex items-start gap-2 mb-2">
        <span className="font-rajdhani font-bold text-accent-cyan shrink-0">{num}.</span>
        <div className="flex-1">
          <div className="flex items-start gap-2">
            <p className="text-sm text-text-primary flex-1">
              {q.prompt.replace(/\{\{\d+\}\}/g, '______')}
              <span className="text-text-dim text-xs">{marks}</span>
            </p>
            {result === 'correct' && <CheckCircle2 size={16} className="text-accent-green shrink-0" />}
            {result === 'incorrect' && <XCircle size={16} className="text-accent-red shrink-0" />}
            {result === 'ungraded' && <Circle size={16} className="text-text-dim shrink-0" />}
          </div>
          {q.bloom && (
            <span className="inline-block mt-1 text-[9px] font-mono text-text-dim uppercase tracking-wider">
              {QTYPE_LABELS[q.type]} · {q.bloom}
            </span>
          )}
        </div>
      </div>

      <div className="pl-5">
        {renderInput(q, answer, onAnswer)}

        {showAnswer && result === 'incorrect' && q.answer && (
          <p className="mt-2 text-xs text-accent-green">
            <span className="font-semibold">Correct:</span> {q.answer}
          </p>
        )}
        {showAnswer && q.explanation && (
          <p className="mt-1 text-xs text-text-dim italic">{q.explanation}</p>
        )}
      </div>
    </div>
  );
}

function renderInput(
  q: Question,
  answer: AnswerState[string] | undefined,
  onAnswer: (v: AnswerState[string]) => void,
) {
  switch (q.type) {
    case 'multiple_choice':
      return (
        <div className="space-y-1.5 mt-1">
          {q.choices?.map((c) => (
            <label
              key={c.id}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-btn border cursor-pointer transition-colors',
                answer === c.id
                  ? 'border-accent-cyan bg-bg-elevated'
                  : 'border-border hover:border-text-dim',
              )}
            >
              <input
                type="radio"
                name={q.id}
                value={c.id}
                checked={answer === c.id}
                onChange={() => onAnswer(c.id)}
                className="accent-accent-cyan"
              />
              <span className="text-sm">
                <span className="font-mono text-accent-cyan mr-2">{c.id}.</span>
                {c.text}
              </span>
            </label>
          ))}
        </div>
      );

    case 'true_false':
      return (
        <div className="flex gap-2 mt-1">
          {['true', 'false'].map((v) => (
            <button
              key={v}
              onClick={() => onAnswer(v)}
              className={clsx(
                'px-4 py-1.5 rounded-btn border text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors',
                answer === v
                  ? 'border-accent-cyan text-accent-cyan bg-bg-elevated'
                  : 'border-border text-text-secondary hover:text-text-primary hover:border-text-dim',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      );

    case 'fill_blank': {
      const blanks = q.blanks?.length ?? (q.prompt.match(/\{\{\d+\}\}/g)?.length ?? 1);
      const arr = Array.isArray(answer) ? answer : Array(blanks).fill('');
      return (
        <div className="space-y-2 mt-1">
          {Array.from({ length: blanks }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs font-mono text-text-dim">{i + 1}.</span>
              <input
                type="text"
                value={arr[i] ?? ''}
                onChange={(e) => {
                  const next = [...arr];
                  next[i] = e.target.value;
                  onAnswer(next);
                }}
                className="input flex-1"
                placeholder={`Blank ${i + 1}`}
              />
            </div>
          ))}
        </div>
      );
    }

    case 'matching': {
      const map = (answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {}) as Record<string, string>;
      const rights = q.pairs?.map((p) => p.right) ?? [];
      return (
        <div className="space-y-2 mt-1">
          {q.pairs?.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm flex-1">{p.left}</span>
              <select
                value={map[String(i)] ?? ''}
                onChange={(e) => onAnswer({ ...map, [String(i)]: e.target.value })}
                className="input w-56"
              >
                <option value="">Select match...</option>
                {rights.map((r, j) => (
                  <option key={j} value={r}>{String.fromCharCode(65 + j)}. {r}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      );
    }

    case 'ordering': {
      const seq = Array.isArray(answer) ? answer : (q.sequence ? [...q.sequence].sort(() => Math.random() - 0.5) : []);
      return (
        <div className="space-y-1.5 mt-1">
          <p className="text-xs text-text-dim italic">Drag to reorder (use ↑↓ buttons):</p>
          {seq.map((item, i) => (
            <div key={`${item}-${i}`} className="flex items-center gap-2 p-2 bg-bg-elevated border border-border rounded-btn">
              <span className="font-mono text-accent-cyan">{i + 1}.</span>
              <span className="flex-1 text-sm">{item}</span>
              <button
                disabled={i === 0}
                onClick={() => {
                  const next = [...seq];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  onAnswer(next);
                }}
                className="px-2 py-0.5 text-xs border border-border rounded disabled:opacity-30 hover:border-accent-cyan"
              >
                ↑
              </button>
              <button
                disabled={i === seq.length - 1}
                onClick={() => {
                  const next = [...seq];
                  [next[i], next[i + 1]] = [next[i + 1], next[i]];
                  onAnswer(next);
                }}
                className="px-2 py-0.5 text-xs border border-border rounded disabled:opacity-30 hover:border-accent-cyan"
              >
                ↓
              </button>
            </div>
          ))}
        </div>
      );
    }

    case 'code_trace':
      return (
        <>
          {q.code && (
            <pre className="p-3 mt-1 bg-bg-elevated border border-border rounded-btn overflow-x-auto text-xs font-mono text-text-primary">
              {q.code}
            </pre>
          )}
          <textarea
            value={typeof answer === 'string' ? answer : ''}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder="Expected output / final state..."
            rows={3}
            className="input mt-2 font-mono text-xs"
          />
        </>
      );

    case 'label_diagram':
      return (
        <>
          {q.diagramDescription && (
            <pre className="p-3 mt-1 bg-bg-elevated border border-border rounded-btn overflow-x-auto text-xs font-mono text-text-secondary whitespace-pre">
              {q.diagramDescription}
            </pre>
          )}
          {q.labels && (
            <p className="text-xs text-text-dim italic mt-1">
              Labels: {q.labels.join(', ')}
            </p>
          )}
          <textarea
            value={typeof answer === 'string' ? answer : ''}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder="Describe or list your labels in order..."
            rows={3}
            className="input mt-2"
          />
        </>
      );

    case 'short_answer':
    case 'worked_example':
    case 'long_answer':
    default:
      return (
        <textarea
          value={typeof answer === 'string' ? answer : ''}
          onChange={(e) => onAnswer(e.target.value)}
          placeholder="Your answer..."
          rows={q.type === 'long_answer' || q.type === 'worked_example' ? 6 : 3}
          className="input mt-1"
        />
      );
  }
}

// ─── Grading logic ────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function gradeQuestion(q: Question, a: AnswerState[string] | undefined): 'correct' | 'incorrect' | 'ungraded' {
  if (a === undefined) {
    return ['multiple_choice', 'true_false', 'fill_blank', 'ordering', 'matching'].includes(q.type)
      ? 'incorrect' : 'ungraded';
  }
  switch (q.type) {
    case 'multiple_choice':
      return q.answer && norm(String(a)) === norm(q.answer) ? 'correct' : 'incorrect';
    case 'true_false':
      return q.answer && norm(String(a)) === norm(q.answer) ? 'correct' : 'incorrect';
    case 'fill_blank': {
      if (!Array.isArray(a) || !q.blanks) return 'incorrect';
      const ok = q.blanks.every((b, i) => norm(String(a[i] ?? '')) === norm(b));
      return ok ? 'correct' : 'incorrect';
    }
    case 'ordering': {
      if (!Array.isArray(a) || !q.sequence) return 'incorrect';
      const ok = q.sequence.length === a.length && q.sequence.every((v, i) => norm(v) === norm(String(a[i])));
      return ok ? 'correct' : 'incorrect';
    }
    case 'matching': {
      if (!a || typeof a !== 'object' || Array.isArray(a) || !q.pairs) return 'incorrect';
      const map = a as Record<string, string>;
      const ok = q.pairs.every((p, i) => norm(map[String(i)] ?? '') === norm(p.right));
      return ok ? 'correct' : 'incorrect';
    }
    default:
      return 'ungraded';
  }
}
