/**
 * Structured content that is rendered as native pptx shapes (tables, shapes,
 * connectors, boxes) instead of an AI-generated image. Picked by the
 * classifier in `classifyAndEnrichSlide` whenever the slide teaches a
 * diagram, table, process, comparison, worked calculation, etc.
 */
export type SlideStructured =
  | {
      kind: 'table';
      caption?: string;
      headers: string[];
      rows: string[][];
      /** Optional row labels rendered as a leading column on the left */
      rowLabels?: string[];
      /** Optional equation / summary line rendered below the table */
      summary?: string;
    }
  | {
      kind: 'process';
      steps: string[];
      /** Horizontal by default; 'vertical' stacks steps top-to-bottom */
      orientation?: 'horizontal' | 'vertical';
    }
  | {
      kind: 'comparison';
      leftTitle: string;
      leftPoints: string[];
      rightTitle: string;
      rightPoints: string[];
    }
  | {
      kind: 'boxMethod';
      /** e.g. "1011" for binary → decimal, or "2F" for hex → decimal */
      input: string;
      /** Base of the input number (2 for binary, 16 for hex). Defaults to 2. */
      base?: number;
      /** Display label — "Binary → Decimal", "Hex → Decimal" */
      label?: string;
    }
  | {
      /**
       * Typeset mathematical formula rendered as an image (proper stacked
       * fractions, vinculum over radicals, superscripts, etc.). The `latex`
       * payload is a simple TeX-like expression; see FormulaRenderer for the
       * supported subset. `label` appears as a caption above the formula.
       */
      kind: 'formula';
      latex: string;
      label?: string;
      /** Optional numbered worked steps rendered beneath the main formula */
      steps?: string[];
    };

export interface SlideSpec {
  title: string;
  bullets: string[];
  speakerNotes: string;
  /**
   * Optional image prompt — used ONLY for decorative / hero / section-divider
   * slides. Structured educational content (tables, diagrams, processes,
   * comparisons, worked examples) is rendered natively via `structured` and
   * NEVER through the image API.
   */
  imagePrompt?: string;
  /** Populated after image generation — base64 (no data-URL prefix) */
  imageBase64?: string;
  /** 'title' = section opener/hero, 'content' = bulleted body */
  layout?: 'title' | 'content';
  /** Native-shape structured content — see SlideStructured above. */
  structured?: SlideStructured;
  /**
   * Canvas-rasterised PNG of the structured content (base64, no data-URL prefix).
   * Used by the PDF builder so the PDF shows the same table / flowchart /
   * comparison / box-method graphic as the PPTX, since pdf-lib cannot draw
   * the native shapes. Populated before PDF build when `structured` is set.
   */
  structuredImageBase64?: string;
  /**
   * Classifier's intent tag. When present and NOT 'decorative', this slide
   * must never receive an AI-generated image.
   */
  intent?: 'decorative' | 'table' | 'process' | 'comparison' | 'boxMethod' | 'formula' | 'plain';
}

export interface SlideDeck {
  title: string;
  subtitle?: string;
  yearLevel: string;
  topic: string;
  curriculumStandard?: string;
  durationMin?: number;
  objectives?: string[];
  slides: SlideSpec[];
}

export interface SlideDeckRequest {
  topic: string;
  yearLevel: string;
  slideCount: number;
  durationMin?: number;
  curriculumStandard?: string;
  objectives?: string[];
  includeImages?: boolean;
}

