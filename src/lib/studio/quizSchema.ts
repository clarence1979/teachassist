import type { QuestionType, BloomLevel } from './worksheetSchema';
export type { QuestionType, BloomLevel };

export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'mixed';

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  bloom?: BloomLevel;
  difficulty: 'easy' | 'medium' | 'hard';
  points: number;
  prompt: string;
  choices?: Array<{ id: string; text: string }>;
  answer?: string;
  blanks?: string[];
  pairs?: Array<{ left: string; right: string }>;
  sequence?: string[];
  code?: string;
  language?: string;
  workedSolution?: string;
  explanation?: string;
  /** Topic tag for CSV export */
  tag?: string;
}

export interface Quiz {
  title: string;
  topic: string;
  yearLevel: string;
  timeLimitMin?: number;
  totalPoints: number;
  instructions: string;
  questions: QuizQuestion[];
  curriculumStandard?: string;
}

export interface QuizRequest {
  topic: string;
  yearLevel: string;
  questionCount: number;
  questionTypes: QuestionType[];
  difficulty: DifficultyLevel;
  timeLimitMin?: number;
  curriculumStandard?: string;
  bloomFocus?: BloomLevel;
  includeAnswerKey: boolean;
  randomiseOrder: boolean;
  notes?: string;
}

export function buildQuizPrompt(req: QuizRequest): string {
  const diffNote: Record<DifficultyLevel, string> = {
    easy: 'all questions at easy difficulty (recall, single-step)',
    medium: 'all questions at medium difficulty (application, 2-step)',
    hard: 'all questions at hard difficulty (analysis, multi-step)',
    mixed: 'mix: ~40% easy, 40% medium, 20% hard — vary the "difficulty" field accordingly',
  };
  const types = req.questionTypes.join(', ');
  return `You are an expert teacher generating a ${req.questionCount}-question quiz/test. Output ONLY a single JSON object — no prose, no fences.

Topic: ${req.topic}
Year level: ${req.yearLevel}
Question types to use: ${types}
Difficulty: ${diffNote[req.difficulty]}
${req.timeLimitMin ? `Time limit: ${req.timeLimitMin} minutes` : ''}
${req.curriculumStandard ? `Curriculum: ${req.curriculumStandard}` : ''}
${req.bloomFocus ? `Bloom's focus: ${req.bloomFocus}` : ''}
${req.notes ? `Notes: ${req.notes}` : ''}

RULES:
1. Produce EXACTLY ${req.questionCount} questions.
2. Assign point values: easy=1, medium=2, hard=3. For worked examples and code trace, use 3-5.
3. Every question must have a correct "answer" or "workedSolution".
4. Distribute question types across: ${types}.
5. For multiple_choice: 4 choices A/B/C/D, answer = the id.
6. For fill_blank: use {{1}},{{2}} markers, answer in "blanks" array.
7. For matching: "pairs" array of {left, right}.
8. For code_trace: "code" + "language", answer = expected output.
9. Add a short "tag" per question (topic sub-area).
10. Write at ${req.yearLevel} level. No markdown in strings.

OUTPUT JSON:
{
  "title": string,
  "topic": string,
  "yearLevel": string,
  "timeLimitMin"?: number,
  "totalPoints": number,
  "instructions": string,
  "curriculumStandard"?: string,
  "questions": [
    {
      "id": string,
      "type": "multiple_choice"|"true_false"|"short_answer"|"long_answer"|"fill_blank"|"matching"|"ordering"|"code_trace"|"worked_example",
      "bloom"?: string,
      "difficulty": "easy"|"medium"|"hard",
      "points": number,
      "prompt": string,
      "choices"?: [{"id":"A"|"B"|"C"|"D","text":string}],
      "answer"?: string,
      "blanks"?: string[],
      "pairs"?: [{"left":string,"right":string}],
      "sequence"?: string[],
      "code"?: string,
      "language"?: string,
      "workedSolution"?: string,
      "explanation"?: string,
      "tag"?: string
    }
  ]
}

Output JSON now.`;
}

export function parseQuizJson(raw: string): Quiz {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : extractFirst(raw) ?? raw;
  const p = JSON.parse(candidate);
  if (!p || !Array.isArray(p.questions)) throw new Error('Invalid quiz JSON — missing questions');
  const questions: QuizQuestion[] = (p.questions as Record<string, unknown>[]).map((q, idx) => ({
    id: String(q.id ?? `q${idx + 1}`),
    type: (q.type as QuestionType) ?? 'short_answer',
    bloom: q.bloom as BloomLevel | undefined,
    difficulty: (q.difficulty as 'easy' | 'medium' | 'hard') ?? 'medium',
    points: typeof q.points === 'number' ? q.points : 1,
    prompt: String(q.prompt ?? ''),
    choices: Array.isArray(q.choices)
      ? (q.choices as Record<string, unknown>[]).map((c) => ({ id: String(c.id), text: String(c.text) }))
      : undefined,
    answer: q.answer !== undefined ? String(q.answer) : undefined,
    blanks: Array.isArray(q.blanks) ? (q.blanks as unknown[]).map(String) : undefined,
    pairs: Array.isArray(q.pairs)
      ? (q.pairs as Record<string, unknown>[]).map((pp) => ({ left: String(pp.left), right: String(pp.right) }))
      : undefined,
    sequence: Array.isArray(q.sequence) ? (q.sequence as unknown[]).map(String) : undefined,
    code: q.code ? String(q.code) : undefined,
    language: q.language ? String(q.language) : undefined,
    workedSolution: q.workedSolution ? String(q.workedSolution) : undefined,
    explanation: q.explanation ? String(q.explanation) : undefined,
    tag: q.tag ? String(q.tag) : undefined,
  }));
  return {
    title: String(p.title ?? 'Untitled quiz'),
    topic: String(p.topic ?? ''),
    yearLevel: String(p.yearLevel ?? ''),
    timeLimitMin: typeof p.timeLimitMin === 'number' ? p.timeLimitMin : undefined,
    totalPoints: typeof p.totalPoints === 'number' ? p.totalPoints : questions.reduce((s, q) => s + q.points, 0),
    instructions: String(p.instructions ?? ''),
    curriculumStandard: p.curriculumStandard ? String(p.curriculumStandard) : undefined,
    questions,
  };
}

function extractFirst(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

export const DIFFICULTY_LABELS: Record<'easy' | 'medium' | 'hard' | 'mixed', string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  mixed: 'Mixed',
};

/** Export quiz results to CSV blob */
export function buildResultsCsv(
  quiz: Quiz,
  answers: Record<string, string | string[] | Record<string, string>>,
  results: Record<string, 'correct' | 'incorrect' | 'ungraded'>,
): string {
  const header = 'Question,Type,Points,Tag,Student Answer,Result';
  const rows = quiz.questions.map((q) => {
    const a = answers[q.id];
    const ansStr = Array.isArray(a) ? a.join(';') : typeof a === 'object' && a ? JSON.stringify(a) : String(a ?? '');
    return [
      `"${q.prompt.replace(/"/g, '""').slice(0, 80)}"`,
      q.type,
      q.points,
      q.tag ?? '',
      `"${ansStr.replace(/"/g, '""')}"`,
      results[q.id] ?? 'ungraded',
    ].join(',');
  });
  return [header, ...rows].join('\n');
}
