/**
 * Worksheet schema — Diffit-style differentiated worksheets with rich question types.
 * The AI returns a JSON object with a differentiated tiers array, each containing
 * the full worksheet at a given reading level.
 */

export type QuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'short_answer'
  | 'long_answer'
  | 'fill_blank'
  | 'matching'
  | 'ordering'
  | 'label_diagram'
  | 'code_trace'
  | 'worked_example';

export type DifficultyTier = 'below' | 'on' | 'above' | 'extension';

export type BloomLevel =
  | 'remember' | 'understand' | 'apply'
  | 'analyze' | 'evaluate' | 'create';

export interface MCQChoice {
  id: string;      // "A" | "B" | "C" | "D"
  text: string;
}

export interface MatchingPair {
  left: string;
  right: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  bloom?: BloomLevel;
  prompt: string;
  /** For MCQ */
  choices?: MCQChoice[];
  /** MCQ answer id / T-F 'true'|'false' / fill answers */
  answer?: string;
  /** Fill-in-the-blank: array of answers in order of {{blanks}} */
  blanks?: string[];
  /** Matching pairs */
  pairs?: MatchingPair[];
  /** Ordering: the correct sequence */
  sequence?: string[];
  /** Label-the-diagram: ASCII / described image with labels list */
  diagramDescription?: string;
  labels?: string[];
  /** Code-trace: code snippet to trace */
  code?: string;
  language?: string;
  /** Worked-example: expected working / solution steps */
  workedSolution?: string;
  /** Explanation shown in the answer key */
  explanation?: string;
  /** Marks allocated */
  marks?: number;
}

export interface WorksheetTier {
  tier: DifficultyTier;
  readingLevelNote: string;
  instructions: string;
  questions: Question[];
}

export interface Worksheet {
  title: string;
  topic: string;
  yearLevel: string;
  curriculumStandard?: string;
  estimatedTimeMin?: number;
  bloomOverall?: BloomLevel;
  tiers: WorksheetTier[];
}