export function buildSlideGenPrompt(req: SlideDeckRequest): string {
  const objectivesNote = req.objectives?.length
    ? `Teacher-supplied learning objectives (MUST be addressed explicitly):\n${req.objectives.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}`
    : 'No fixed objectives provided — infer 3 sharp, measurable objectives using Bloom verbs (identify, explain, apply, analyse, create) and list them on slide 2.';

  const imageNote = req.includeImages
    ? `VISUALS — CRITICAL RULES (READ CAREFULLY)

We NEVER use AI image generation for instructional content (tables, diagrams, worked examples, processes, flowcharts, comparisons, conversions, formulas, grids, timelines, charts). Those are rendered as NATIVE slide shapes via a "structured" field described below. Image generation is reserved for decorative hero / section-divider backgrounds.

For EACH slide, set an "intent" field to ONE of:
  - "formula"     — a mathematical or scientific formula that should be typeset with real fractions, radicals, superscripts, Greek letters (e.g. the quadratic formula, Pythagoras, force = m × a, area formulas, velocity, E = mc²)
  - "boxMethod"   — binary/hex/base-N conversion using a place-value box method
  - "table"       — anything tabular (comparison grids, data, conversion tables, Punnett squares, etc.)
  - "process"     — an ordered sequence of steps, algorithm, flowchart, or timeline
  - "comparison"  — two concepts side-by-side (A vs B, pros/cons)
  - "decorative"  — hero/title/section slide where a thematic abstract background is fine
  - "plain"       — bullets-only slide; no visual needed

When intent is "formula", "table", "process", "comparison", or "boxMethod", you MUST also populate a "structured" object and MUST NOT set "imagePrompt". Structured schemas:

  intent "formula":
    { "kind": "formula", "latex": "x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}",
      "label": "Quadratic formula", "steps": ["x = \\\\frac{-(3) \\\\pm \\\\sqrt{(3)^2 - 4(2)(-5)}}{2(2)}", "x = \\\\frac{-3 \\\\pm \\\\sqrt{49}}{4}", "x = \\\\frac{-3 \\\\pm 7}{4}", "x = 1 \\\\text{ or } x = -2.5"] }
  The latex field MUST use TeX-style commands for proper typesetting:
    - \\\\frac{num}{den}  for fractions (renders stacked with a rule)
    - \\\\sqrt{x}          for square roots (renders with vinculum)
    - ^{...}  or  ^x      for superscripts
    - _{...}  or  _x      for subscripts
    - \\\\pm, \\\\mp, \\\\times, \\\\cdot, \\\\div, \\\\leq, \\\\geq, \\\\neq, \\\\approx, \\\\infty, \\\\pi, \\\\theta, \\\\Delta, \\\\Sigma, \\\\to, \\\\Rightarrow
  Do NOT write "sqrt(...)" or "+/-" in the latex string. Use \\\\sqrt and \\\\pm.
  Use "formula" whenever a slide's central idea is a single named equation the student should copy into their notes. Put worked substitution lines in "steps".

  intent "boxMethod":
    { "kind": "boxMethod", "input": "1011", "base": 2, "label": "Binary → Decimal" }

  intent "table":
    { "kind": "table", "caption": "...", "headers": ["..."], "rows": [["..."]],
      "rowLabels": ["..."], "summary": "optional equation or takeaway" }

  intent "process":
    { "kind": "process", "steps": ["Step 1 ...", "Step 2 ...", ...],
      "orientation": "horizontal" | "vertical" }

  intent "comparison":
    { "kind": "comparison", "leftTitle": "...", "leftPoints": ["..."],
      "rightTitle": "...", "rightPoints": ["..."] }

When intent is "decorative", you MAY set an "imagePrompt". It MUST describe an abstract thematic background ONLY — no text, no numbers, no letters, no diagrams, no charts. Example: "abstract low-poly circuit board in deep navy with subtle cyan glow, minimal, no text".

When intent is "plain", do NOT set imagePrompt and do NOT set structured.

Prefer structured visuals wherever they would help teaching. Aim for at least 40-60% of content slides to have a structured visual. When in doubt, choose a structured visual over a decorative one.`
    : `Do NOT include imagePrompt fields. Still set "intent" and, when appropriate, "structured" (table, process, comparison, boxMethod) so the deck includes native-shape visuals.`;

  const pace = req.durationMin
    ? `Pacing: ~${Math.max(2, Math.round(req.durationMin / req.slideCount))} minutes per slide on average. Distribute time across Hook, I Do, We Do, You Do, Check, Exit.`
    : '';

  return `You are a senior curriculum designer and master teacher designing a ${req.slideCount}-slide PowerPoint lesson that a NEW teacher could walk into the room and deliver confidently.

LESSON BRIEF
Topic: ${req.topic}
Year level: ${req.yearLevel}
${req.durationMin ? `Duration: ${req.durationMin} minutes` : ''}
${req.curriculumStandard ? `Curriculum: ${req.curriculumStandard}` : ''}
${pace}

${objectivesNote}

AUDIENCE CALIBRATION — THIS IS CRITICAL
Before writing, explicitly consider the age and lived experience of a ${req.yearLevel} student:
- Use concrete, relatable hooks (gaming, phones, music, sport, food, social media, money, school life) appropriate to their age.
- Match vocabulary and sentence length to their reading age. Define any technical term the first time you use it.
- Replace abstract statements with specific numbers, named examples, or short scenarios.
- If the topic feels "dry", your job is to make it feel relevant and human. Boring slides are a failure.

PEDAGOGICAL STRUCTURE (the deck MUST follow this arc)
1. Title slide — topic + a provocative one-line hook question.
2. Hook / Do Now slide — a short puzzle, image, question, weird fact, or "what would you do if..." that pulls students in. NOT just "today we will learn about X".
3. Learning objectives slide — 2-4 student-friendly "I can..." statements.
4. Prior knowledge / quick recall — 2-3 check questions to surface what students already know or misunderstand.
5. Core concept slides — introduce ONE idea per slide. Use analogies to everyday life. Each concept slide should contain either a worked example, a diagram (via imagePrompt), a comparison, or a short scenario.
6. At least ONE fully worked example slide — show the steps a student should take, numbered, with reasoning. For maths/science/computing, include actual numbers and the answer.
7. At least ONE "common misconception" slide — name the wrong thinking many students have, then correct it. Phrase misconceptions as things a real ${req.yearLevel} student would actually say.
8. Guided practice slide — 2-3 questions of increasing difficulty the class works through together.
9. Independent practice slide — 3-5 questions students attempt on their own. Include answers in speakerNotes.
10. Check for understanding / mini-plenary mid-deck — a single diagnostic question with A/B/C/D options.
11. Real-world application slide — where does this show up in the world? Careers, current events, daily life.
12. Summary slide — the 3-5 key takeaways in plain language.
13. Exit ticket slide — 3 specific questions (one recall, one apply, one extend/reflect) that students answer before leaving.

CONTENT RULES
- bullets: 3-6 per content slide. Each bullet is a full, useful sentence or a concrete worked step — NOT a vague label. Up to ~20 words per bullet. Plain text, no markdown.

MATH AND SYMBOL FORMATTING — MANDATORY
Slides render with a Unicode font. For any mathematical, scientific or technical content use the real Unicode characters, NOT ASCII substitutes. This applies to bullets, titles, speakerNotes AND every "structured" payload (including table cells and process steps).
- Square roots: use "√" — write "√49", "√(b² − 4ac)" — NOT "sqrt(49)", NOT "sqrt49".
- Plus/minus: "±" — NOT "+/-".
- Minus (in equations): use "−" (U+2212) — NOT "-" dash unless it's a hyphen.
- Multiplication: "×" — NOT "*" or "x" (except as a variable name).
- Division: "÷" or a proper fraction — NOT plain "/".
- Powers/exponents: use superscripts where possible: x², x³, xⁿ — NOT "x^2", NOT "x**2". For higher/variable exponents, use "x^{n}" only if superscripts are impractical.
- Subscripts: x₁, x₂, a₀ — NOT "x_1".
- Inequalities: ≤, ≥, ≠, ≈ — NOT "<=", ">=", "!=", "~=".
- Greek letters: π, θ, α, β, Δ, Σ, μ, σ — spelled out only if named in prose.
- Degrees: 25° — NOT "25 deg".
- Infinity ∞, integral ∫, sum Σ, product ∏, implies ⇒, element-of ∈.
- Quadratic formula example (write it this way): "x = (−b ± √(b² − 4ac)) / 2a".
- Present full worked substitutions with proper symbols, e.g. "x = (−3 ± √(9 + 40)) / 4", then "x = (−3 ± √49) / 4", then "x = (−3 ± 7) / 4".

Every formula in your output MUST use the Unicode symbols above. Re-read your draft before returning and replace any ASCII placeholders (sqrt, +/-, ^2, <=, etc.) with their Unicode equivalents.


- For worked examples, put each numbered step as a separate bullet, e.g. "1. Write out the place values: 128 64 32 16 8 4 2 1".
- For multiple-choice / check questions, put the question as the slide title and each option as a bullet ("A) 23", "B) 42", ...). Put the correct answer and reasoning in speakerNotes.
- For misconception slides, structure bullets as: one bullet stating the wrong idea ("Many people think..."), then bullets correcting it with evidence.
- Slide titles should be SPECIFIC and often phrased as questions or claims ("Why does 1011 equal 11?", "The place-value trick every programmer knows") — not lifeless labels like "Introduction" or "Conclusion".

SPEAKER NOTES — this is where teachers live
For every slide, write 4-8 sentences of speakerNotes containing:
- The exact opening line the teacher should say.
- 1-2 questions to ask the class, with the expected answers in brackets.
- A common wrong answer students might give, and how to respond.
- A differentiation note (how to stretch fast finishers OR support struggling students).
- A timing cue ("~3 minutes on this slide").

${imageNote}

QUALITY BAR — reject your own draft if any of these are true
- Any slide is just a restatement of the topic with generic bullets.
- No slide contains a concrete example with real numbers, names, or a scenario.
- No slide addresses a misconception.
- No slide has a worked example.
- Bullets are single words or empty phrases ("It is important", "Binary is useful").
- The deck could apply to any topic with words swapped — it MUST be specific to "${req.topic}".

OUTPUT FORMAT
Return ONLY a single JSON object matching this TypeScript type. Produce EXACTLY ${req.slideCount} slides. No prose, no code fences, no commentary.

{
  "title": string,
  "subtitle": string,
  "yearLevel": string,
  "topic": string,
  "objectives": string[],
  "slides": [
    {
      "title": string,
      "bullets": string[],
      "speakerNotes": string,
      "layout": "title" | "content",
      "intent": "formula" | "boxMethod" | "table" | "process" | "comparison" | "decorative" | "plain",
      "imagePrompt"?: string,           // only when intent === "decorative"
      "structured"?:                     // only when intent is boxMethod | table | process | comparison
        { "kind": "boxMethod", "input": string, "base"?: number, "label"?: string }
      | { "kind": "table", "caption"?: string, "headers": string[], "rows": string[][], "rowLabels"?: string[], "summary"?: string }
      | { "kind": "process", "steps": string[], "orientation"?: "horizontal" | "vertical" }
      | { "kind": "comparison", "leftTitle": string, "leftPoints": string[], "rightTitle": string, "rightPoints": string[] }
    }
  ]
}

Output JSON now.`;
}

