import type { SlideSpec, SlideStructured } from './slideSchema';

/**
 * Classify + enrich a slide before rendering.
 *
 * Rules:
 *  1. If the LLM already provided a valid `structured` payload, keep it and
 *     derive `intent` from its kind. Strip any imagePrompt — instructional
 *     content is rendered natively, never as an image.
 *  2. Otherwise, run keyword heuristics on the title + bullets. If they match
 *     table / process / comparison / boxMethod signals, synthesise a
 *     `structured` payload from the bullets.
 *  3. Only slides classified as 'decorative' are allowed to keep their
 *     imagePrompt. All others have it cleared.
 *  4. Decorative prompts are rewritten to forbid any text / numbers / letters
 *     / diagrams so image gen can only produce a thematic background.
 */
export function classifyAndEnrichSlide(slide: SlideSpec): SlideSpec {
  // Title slides are always decorative heroes.
  if (slide.layout === 'title') {
    return {
      ...slide,
      intent: 'decorative',
      imagePrompt: slide.imagePrompt ? sanitiseDecorativePrompt(slide.imagePrompt) : undefined,
      structured: undefined,
    };
  }

  // 1. Trust existing structured payload from the model.
  if (slide.structured) {
    return {
      ...slide,
      intent: slide.structured.kind,
      imagePrompt: undefined,
    };
  }

  // 2. Try to infer structure from slide text.
  const inferred = inferStructureFromBullets(slide);
  if (inferred) {
    return {
      ...slide,
      intent: inferred.kind,
      structured: inferred,
      imagePrompt: undefined,
    };
  }

  // 3. Keyword-only classification (still educational → no image).
  const haystack = [slide.title, ...slide.bullets, slide.imagePrompt ?? ''].join(' ').toLowerCase();
  if (EDUCATIONAL_HINTS.some((kw) => haystack.includes(kw))) {
    return { ...slide, intent: 'plain', imagePrompt: undefined, structured: undefined };
  }

  // 4. Explicit decorative request.
  if (slide.intent === 'decorative' && slide.imagePrompt) {
    return {
      ...slide,
      intent: 'decorative',
      imagePrompt: sanitiseDecorativePrompt(slide.imagePrompt),
      structured: undefined,
    };
  }

  // 5. Default: plain bullets, no image. When in doubt, no image.
  return { ...slide, intent: 'plain', imagePrompt: undefined, structured: undefined };
}

const EDUCATIONAL_HINTS = [
  'step', 'steps', 'method', 'algorithm', 'procedure', 'process',
  'worked example', 'walkthrough', 'diagram', 'flow', 'flowchart',
  'table', 'columns', 'place value', 'place-value', 'box method',
  'division method', 'long division', 'convert', 'conversion',
  'structure', 'anatomy', 'labelled', 'labeled', 'parts of',
  'cycle', 'pipeline', 'stages', 'phases', 'layers',
  'compare', 'comparison', ' vs ', 'versus',
  'formula', 'equation', 'calculation', 'working out',
  'timeline', 'grid', 'chart', 'graph',
];

const BINARY_RE = /\b([01]{3,16})(?:\s*(?:base ?2|binary|_2|\u2082))\b/i;
const HEX_RE = /\b([0-9A-F]{2,6})(?:\s*(?:base ?16|hex|_16|\u2081\u2086))\b/i;
const BOX_METHOD_RE = /(box method|place[- ]?value method|place[- ]?value columns)/i;

function inferStructureFromBullets(slide: SlideSpec): SlideStructured | null {
  const text = [slide.title, ...slide.bullets].join('\n');
  const lower = text.toLowerCase();

  // Box method (binary / hex)
  const binaryMatch = text.match(BINARY_RE) || (BOX_METHOD_RE.test(text) && text.match(/\b([01]{3,16})\b/));
  if (binaryMatch && (lower.includes('binary') || BOX_METHOD_RE.test(text))) {
    return { kind: 'boxMethod', input: binaryMatch[1], base: 2, label: 'Binary → Decimal' };
  }
  const hexMatch = text.match(HEX_RE);
  if (hexMatch && lower.includes('hex')) {
    return { kind: 'boxMethod', input: hexMatch[1].toUpperCase(), base: 16, label: 'Hex → Decimal' };
  }

  // Process / steps — numbered bullets
  const numberedBullets = slide.bullets.filter((b) => /^\s*(step\s*)?\d+[.)]/i.test(b));
  if (numberedBullets.length >= 2) {
    const steps = numberedBullets.map((b) => b.replace(/^\s*(step\s*)?\d+[.)]\s*/i, '').trim());
    return { kind: 'process', steps, orientation: steps.length > 4 ? 'vertical' : 'horizontal' };
  }

  // Comparison — "vs" or "pros/cons" split
  const vsMatch = slide.title.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i);
  if (vsMatch && slide.bullets.length >= 2) {
    const half = Math.ceil(slide.bullets.length / 2);
    return {
      kind: 'comparison',
      leftTitle: vsMatch[1].trim(),
      leftPoints: slide.bullets.slice(0, half),
      rightTitle: vsMatch[2].trim(),
      rightPoints: slide.bullets.slice(half),
    };
  }

  // Table — bullets like "key: value" or "A | B | C"
  const pipeRows = slide.bullets.filter((b) => b.split('|').length >= 3);
  if (pipeRows.length >= 2) {
    const rows = pipeRows.map((b) => b.split('|').map((c) => c.trim()));
    const width = Math.max(...rows.map((r) => r.length));
    const normalised = rows.map((r) => {
      const copy = [...r];
      while (copy.length < width) copy.push('');
      return copy;
    });
    return {
      kind: 'table',
      headers: normalised[0],
      rows: normalised.slice(1),
    };
  }

  return null;
}

function sanitiseDecorativePrompt(prompt: string): string {
  // Image gen is limited to abstract thematic backgrounds. Force the prompt to
  // reflect that, no matter what the model originally wrote.
  const trimmed = prompt.replace(/\s+/g, ' ').trim();
  return `${trimmed}. Abstract thematic background only. No text, no numbers, no letters, no diagrams, no charts, no tables. Clean, minimal, premium editorial style.`;
}
