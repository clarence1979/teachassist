export type NotesDepth = 'overview' | 'standard' | 'detailed';

export interface NotesBlock {
  /** e.g. "What is photosynthesis?" */
  heading: string;
  /** H3 sub-sections */
  subSections?: Array<{
    heading: string;
    paragraphs: string[];
    bullets?: string[];
    example?: string;
  }>;
  paragraphs?: string[];
  bullets?: string[];
  /** Inline worked example */
  example?: string;
  /** Callout — tip / warning / note */
  callout?: { type: 'note' | 'tip' | 'warning'; text: string };
  /** Diagram description (ASCII / textual) */
  diagram?: string;
  /** Quick-check questions at end of section */
  quickCheck?: string[];
}

export interface GlossaryEntry {
  term: string;
  definition: string;
}

export interface StudentNotes {
  title: string;
  topic: string;
  yearLevel: string;
  depth: NotesDepth;
  objectives?: string[];
  blocks: NotesBlock[];
  glossary?: GlossaryEntry[];
  /** Self-check questions across the whole set */
  selfCheck?: string[];
}

export interface NotesRequest {
  topic: string;
  yearLevel: string;
  depth: NotesDepth;
  includeDiagrams: boolean;
  includeGlossary: boolean;
  includeSelfCheck: boolean;
  curriculumStandard?: string;
  objectives?: string[];
  notes?: string;
}

export function buildNotesPrompt(req: NotesRequest): string {
  const depthDesc: Record<NotesDepth, string> = {
    overview: 'broad overview — key ideas only, minimal technical depth, 2-3 blocks',
    standard: 'standard lesson notes — moderate detail, 4-6 blocks',
    detailed: 'detailed reference notes — deep coverage, 6-10 blocks with full explanations',
  };
  return `You are an expert teacher producing student notes. Output ONLY a single JSON object — no prose, no fences.

Topic: ${req.topic}
Year level: ${req.yearLevel}
Depth: ${depthDesc[req.depth]}
${req.curriculumStandard ? `Curriculum: ${req.curriculumStandard}` : ''}
${req.objectives?.length ? `Objectives:\n${req.objectives.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}` : ''}
${req.notes ? `Additional instructions: ${req.notes}` : ''}

Include diagrams: ${req.includeDiagrams ? 'yes — use ASCII art or textual diagram descriptions in "diagram" fields' : 'no'}
Include glossary: ${req.includeGlossary ? 'yes' : 'no'}
Include self-check: ${req.includeSelfCheck ? 'yes — 3-5 questions at end' : 'no'}

RULES:
1. Write at ${req.yearLevel} reading level.
2. Paragraphs: 2-4 sentences each.
3. No markdown syntax inside strings (no **, no ##).
4. Quick-check questions per block: 1-3 short questions students can answer after reading.
5. Examples: show a single concrete worked example where relevant.

OUTPUT JSON SHAPE:
{
  "title": string,
  "topic": string,
  "yearLevel": string,
  "depth": "${req.depth}",
  "objectives"?: string[],
  "blocks": [
    {
      "heading": string,
      "subSections"?: [{ "heading": string, "paragraphs": string[], "bullets"?: string[], "example"?: string }],
      "paragraphs"?: string[],
      "bullets"?: string[],
      "example"?: string,
      "callout"?: { "type": "note"|"tip"|"warning", "text": string },
      "diagram"?: string,
      "quickCheck"?: string[]
    }
  ],
  "glossary"?: [{ "term": string, "definition": string }],
  "selfCheck"?: string[]
}

Output JSON now.`;
}

export function parseNotesJson(raw: string): StudentNotes {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : extractFirst(raw) ?? raw;
  const p = JSON.parse(candidate);
  if (!p || !Array.isArray(p.blocks)) throw new Error('Invalid notes JSON — missing blocks');
  return {
    title: String(p.title ?? 'Untitled notes'),
    topic: String(p.topic ?? ''),
    yearLevel: String(p.yearLevel ?? ''),
    depth: (p.depth as NotesDepth) ?? 'standard',
    objectives: Array.isArray(p.objectives) ? p.objectives.map(String) : undefined,
    blocks: (p.blocks as Record<string, unknown>[]).map((b) => ({
      heading: String(b.heading ?? ''),
      subSections: Array.isArray(b.subSections)
        ? (b.subSections as Record<string, unknown>[]).map((s) => ({
            heading: String(s.heading ?? ''),
            paragraphs: Array.isArray(s.paragraphs) ? (s.paragraphs as unknown[]).map(String) : [],
            bullets: Array.isArray(s.bullets) ? (s.bullets as unknown[]).map(String) : undefined,
            example: s.example ? String(s.example) : undefined,
          }))
        : undefined,
      paragraphs: Array.isArray(b.paragraphs) ? (b.paragraphs as unknown[]).map(String) : undefined,
      bullets: Array.isArray(b.bullets) ? (b.bullets as unknown[]).map(String) : undefined,
      example: b.example ? String(b.example) : undefined,
      callout: b.callout
        ? { type: (b.callout as Record<string, unknown>).type as 'note' | 'tip' | 'warning', text: String((b.callout as Record<string, unknown>).text ?? '') }
        : undefined,
      diagram: b.diagram ? String(b.diagram) : undefined,
      quickCheck: Array.isArray(b.quickCheck) ? (b.quickCheck as unknown[]).map(String) : undefined,
    })),
    glossary: Array.isArray(p.glossary)
      ? (p.glossary as Record<string, unknown>[]).map((g) => ({ term: String(g.term ?? ''), definition: String(g.definition ?? '') }))
      : undefined,
    selfCheck: Array.isArray(p.selfCheck) ? (p.selfCheck as unknown[]).map(String) : undefined,
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

export const DEPTH_LABELS: Record<NotesDepth, string> = {
  overview: 'Overview',
  standard: 'Standard',
  detailed: 'Detailed',
};