/**
 * Coerce common ASCII math fallbacks the LLM emits into Unicode symbols so
 * formulas read correctly on slides and PDFs. Applied to all user-facing
 * strings in the deck (titles, bullets, notes, structured payloads).
 */
const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '(': '⁽', ')': '⁾', 'n': 'ⁿ',
};
const SUBSCRIPT: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '(': '₍', ')': '₎',
};

export function prettifyMath(input: string): string {
  if (!input) return input;
  let s = input;
  // sqrt(...) → √(...)   sqrt49 → √49
  s = s.replace(/\bsqrt\s*\(/gi, '√(');
  s = s.replace(/\bsqrt\s*(?=[0-9a-zA-Z])/gi, '√');
  s = s.replace(/\bcbrt\s*\(/gi, '∛(');
  // +/-  and  -/+
  s = s.replace(/\+\s*\/\s*-/g, '±');
  s = s.replace(/-\s*\/\s*\+/g, '∓');
  // ASCII comparators (avoid touching arrows in SVG-ish prose)
  s = s.replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/!=/g, '≠').replace(/~=/g, '≈');
  // Arrows
  s = s.replace(/->/g, '→').replace(/<-/g, '←').replace(/=>/g, '⇒');
  // Powers: x^2, (ax+b)^3, y^n   (only when followed by digit / letter / paren)
  s = s.replace(/\^\(([^()]{1,20})\)/g, (_m, inner) => {
    const out = [...String(inner)].map((c) => SUPERSCRIPT[c] ?? c).join('');
    return /[^⁰-⁹⁺⁻⁽⁾ⁿ]/.test(out) ? `^(${inner})` : out;
  });
  s = s.replace(/\^([0-9a-zA-Z])/g, (_m, c) => SUPERSCRIPT[c] ?? `^${c}`);
  // Subscripts: x_1, a_0
  s = s.replace(/_\(([^()]{1,10})\)/g, (_m, inner) => {
    const out = [...String(inner)].map((c) => SUBSCRIPT[c] ?? c).join('');
    return /[^₀-₉₊₋₍₎]/.test(out) ? `_(${inner})` : out;
  });
  s = s.replace(/([A-Za-z])_([0-9])/g, (_m, v, d) => `${v}${SUBSCRIPT[d] ?? `_${d}`}`);
  // Degrees: "25 deg" → "25°"
  s = s.replace(/(\d+)\s*deg\b/g, '$1°');
  // Multiplication/division (only in clear math contexts: digit*digit, digit*letter)
  s = s.replace(/(\d)\s*\*\s*(\d)/g, '$1×$2');
  // "pi" as a standalone word in equations → π
  s = s.replace(/\b(2\s*)?pi\b/g, (m) => m.replace(/pi/, 'π'));
  return s;
}

function deepPrettify<T>(v: T): T {
  if (typeof v === 'string') return prettifyMath(v) as unknown as T;
  if (Array.isArray(v)) return v.map(deepPrettify) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = deepPrettify(val);
    }
    return out as unknown as T;
  }
  return v;
}

