/**
 * PDF Document schema — lesson plans (5E, Gagne, direct-instruction), handouts,
 * parent letters, report comments, IEP notes. The AI returns a structured
 * document with sections which we render to PDF / DOCX.
 */

export type DocumentType =
  | 'lesson_plan_5e'
  | 'lesson_plan_gagne'
  | 'lesson_plan_direct'
  | 'handout'
  | 'cheat_sheet'
  | 'parent_letter'
  | 'report_comment'
  | 'iep_note';

export interface DocBlock {
  /** Section heading */
  heading?: string;
  /** Narrative paragraphs */
  paragraphs?: string[];
  /** Bulleted list */
  bullets?: string[];
  /** Numbered list */
  numbered?: string[];
  /** Table: first row is header */
  table?: string[][];
  /** Callout (highlighted note) */
  callout?: { label: string; text: string };
  /** Key-value pair block (e.g. metadata) */
  keyValue?: Array<{ key: string; value: string }>;
}

export interface StructuredDocument {
  title: string;
  subtitle?: string;
  documentType: DocumentType;
  meta: {
    topic: string;
    yearLevel?: string;
    date?: string;
    teacherName?: string;
    schoolName?: string;
    curriculumStandard?: string;
    durationMin?: number;
  };
  blocks: DocBlock[];
}

export interface DocumentRequest {
  documentType: DocumentType;
  topic: string;
  yearLevel?: string;
  tone?: 'formal' | 'warm' | 'neutral' | 'concise';
  length?: 'short' | 'medium' | 'long';
  durationMin?: number;
  curriculumStandard?: string;
  teacherName?: string;
  schoolName?: string;
  studentName?: string;
  notes?: string;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  lesson_plan_5e: 'Lesson plan — 5E model',
  lesson_plan_gagne: 'Lesson plan — Gagne 9 events',
  lesson_plan_direct: 'Lesson plan — Direct instruction',
  handout: 'Student handout',
  cheat_sheet: 'Cheat sheet',
  parent_letter: 'Parent letter',
  report_comment: 'Report comment',
  iep_note: 'IEP / ILP note',
};

export const DOC_TYPE_DESCRIPTIONS: Record<DocumentType, string> = {
  lesson_plan_5e: 'Engage · Explore · Explain · Elaborate · Evaluate',
  lesson_plan_gagne: "Gagne's 9 events of instruction",
  lesson_plan_direct: 'I do · We do · You do progression',
  handout: 'Student-facing reference or reading',
  cheat_sheet: 'Compact summary / quick reference',
  parent_letter: 'Letter home about a student or unit',
  report_comment: 'Balanced report-card style paragraph',
  iep_note: 'Goals, strategies, adjustments',
};

// ─── Prompt builder ───────────────────────────────────────────────────────────

function scaffoldForType(type: DocumentType): string {
  switch (type) {
    case 'lesson_plan_5e':
      return `Structure the lesson with these sections (use as "heading" values):
  1. Overview (paragraphs: summary, rationale)
  2. Learning Objectives (bullets — student-facing, measurable)
  3. Materials (bullets)
  4. Engage (paragraphs — hook activity; timing cue)
  5. Explore (paragraphs + bullets — guided investigation)
  6. Explain (paragraphs — direct instruction + concept consolidation)
  7. Elaborate (paragraphs — application / extension task)
  8. Evaluate (bullets — formative / summative checks)
  9. Differentiation (bullets)
  10. Assessment Evidence (bullets)`;
    case 'lesson_plan_gagne':
      return `Structure the lesson using Gagne's 9 events (each as a heading with paragraphs):
  1. Gain attention
  2. Inform learners of objectives
  3. Stimulate recall of prior learning
  4. Present the content
  5. Provide learning guidance
  6. Elicit performance (practice)
  7. Provide feedback
  8. Assess performance
  9. Enhance retention and transfer`;
    case 'lesson_plan_direct':
      return `Structure using Direct Instruction:
  1. Learning Intention (paragraphs)
  2. Success Criteria (bullets)
  3. I Do (modelled, paragraphs)
  4. We Do (guided practice, bullets)
  5. You Do (independent practice, bullets)
  6. Check for Understanding (bullets)
  7. Close (paragraphs)`;
    case 'handout':
      return `Structure as a student handout:
  1. Big Idea (paragraphs)
  2. Key Concepts (bullets)
  3. Worked example or diagram description (paragraphs)
  4. Quick Check questions (numbered)
  5. Glossary (keyValue pairs)`;
    case 'cheat_sheet':
      return `Structure as a compact cheat sheet:
  1. Key formulas / rules (bullets)
  2. Definitions (keyValue)
  3. Common mistakes (bullets)
  4. Worked example (paragraphs)`;
    case 'parent_letter':
      return `Structure as a warm parent letter:
  1. Greeting (paragraphs)
  2. What we're learning (paragraphs)
  3. How you can help at home (bullets)
  4. Key dates (bullets)
  5. Sign-off (paragraphs)`;
    case 'report_comment':
      return `Structure as a balanced report comment:
  1. Strengths (paragraphs)
  2. Areas for growth (paragraphs)
  3. Next steps (bullets)
Keep under 200 words total unless "length":"long".`;
    case 'iep_note':
      return `Structure as an IEP / ILP note:
  1. Student context (paragraphs)
  2. Goals (numbered — specific, measurable)
  3. Strategies & adjustments (bullets)
  4. Measurement / evidence (bullets)
  5. Review schedule (keyValue)`;
  }
}