export interface WorksheetRequest {
  topic: string;
  yearLevel: string;
  curriculumStandard?: string;
  sourceText?: string;
  questionTypes: QuestionType[];
  questionsPerTier: number;
  tiers: DifficultyTier[];
  bloom?: BloomLevel;
  estimatedTimeMin?: number;
  includeAnswerKey: boolean;
  /** Extra teacher instructions */
  notes?: string;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

const QTYPE_INSTRUCTIONS: Record<QuestionType, string> = {
  multiple_choice: 'multiple_choice — 4 choices (A,B,C,D); set "answer" to the correct id.',
  true_false: 'true_false — set "answer" to "true" or "false".',
  short_answer: 'short_answer — single-sentence answer expected; provide model answer in "answer".',
  long_answer: 'long_answer — extended-response; provide detailed model response in "answer".',
  fill_blank: 'fill_blank — use {{1}}, {{2}} markers inside "prompt"; provide ordered "blanks" array.',
  matching: 'matching — provide "pairs" array of { left, right }.',
  ordering: 'ordering — provide "sequence" in correct order (AI should also scramble in prompt text).',
  label_diagram: 'label_diagram — describe a clearly labellable diagram in "diagramDescription" (ASCII allowed) and list expected "labels".',
  code_trace: 'code_trace — provide "code" + "language"; "answer" is the expected output / final state.',
  worked_example: 'worked_example — provide a problem in "prompt" and a step-by-step "workedSolution".',
};

export function buildWorksheetPrompt(req: WorksheetRequest): string {
  const typeNotes = req.questionTypes
    .map((t) => `  • ${QTYPE_INSTRUCTIONS[t]}`).join('\n');

  const tierDescriptions: Record<DifficultyTier, string> = {
    below: 'Below-level — simplified vocabulary (roughly 2 grade levels below target), shorter sentences, more scaffolding, visual cues where possible.',
    on: 'On-level — grade-appropriate vocabulary and cognitive load.',
    above: 'Above-level — extended vocabulary, multi-step reasoning, fewer hints.',
    extension: 'Extension — open-ended, synthesis / evaluation tasks that go beyond the lesson.',
  };

  const tiersBlock = req.tiers
    .map((t) => `  • ${t}: ${tierDescriptions[t]}`).join('\n');

  return `You are an expert teacher creating a differentiated worksheet. Output ONLY a single JSON object — no prose, no fences.

Topic: ${req.topic}
Year level: ${req.yearLevel}
${req.curriculumStandard ? `Curriculum standard: ${req.curriculumStandard}` : ''}
${req.estimatedTimeMin ? `Estimated time: ${req.estimatedTimeMin} minutes` : ''}
${req.bloom ? `Overall Bloom's level: ${req.bloom}` : ''}
${req.notes ? `Additional notes: ${req.notes}` : ''}
${req.sourceText ? `\nSOURCE TEXT (base questions on this):\n"""\n${req.sourceText.slice(0, 6000)}\n"""` : ''}

Required tiers (produce ALL of these):
${tiersBlock}

Required question types (distribute across these):
${typeNotes}

RULES:
1. Each tier MUST contain EXACTLY ${req.questionsPerTier} questions.
2. All tiers cover the SAME content and learning objectives — only the reading level / scaffolding differs.
3. Questions are numbered within each tier.
4. Each question MUST include an accurate answer / model response.
5. Use plain text — no markdown, no LaTeX (unless essential, then use plain ascii).
6. For "fill_blank" prompts ONLY, use {{1}}, {{2}}, etc. as blank markers in the prompt text. NEVER use {{n}} markers in any other question type.
7. Tag each question with a "bloom" value when appropriate.
8. Keep language age-appropriate for ${req.yearLevel}.
9. ALL spelling must be correct. Double-check scientific/technical terms before including them.
10. Ensure questions are factually accurate — verify the correct answer IS correct before including it.

OUTPUT (single JSON object, no code fences):

{
  "title": string,
  "topic": string,
  "yearLevel": string,
  "curriculumStandard"?: string,
  "estimatedTimeMin"?: number,
  "bloomOverall"?: string,
  "tiers": [
    {
      "tier": "below" | "on" | "above" | "extension",
      "readingLevelNote": string,
      "instructions": string,
      "questions": [
        {
          "id": string,
          "type": "multiple_choice" | "true_false" | "short_answer" | "long_answer" | "fill_blank" | "matching" | "ordering" | "label_diagram" | "code_trace" | "worked_example",
          "bloom"?: string,
          "prompt": string,
          "choices"?: [{ "id": "A"|"B"|"C"|"D", "text": string }],
          "answer"?: string,
          "blanks"?: string[],
          "pairs"?: [{ "left": string, "right": string }],
          "sequence"?: string[],
          "diagramDescription"?: string,
          "labels"?: string[],
          "code"?: string,
          "language"?: string,
          "workedSolution"?: string,
          "explanation"?: string,
          "marks"?: number
        }
      ]
    }
  ]
}

Output JSON now.`;
}

// ─── Tolerant JSON parser ─────────────────────────────────────────────────────

export function parseWorksheetJson(raw: string): Worksheet {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : extractFirstJsonObject(raw) ?? raw;
  const parsed = JSON.parse(candidate);

  if (!parsed || !Array.isArray(parsed.tiers)) {
    throw new Error('Invalid worksheet JSON — missing tiers array');
  }

  return {
    title: String(parsed.title ?? 'Untitled worksheet'),
    topic: String(parsed.topic ?? ''),
    yearLevel: String(parsed.yearLevel ?? ''),
    curriculumStandard: parsed.curriculumStandard ? String(parsed.curriculumStandard) : undefined,
    estimatedTimeMin: typeof parsed.estimatedTimeMin === 'number' ? parsed.estimatedTimeMin : undefined,
    bloomOverall: parsed.bloomOverall as BloomLevel | undefined,
    tiers: (parsed.tiers as Record<string, unknown>[]).map((t) => ({
      tier: (t.tier as DifficultyTier) ?? 'on',
      readingLevelNote: String(t.readingLevelNote ?? ''),
      instructions: String(t.instructions ?? ''),
      questions: Array.isArray(t.questions)
        ? (t.questions as Record<string, unknown>[]).map((q, idx) => ({
            id: String(q.id ?? `q${idx + 1}`),
            type: (q.type as QuestionType) ?? 'short_answer',
            bloom: q.bloom as BloomLevel | undefined,
            prompt: String(q.prompt ?? ''),
            choices: Array.isArray(q.choices)
              ? (q.choices as Record<string, unknown>[]).map((c) => ({
                  id: String(c.id ?? ''),
                  text: String(c.text ?? ''),
                }))
              : undefined,
            answer: q.answer !== undefined ? String(q.answer) : undefined,
            blanks: Array.isArray(q.blanks) ? (q.blanks as unknown[]).map(String) : undefined,
            pairs: Array.isArray(q.pairs)
              ? (q.pairs as Record<string, unknown>[]).map((p) => ({
                  left: String(p.left ?? ''),
                  right: String(p.right ?? ''),
                }))
              : undefined,
            sequence: Array.isArray(q.sequence) ? (q.sequence as unknown[]).map(String) : undefined,
            diagramDescription: q.diagramDescription ? String(q.diagramDescription) : undefined,
            labels: Array.isArray(q.labels) ? (q.labels as unknown[]).map(String) : undefined,
            code: q.code ? String(q.code) : undefined,
            language: q.language ? String(q.language) : undefined,
            workedSolution: q.workedSolution ? String(q.workedSolution) : undefined,
            explanation: q.explanation ? String(q.explanation) : undefined,
            marks: typeof q.marks === 'number' ? q.marks : undefined,
          }))
        : [],
    })),
  };
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export const QTYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple choice',
  true_false: 'True / False',
  short_answer: 'Short answer',
  long_answer: 'Long answer',
  fill_blank: 'Fill the blank',
  matching: 'Matching',
  ordering: 'Ordering',
  label_diagram: 'Label the diagram',
  code_trace: 'Code trace',
  worked_example: 'Worked example',
};

export const TIER_LABELS: Record<DifficultyTier, string> = {
  below: 'Below-level',
  on: 'On-level',
  above: 'Above-level',
  extension: 'Extension',
};

export const BLOOM_LABELS: Record<BloomLevel, string> = {
  remember: 'Remember',
  understand: 'Understand',
  apply: 'Apply',
  analyze: 'Analyze',
  evaluate: 'Evaluate',
  create: 'Create',
};