/** Tolerant JSON extraction (handles fenced/wrapped output) */
export function parseDeckJson(raw: string): SlideDeck {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : extractFirstJsonObject(raw) ?? raw;
  const parsed = JSON.parse(candidate);

  if (!parsed || !Array.isArray(parsed.slides)) {
    throw new Error('Invalid deck JSON — missing slides array');
  }

  return {
    title: String(parsed.title ?? 'Untitled deck'),
    subtitle: parsed.subtitle ? String(parsed.subtitle) : undefined,
    yearLevel: String(parsed.yearLevel ?? ''),
    topic: String(parsed.topic ?? ''),
    curriculumStandard: parsed.curriculumStandard ? String(parsed.curriculumStandard) : undefined,
    durationMin: typeof parsed.durationMin === 'number' ? parsed.durationMin : undefined,
    objectives: Array.isArray(parsed.objectives) ? parsed.objectives.map(String) : undefined,
    slides: parsed.slides.map((s: Record<string, unknown>) => ({
      title: prettifyMath(String(s.title ?? '')),
      bullets: Array.isArray(s.bullets) ? (s.bullets as unknown[]).map((b) => prettifyMath(String(b))) : [],
      speakerNotes: prettifyMath(String(s.speakerNotes ?? '')),
      imagePrompt: s.imagePrompt ? String(s.imagePrompt) : undefined,
      layout: s.layout === 'title' ? 'title' : 'content',
      intent: normaliseIntent(s.intent),
      structured: deepPrettify(normaliseStructured(s.structured)),
    })),
  };
}

