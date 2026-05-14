export type RubricStyle = 'analytic' | 'holistic' | 'single_point';

export interface RubricLevel {
  label: string;     // e.g. "Excellent", "Developing", "Beginning"
  score: number;     // e.g. 4, 3, 2, 1
  descriptor: string;
}

export interface RubricCriterion {
  name: string;
  description: string;
  weight?: number;   // percentage weight for analytic
  levels: RubricLevel[];
}

export interface Rubric {
  title: string;
  task: string;
  yearLevel?: string;
  style: RubricStyle;
  maxScore: number;
  instructions?: string;
  criteria: RubricCriterion[];
  /** Holistic only — overall level descriptors */
  holisticLevels?: RubricLevel[];
  curriculumStandard?: string;
}

export interface RubricRequest {
  task: string;
  yearLevel?: string;
  style: RubricStyle;
  criteriaCount: number;
  levelCount: number;
  objectives?: string[];
  curriculumStandard?: string;
  maxScore?: number;
  notes?: string;
}

export function buildRubricPrompt(req: RubricRequest): string {
  const styleDesc: Record<RubricStyle, string> = {
    analytic: `Analytic rubric — ${req.criteriaCount} separate criteria each scored independently. Each criterion has ${req.levelCount} performance levels.`,
    holistic: `Holistic rubric — a single set of ${req.levelCount} overall performance descriptors covering the whole task. Still include ${req.criteriaCount} criteria as brief guides under each level.`,
    single_point: `Single-point rubric — one column describing proficiency. List ${req.criteriaCount} criteria with a single "proficient" descriptor; leave columns for "below" and "above" as empty strings for teacher annotation.`,
  };

  return `You are an expert teacher generating a ${styleDesc[req.style]}
Output ONLY a single JSON object — no prose, no fences.

Task/assessment: ${req.task}
${req.yearLevel ? `Year level: ${req.yearLevel}` : ''}
${req.curriculumStandard ? `Curriculum: ${req.curriculumStandard}` : ''}
${req.maxScore ? `Total marks: ${req.maxScore}` : ''}
${req.objectives?.length ? `Learning objectives:\n${req.objectives.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}` : ''}
${req.notes ? `Additional notes: ${req.notes}` : ''}

RULES:
1. Criteria names: short (2-5 words).
2. Level labels (highest to lowest): choose appropriate terms e.g. Excellent/Proficient/Developing/Beginning, or A/B/C/D, or 4/3/2/1.
3. Each descriptor: 1-2 sentences, specific and observable behaviour.
4. Weights (analytic only): must sum to 100.
5. No markdown in strings.

OUTPUT JSON:
{
  "title": string,
  "task": string,
  "yearLevel"?: string,
  "style": "${req.style}",
  "maxScore": number,
  "instructions"?: string,
  "curriculumStandard"?: string,
  "criteria": [
    {
      "name": string,
      "description": string,
      "weight"?: number,
      "levels": [{ "label": string, "score": number, "descriptor": string }]
    }
  ],
  "holisticLevels"?: [{ "label": string, "score": number, "descriptor": string }]
}

Output JSON now.`;
}

export function parseRubricJson(raw: string): Rubric {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : extractFirst(raw) ?? raw;
  const p = JSON.parse(candidate);
  if (!p || !Array.isArray(p.criteria)) throw new Error('Invalid rubric JSON — missing criteria');
  return {
    title: String(p.title ?? 'Untitled rubric'),
    task: String(p.task ?? ''),
    yearLevel: p.yearLevel ? String(p.yearLevel) : undefined,
    style: (p.style as RubricStyle) ?? 'analytic',
    maxScore: typeof p.maxScore === 'number' ? p.maxScore : 20,
    instructions: p.instructions ? String(p.instructions) : undefined,
    curriculumStandard: p.curriculumStandard ? String(p.curriculumStandard) : undefined,
    criteria: (p.criteria as Record<string, unknown>[]).map((c) => ({
      name: String(c.name ?? ''),
      description: String(c.description ?? ''),
      weight: typeof c.weight === 'number' ? c.weight : undefined,
      levels: Array.isArray(c.levels)
        ? (c.levels as Record<string, unknown>[]).map((l) => ({
            label: String(l.label ?? ''),
            score: typeof l.score === 'number' ? l.score : 0,
            descriptor: String(l.descriptor ?? ''),
          }))
        : [],
    })),
    holisticLevels: Array.isArray(p.holisticLevels)
      ? (p.holisticLevels as Record<string, unknown>[]).map((l) => ({
          label: String(l.label ?? ''),
          score: typeof l.score === 'number' ? l.score : 0,
          descriptor: String(l.descriptor ?? ''),
        }))
      : undefined,
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

export const STYLE_LABELS: Record<RubricStyle, string> = {
  analytic: 'Analytic',
  holistic: 'Holistic',
  single_point: 'Single-point',
};

export const STYLE_DESCRIPTIONS: Record<RubricStyle, string> = {
  analytic: 'Criteria rated independently — granular feedback',
  holistic: 'Single overall descriptor per level — fast marking',
  single_point: 'Proficiency column only — leave room for annotation',
};
