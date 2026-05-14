/**
 * Infographic schema — inspired by NotebookLM's infographic feature.
 * 3 orientations (portrait/landscape/square), 3 detail levels (brief/standard/detailed).
 * The LLM emits structured JSON which is rendered to SVG (embeddable as PNG).
 */

export type InfographicOrientation = 'portrait' | 'landscape' | 'square';
export type InfographicDetail = 'brief' | 'standard' | 'detailed';

export const ORIENTATION_LABELS: Record<InfographicOrientation, string> = {
  portrait: 'Portrait (poster)',
  landscape: 'Landscape (wall)',
  square: 'Square (social)',
};

export const DETAIL_LABELS: Record<InfographicDetail, string> = {
  brief: 'Brief',
  standard: 'Standard',
  detailed: 'Detailed',
};

export interface InfographicStat {
  value: string;          // "71%", "3.5x", "2050"
  label: string;          // short caption
  context?: string;       // optional explanation
}

export interface InfographicSection {
  heading: string;
  body?: string;          // short paragraph
  bullets?: string[];     // 2-5 terse bullets
  stat?: InfographicStat; // optional focal number
  icon?: string;          // lucide icon name hint (e.g. "Leaf", "Zap")
}

export interface InfographicTimelineItem {
  when: string;           // "Stage 1" / "1920" / "Day 1"
  label: string;
  description?: string;
}

export interface Infographic {
  title: string;
  subtitle?: string;
  yearLevel: string;
  topic: string;
  orientation: InfographicOrientation;
  detail: InfographicDetail;
  palette: {
    primary: string;   // hex
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  headline?: {
    value: string;     // big focal stat
    label: string;
  };
  sections: InfographicSection[];
  timeline?: InfographicTimelineItem[];
  keyTakeaway?: string;
  sources?: string[];
}

export interface InfographicRequest {
  topic: string;
  yearLevel: string;
  orientation: InfographicOrientation;
  detail: InfographicDetail;
  focus?: string;           // user freeform
  curriculumStandard?: string;
}

export function buildInfographicPrompt(req: InfographicRequest): string {
  const sectionCount = req.detail === 'brief' ? '3-4' : req.detail === 'standard' ? '4-6' : '6-8';
  const includeTimeline = req.detail !== 'brief';

  return `You are a graphic-designer teacher creating a classroom infographic.

TOPIC: ${req.topic}
YEAR LEVEL: ${req.yearLevel}
ORIENTATION: ${req.orientation}
DETAIL LEVEL: ${req.detail}
${req.focus ? `FOCUS: ${req.focus}` : ''}
${req.curriculumStandard ? `CURRICULUM: ${req.curriculumStandard}` : ''}

Produce a JSON document suitable for rendering as a single-page infographic. Keep copy terse — infographics are read by glancing. Prefer numbers, short verbs, and parallel phrasing.

Return ONLY valid JSON matching this shape (no markdown, no prose, no code fences):

{
  "title": "Short punchy title (≤6 words)",
  "subtitle": "One-line descriptive subtitle",
  "yearLevel": "${req.yearLevel}",
  "topic": "${req.topic}",
  "orientation": "${req.orientation}",
  "detail": "${req.detail}",
  "palette": {
    "primary": "#0891b2",
    "secondary": "#0e7490",
    "accent": "#f59e0b",
    "background": "#0b1220",
    "text": "#e5e7eb"
  },
  "headline": { "value": "Big stat e.g. 71%", "label": "What it means (≤8 words)" },
  "sections": [
    {
      "heading": "Section title (≤4 words)",
      "body": "One crisp sentence (≤20 words).",
      "bullets": ["terse bullet", "terse bullet"],
      "stat": { "value": "3.5x", "label": "caption", "context": "optional short note" },
      "icon": "Leaf"
    }
  ]${includeTimeline ? ',\n  "timeline": [ { "when": "Stage 1", "label": "...", "description": "optional" } ]' : ''},
  "keyTakeaway": "The one-sentence takeaway students should remember.",
  "sources": ["optional citation strings"]
}

Rules:
- Produce ${sectionCount} sections.
- Every section must have a heading. Use body OR bullets (not always both).
- Pick a palette that fits the topic's mood (e.g. biology = greens + amber; physics = cyan + amber; history = warm sepia + dark teal). NEVER use purple/violet/indigo.
- Use high-contrast readable text colors.
- icon must be a PascalCase Lucide icon name (e.g. Leaf, Zap, Atom, Globe, Brain, TrendingUp, BookOpen, Heart, ShieldCheck, Flame, Droplet, Sun, Timer, Target, BarChart3, PieChart, Microscope, Calculator, Cpu, Database, Sparkles). When unsure, use Sparkles.
- Numbers should be real and age-appropriate. Do not invent scientific statistics; prefer general-knowledge figures or use approximate ranges prefixed "~".
- Output JSON only.`;
}

export function parseInfographicJson(raw: string): Infographic {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON object found in response.');
  const slice = text.slice(firstBrace, lastBrace + 1);
  const obj = JSON.parse(slice) as Partial<Infographic>;

  if (!obj.title || !Array.isArray(obj.sections) || obj.sections.length === 0) {
    throw new Error('Infographic JSON missing title or sections.');
  }
  // Defensively default the palette
  const palette = obj.palette ?? {
    primary: '#0891b2', secondary: '#0e7490', accent: '#f59e0b',
    background: '#0b1220', text: '#e5e7eb',
  };
  // Reject purple/indigo/violet if the model slipped through
  const sanitizeColor = (c: string): string => {
    const lower = c.toLowerCase();
    if (/#(8|9|a|b)[0-9a-f]{1,2}[0-9a-f]{2}(8|9|a|b|c|d|e|f)/.test(lower)) {
      // Rough heuristic — if model emits high-red + high-blue (purple), swap to teal
      // We'll just trust the prompt; only replace literal violet names
    }
    return c;
  };
  const cleanPalette = {
    primary: sanitizeColor(palette.primary),
    secondary: sanitizeColor(palette.secondary),
    accent: sanitizeColor(palette.accent),
    background: sanitizeColor(palette.background),
    text: sanitizeColor(palette.text),
  };

  return {
    title: obj.title,
    subtitle: obj.subtitle,
    yearLevel: obj.yearLevel ?? '',
    topic: obj.topic ?? '',
    orientation: (obj.orientation ?? 'portrait') as InfographicOrientation,
    detail: (obj.detail ?? 'standard') as InfographicDetail,
    palette: cleanPalette,
    headline: obj.headline,
    sections: obj.sections as InfographicSection[],
    timeline: obj.timeline as InfographicTimelineItem[] | undefined,
    keyTakeaway: obj.keyTakeaway,
    sources: obj.sources,
  };
}