function normaliseIntent(raw: unknown): SlideSpec['intent'] {
  if (raw === 'decorative' || raw === 'table' || raw === 'process'
    || raw === 'comparison' || raw === 'boxMethod' || raw === 'formula' || raw === 'plain') {
    return raw;
  }
  return undefined;
}

function normaliseStructured(raw: unknown): SlideStructured | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  const kind = v.kind;
  if (kind === 'table' && Array.isArray(v.headers) && Array.isArray(v.rows)) {
    return {
      kind: 'table',
      caption: v.caption ? String(v.caption) : undefined,
      headers: (v.headers as unknown[]).map(String),
      rows: (v.rows as unknown[]).map((r) =>
        Array.isArray(r) ? (r as unknown[]).map(String) : [String(r)],
      ),
      rowLabels: Array.isArray(v.rowLabels) ? (v.rowLabels as unknown[]).map(String) : undefined,
      summary: v.summary ? String(v.summary) : undefined,
    };
  }
  if (kind === 'process' && Array.isArray(v.steps)) {
    const orientation = v.orientation === 'vertical' ? 'vertical' : 'horizontal';
    return { kind: 'process', steps: (v.steps as unknown[]).map(String), orientation };
  }
  if (kind === 'formula' && typeof v.latex === 'string') {
    return {
      kind: 'formula',
      latex: String(v.latex),
      label: v.label ? String(v.label) : undefined,
      steps: Array.isArray(v.steps) ? (v.steps as unknown[]).map(String) : undefined,
    };
  }
  if (kind === 'comparison') {
    return {
      kind: 'comparison',
      leftTitle: String(v.leftTitle ?? 'Option A'),
      leftPoints: Array.isArray(v.leftPoints) ? (v.leftPoints as unknown[]).map(String) : [],
      rightTitle: String(v.rightTitle ?? 'Option B'),
      rightPoints: Array.isArray(v.rightPoints) ? (v.rightPoints as unknown[]).map(String) : [],
    };
  }
  if (kind === 'boxMethod' && typeof v.input === 'string') {
    return {
      kind: 'boxMethod',
      input: String(v.input),
      base: typeof v.base === 'number' ? v.base : undefined,
      label: v.label ? String(v.label) : undefined,
    };
  }
  return undefined;
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
