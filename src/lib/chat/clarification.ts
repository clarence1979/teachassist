/**
 * Pre-flight clarification loop for teaching-artifact generation.
 *
 * Before the assistant produces any artifact (slides, worksheet, notes, quiz,
 * rubric, lesson plan), it must verify the four required fields are known:
 *   - topic
 *   - year_level
 *   - output_type
 *   - length
 *
 * The model responds with a strict JSON object:
 *   { "ask": "<single question>", "missing": [...] }
 *   or
 *   { "ready": true, "plan": "<one-sentence outline>" }
 *
 * The controller keeps asking until `ready: true`.
 */

export const REQUIRED_FIELDS = ['topic', 'year_level', 'output_type', 'length'] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export const OPTIONAL_FIELDS = ['curriculum_standard'] as const;

export const CLARIFICATION_TRIGGERS = [
  'slide', 'deck', 'presentation', 'powerpoint', 'pptx',
  'worksheet', 'handout',
  'notes', 'student notes',
  'quiz', 'test',
  'rubric',
  'lesson plan', 'lesson',
  'pdf document',
  'differentiate',
];

/**
 * Heuristic — does the user's message look like an artifact request?
 * If not, skip clarification entirely and go straight to normal chat.
 */
export function looksLikeArtifactRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return CLARIFICATION_TRIGGERS.some((kw) => lower.includes(kw));
}

/**
 * System prompt injected ahead of the user message during pre-flight.
 * Intentionally strict JSON-only output so the controller can parse it.
 */
export const PREFLIGHT_SYSTEM_PROMPT = `You are Teach Assist's pre-flight clarifier.

Before any teaching artifact (slides, worksheet, notes, quiz, rubric, lesson plan, handout, PDF document) can be generated, you must verify the request includes ALL of these fields:

REQUIRED:
- topic: the subject or syllabus point (e.g. "photosynthesis", "VCE Applied Computing U2O1 — data validation")
- year_level: the year level or age band (e.g. "Year 8", "Year 10 extension")
- output_type: slides / worksheet / notes / quiz / lesson_plan / rubric / handout / pdf_document
- length: slide count, page count, question count, or duration in minutes

OPTIONAL (do not ask for it, but accept it if given):
- curriculum_standard: one of "Australian Curriculum v9", "VCAA", "Common Core", "NGSS", "IB"

RULES:
1. Inspect the conversation. Identify which REQUIRED fields are missing.
2. If any required field is missing: respond with ONLY this JSON (no prose, no code fences):
   {"ask": "<one single focused question about the FIRST missing field>", "missing": ["<field>", ...]}
3. Ask ONE question at a time. Never dump a form.
4. Be conversational in the question, not robotic. Example: "What year level is this for?" not "Please provide year_level."
5. If ALL required fields are present: respond with ONLY this JSON:
   {"ready": true, "plan": "<one-sentence outline of what you will produce>"}

Output ONLY valid JSON. No markdown. No code fences. No explanation before or after.`;

// ─── Response parsing ────────────────────────────────────────────────────────

export interface PreflightAsk {
  kind: 'ask';
  question: string;
  missing: string[];
}

export interface PreflightReady {
  kind: 'ready';
  plan: string;
}

export interface PreflightInvalid {
  kind: 'invalid';
  raw: string;
}

export type PreflightResult = PreflightAsk | PreflightReady | PreflightInvalid;

/**
 * Parse the model's pre-flight response. Tolerates surrounding prose or code
 * fences — we extract the first balanced JSON object.
 */
export function parsePreflightResponse(raw: string): PreflightResult {
  const trimmed = raw.trim();

  // Strip common code-fence wrappers
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : extractFirstJsonObject(trimmed);

  if (!candidate) return { kind: 'invalid', raw };

  try {
    const obj = JSON.parse(candidate);
    if (obj.ready === true && typeof obj.plan === 'string') {
      return { kind: 'ready', plan: obj.plan };
    }
    if (typeof obj.ask === 'string') {
      return {
        kind: 'ask',
        question: obj.ask,
        missing: Array.isArray(obj.missing) ? obj.missing.map(String) : [],
      };
    }
    return { kind: 'invalid', raw };
  } catch {
    return { kind: 'invalid', raw };
  }
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
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