export function buildDocumentPrompt(req: DocumentRequest): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are an expert teacher producing a structured ${DOC_TYPE_LABELS[req.documentType]}.
Output ONLY a single JSON object — no prose, no fences.

Document type: ${req.documentType}
Topic: ${req.topic}
${req.yearLevel ? `Year level: ${req.yearLevel}` : ''}
${req.durationMin ? `Duration: ${req.durationMin} minutes` : ''}
${req.curriculumStandard ? `Curriculum: ${req.curriculumStandard}` : ''}
${req.teacherName ? `Teacher: ${req.teacherName}` : ''}
${req.schoolName ? `School: ${req.schoolName}` : ''}
${req.studentName ? `Student: ${req.studentName}` : ''}
Tone: ${req.tone ?? 'neutral'}
Length: ${req.length ?? 'medium'}
Date: ${today}
${req.notes ? `Additional instructions: ${req.notes}` : ''}

${scaffoldForType(req.documentType)}

RULES:
1. Use plain text inside strings — no markdown syntax, no asterisks for bold.
2. Keep paragraph strings tight (2–4 sentences each).
3. ALL spelling must be correct — double-check subject-specific terminology, proper nouns, and technical terms.
4. Content must be factually accurate and age-appropriate for the specified year level.
5. Return the following shape exactly:

{
  "title": string,
  "subtitle"?: string,
  "documentType": "${req.documentType}",
  "meta": {
    "topic": string,
    "yearLevel"?: string,
    "date"?: string,
    "teacherName"?: string,
    "schoolName"?: string,
    "curriculumStandard"?: string,
    "durationMin"?: number
  },
  "blocks": [
    {
      "heading"?: string,
      "paragraphs"?: string[],
      "bullets"?: string[],
      "numbered"?: string[],
      "table"?: string[][],
      "callout"?: { "label": string, "text": string },
      "keyValue"?: [{ "key": string, "value": string }]
    }
  ]
}

Output JSON now.`;
}

// ─── Tolerant JSON parser ─────────────────────────────────────────────────────

export function parseDocumentJson(raw: string, fallbackType: DocumentType): StructuredDocument {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : extractFirstJsonObject(raw) ?? raw;
  const parsed = JSON.parse(candidate);

  if (!parsed || !Array.isArray(parsed.blocks)) {
    throw new Error('Invalid document JSON — missing blocks array');
  }

  const meta = (parsed.meta ?? {}) as Record<string, unknown>;

  return {
    title: String(parsed.title ?? 'Untitled document'),
    subtitle: parsed.subtitle ? String(parsed.subtitle) : undefined,
    documentType: (parsed.documentType as DocumentType) ?? fallbackType,
    meta: {
      topic: String(meta.topic ?? ''),
      yearLevel: meta.yearLevel ? String(meta.yearLevel) : undefined,
      date: meta.date ? String(meta.date) : undefined,
      teacherName: meta.teacherName ? String(meta.teacherName) : undefined,
      schoolName: meta.schoolName ? String(meta.schoolName) : undefined,
      curriculumStandard: meta.curriculumStandard ? String(meta.curriculumStandard) : undefined,
      durationMin: typeof meta.durationMin === 'number' ? meta.durationMin : undefined,
    },
    blocks: (parsed.blocks as Record<string, unknown>[]).map((b) => ({
      heading: b.heading ? String(b.heading) : undefined,
      paragraphs: Array.isArray(b.paragraphs) ? (b.paragraphs as unknown[]).map(String) : undefined,
      bullets: Array.isArray(b.bullets) ? (b.bullets as unknown[]).map(String) : undefined,
      numbered: Array.isArray(b.numbered) ? (b.numbered as unknown[]).map(String) : undefined,
      table: Array.isArray(b.table)
        ? (b.table as unknown[]).map((row) => Array.isArray(row) ? (row as unknown[]).map(String) : [])
        : undefined,
      callout: b.callout
        ? {
            label: String((b.callout as Record<string, unknown>).label ?? 'Note'),
            text: String((b.callout as Record<string, unknown>).text ?? ''),
          }
        : undefined,
      keyValue: Array.isArray(b.keyValue)
        ? (b.keyValue as Record<string, unknown>[]).map((kv) => ({
            key: String(kv.key ?? ''),
            value: String(kv.value ?? ''),
          }))
        : undefined,
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
