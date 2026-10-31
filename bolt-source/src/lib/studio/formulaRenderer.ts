/**
 * Canvas-based math typesetter used to render formulas on slides so students
 * see the classic stacked-fraction / radical-with-vinculum / superscript
 * layout (e.g. the quadratic formula) rather than a flat one-line ASCII
 * version. The output is a PNG base64 image usable by both pptxBuilder and
 * the PDF builder.
 *
 * The input is a tiny TeX-like string. Supported constructs:
 *   \frac{A}{B}      — stacked fraction with rule
 *   \sqrt{X}         — radical with vinculum above X
 *   \sqrt[n]{X}      — nth root
 *   ^{...}  ^x       — superscript (single char or braced group)
 *   _{...}  _x       — subscript
 *   \pm \mp          — ±  ∓
 *   \cdot \times \div — ·  ×  ÷
 *   \leq \geq \neq \approx \infty
 *   \pi \theta \alpha \beta \gamma \delta \Delta \sigma \Sigma \lambda \mu
 *   \to \Rightarrow \Leftrightarrow
 *   { ... }          — grouping
 *   (anything else)  — rendered verbatim
 *
 * This is NOT a full TeX engine; it is deliberately simple and covers the
 * formulas that show up in year 7-12 teaching content.
 */

import type { SlideTheme } from './slideThemes';

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'frac'; num: Node[]; den: Node[] }
  | { kind: 'sqrt'; radicand: Node[]; index?: Node[] }
  | { kind: 'sup'; base: Node[]; sup: Node[] }
  | { kind: 'sub'; base: Node[]; sub: Node[] }
  | { kind: 'supsub'; base: Node[]; sup: Node[]; sub: Node[] };

const SYMBOLS: Record<string, string> = {
  '\\pm': '\u00B1',
  '\\mp': '\u2213',
  '\\cdot': '\u00B7',
  '\\times': '\u00D7',
  '\\div': '\u00F7',
  '\\leq': '\u2264',
  '\\geq': '\u2265',
  '\\neq': '\u2260',
  '\\approx': '\u2248',
  '\\infty': '\u221E',
  '\\pi': '\u03C0',
  '\\theta': '\u03B8',
  '\\alpha': '\u03B1',
  '\\beta': '\u03B2',
  '\\gamma': '\u03B3',
  '\\delta': '\u03B4',
  '\\Delta': '\u0394',
  '\\sigma': '\u03C3',
  '\\Sigma': '\u03A3',
  '\\lambda': '\u03BB',
  '\\mu': '\u03BC',
  '\\to': '\u2192',
  '\\rightarrow': '\u2192',
  '\\Rightarrow': '\u21D2',
  '\\Leftrightarrow': '\u21D4',
  '\\cdots': '\u22EF',
  '\\ldots': '\u2026',
};

// ─── Parser ──────────────────────────────────────────────────────────────────

function parse(input: string): Node[] {
  const tokens = tokenize(input);
  let i = 0;
  const nodes = parseGroup();
  return nodes;

  function parseGroup(stopAtBrace = false): Node[] {
    const out: Node[] = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (stopAtBrace && t === '}') { i++; return out; }
      if (t === '}') { i++; continue; }
      if (t === '{') { i++; out.push(...parseGroup(true)); continue; }
      if (t === '\\frac') {
        i++;
        const num = readArg();
        const den = readArg();
        attachSupSub({ kind: 'frac', num, den }, out);
        continue;
      }
      if (t === '\\sqrt') {
        i++;
        let index: Node[] | undefined;
        if (tokens[i] === '[') {
          i++;
          index = [];
          while (i < tokens.length && tokens[i] !== ']') {
            const sub = tokens[i];
            if (sub === '{') { i++; index.push(...parseGroup(true)); }
            else { index.push({ kind: 'text', value: symbolOrText(sub) }); i++; }
          }
          if (tokens[i] === ']') i++;
        }
        const radicand = readArg();
        attachSupSub({ kind: 'sqrt', radicand, index }, out);
        continue;
      }
      if (t === '\\text' || t === '\\mathrm' || t === '\\operatorname') {
        i++;
        const arg = readArg();
        // Flatten any text nodes in the arg into a single upright run, padded
        // with spaces so it separates cleanly from adjacent math.
        const flat = arg.map((n) => (n.kind === 'text' ? n.value : '')).join('');
        out.push({ kind: 'text', value: ` ${flat} ` });
        continue;
      }
      if (t === '^' || t === '_') {
        i++;
        const arg = readArg();
        const last = out[out.length - 1];
        if (!last) { out.push(t === '^' ? { kind: 'sup', base: [], sup: arg } : { kind: 'sub', base: [], sub: arg }); continue; }
        out[out.length - 1] = wrapSupSub(last, t === '^' ? { sup: arg } : { sub: arg });
        continue;
      }
      // Symbol command?
      if (t.startsWith('\\') && SYMBOLS[t] !== undefined) {
        out.push({ kind: 'text', value: SYMBOLS[t] });
        i++;
        continue;
      }
      // Plain text (single char)
      out.push({ kind: 'text', value: t });
      i++;
    }
    return out;
  }

  function readArg(): Node[] {
    if (tokens[i] === '{') { i++; return parseGroup(true); }
    const t = tokens[i];
    if (t === undefined) return [];
    i++;
    return [{ kind: 'text', value: t.startsWith('\\') ? (SYMBOLS[t] ?? t) : t }];
  }

  function attachSupSub(node: Node, out: Node[]) {
    // Allow immediate ^/_ after a construct
    let result: Node = node;
    while (tokens[i] === '^' || tokens[i] === '_') {
      const which = tokens[i];
      i++;
      const arg = readArg();
      result = wrapSupSub(result, which === '^' ? { sup: arg } : { sub: arg });
    }
    out.push(result);
  }

  function wrapSupSub(base: Node, add: { sup?: Node[]; sub?: Node[] }): Node {
    if (base.kind === 'sup' && add.sub) return { kind: 'supsub', base: base.base, sup: base.sup, sub: add.sub };
    if (base.kind === 'sub' && add.sup) return { kind: 'supsub', base: base.base, sup: add.sup, sub: base.sub };
    if (base.kind === 'supsub') {
      return { ...base, sup: add.sup ?? base.sup, sub: add.sub ?? base.sub };
    }
    if (add.sup) return { kind: 'sup', base: [base], sup: add.sup };
    if (add.sub) return { kind: 'sub', base: [base], sub: add.sub };
    return base;
  }

  function symbolOrText(t: string): string {
    if (t.startsWith('\\') && SYMBOLS[t]) return SYMBOLS[t];
    return t;
  }
}

function tokenize(input: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === '\\') {
      let j = i + 1;
      while (j < input.length && /[A-Za-z]/.test(input[j])) j++;
      if (j === i + 1) { out.push(input.slice(i, i + 2)); i += 2; }
      else { out.push(input.slice(i, j)); i = j; }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    out.push(c);
    i++;
  }
  return out;
}

// ─── Metrics + layout ────────────────────────────────────────────────────────

interface Metrics {
  width: number;
  ascent: number;   // above baseline
  descent: number;  // below baseline
}

interface LayoutCtx {
  ctx: CanvasRenderingContext2D;
  size: number;        // current font size in px
  color: string;
}

function italicFontFor(ch: string): boolean {
  // Single-letter Latin variables are italic in math
  return /^[A-Za-z]$/.test(ch);
}

function setFont(l: LayoutCtx, italic = false, size = l.size) {
  // Bold italic serif — matches the classic textbook style (the reference
  // "x = (-b ± √(b²-4ac)) / 2a" image is drawn in a heavy navy serif).
  const weight = 'bold';
  const style = italic ? 'italic' : 'normal';
  l.ctx.font = `${style} ${weight} ${size}px "Cambria Math", "STIX Two Math", "Times New Roman", "Georgia", serif`;
}

function measureText(l: LayoutCtx, value: string): Metrics {
  if (value.length === 1 && italicFontFor(value)) setFont(l, true);
  else setFont(l, false);
  const m = l.ctx.measureText(value);
  const ascent = (m.actualBoundingBoxAscent || l.size * 0.75);
  const descent = (m.actualBoundingBoxDescent || l.size * 0.25);
  return { width: m.width, ascent, descent };
}

function measureNodes(l: LayoutCtx, nodes: Node[]): Metrics {
  let width = 0, ascent = 0, descent = 0;
  for (const n of nodes) {
    const m = measureNode(l, n);
    width += m.width;
    ascent = Math.max(ascent, m.ascent);
    descent = Math.max(descent, m.descent);
  }
  return { width, ascent, descent };
}

function measureNode(l: LayoutCtx, n: Node): Metrics {
  switch (n.kind) {
    case 'text': return measureText(l, n.value);
    case 'frac': {
      const num = measureNodes({ ...l, size: l.size * 0.82 }, n.num);
      const den = measureNodes({ ...l, size: l.size * 0.82 }, n.den);
      const width = Math.max(num.width, den.width) + l.size * 0.3;
      // Axis is roughly 0.25 * size above baseline
      const axis = l.size * 0.28;
      const ascent = axis + num.ascent + num.descent + l.size * 0.1;
      const descent = den.ascent + den.descent + l.size * 0.1 - axis;
      return { width, ascent, descent };
    }
    case 'sqrt': {
      const inner = measureNodes(l, n.radicand);
      const radicalW = l.size * 0.75;
      const width = radicalW + inner.width + l.size * 0.15 + (n.index ? l.size * 0.45 : 0);
      const ascent = inner.ascent + l.size * 0.18; // extra for vinculum
      return { width, ascent, descent: inner.descent };
    }
    case 'sup': {
      const base = measureNodes(l, n.base);
      const sup = measureNodes({ ...l, size: l.size * 0.7 }, n.sup);
      return { width: base.width + sup.width + 2, ascent: Math.max(base.ascent, base.ascent * 0.5 + sup.ascent + sup.descent), descent: base.descent };
    }
    case 'sub': {
      const base = measureNodes(l, n.base);
      const sub = measureNodes({ ...l, size: l.size * 0.7 }, n.sub);
      return { width: base.width + sub.width + 2, ascent: base.ascent, descent: Math.max(base.descent, sub.ascent + sub.descent - base.descent * 0.3) };
    }
    case 'supsub': {
      const base = measureNodes(l, n.base);
      const sup = measureNodes({ ...l, size: l.size * 0.7 }, n.sup);
      const sub = measureNodes({ ...l, size: l.size * 0.7 }, n.sub);
      return {
        width: base.width + Math.max(sup.width, sub.width) + 2,
        ascent: Math.max(base.ascent, base.ascent * 0.5 + sup.ascent + sup.descent),
        descent: Math.max(base.descent, sub.ascent + sub.descent - base.descent * 0.3),
      };
    }
  }
}

// Draw at baseline `y`. Returns advance width.
function drawNodes(l: LayoutCtx, nodes: Node[], x: number, y: number): number {
  let cx = x;
  for (const n of nodes) {
    cx += drawNode(l, n, cx, y);
  }
  return cx - x;
}

function drawNode(l: LayoutCtx, n: Node, x: number, y: number): number {
  const { ctx } = l;
  switch (n.kind) {
    case 'text': {
      const italic = n.value.length === 1 && italicFontFor(n.value);
      setFont(l, italic);
      ctx.fillStyle = l.color;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillText(n.value, x, y);
      return measureText(l, n.value).width;
    }
    case 'frac': {
      const subCtx: LayoutCtx = { ...l, size: l.size * 0.82 };
      const num = measureNodes(subCtx, n.num);
      const den = measureNodes(subCtx, n.den);
      const width = Math.max(num.width, den.width) + l.size * 0.3;
      const axisY = y - l.size * 0.28;
      const padding = l.size * 0.08;
      // Draw numerator centered
      const numY = axisY - padding - num.descent;
      drawNodes(subCtx, n.num, x + (width - num.width) / 2, numY);
      // Fraction rule
      ctx.strokeStyle = l.color;
      ctx.lineWidth = Math.max(1.2, l.size * 0.05);
      ctx.beginPath();
      ctx.moveTo(x, axisY);
      ctx.lineTo(x + width, axisY);
      ctx.stroke();
      // Denominator
      const denY = axisY + padding + den.ascent;
      drawNodes(subCtx, n.den, x + (width - den.width) / 2, denY);
      return width;
    }
    case 'sqrt': {
      const inner = measureNodes(l, n.radicand);
      const radicalW = l.size * 0.65;
      const indexW = n.index ? l.size * 0.45 : 0;
      const top = y - inner.ascent - l.size * 0.15;
      const bottom = y + inner.descent;
      const mid = y + l.size * 0.15;
      const rStart = x + indexW;
      // Optional degree index (small, upper-left)
      if (n.index) {
        const idxCtx: LayoutCtx = { ...l, size: l.size * 0.6 };
        drawNodes(idxCtx, n.index, x, top + l.size * 0.3);
      }
      // Radical glyph: tick, diagonal, vinculum
      ctx.strokeStyle = l.color;
      ctx.lineWidth = Math.max(1.3, l.size * 0.06);
      ctx.beginPath();
      ctx.moveTo(rStart, mid);
      ctx.lineTo(rStart + radicalW * 0.25, mid + l.size * 0.1);
      ctx.lineTo(rStart + radicalW * 0.5, bottom);
      ctx.lineTo(rStart + radicalW, top);
      ctx.lineTo(rStart + radicalW + inner.width + l.size * 0.15, top);
      ctx.stroke();
      // Draw radicand slightly inset
      drawNodes(l, n.radicand, rStart + radicalW + l.size * 0.08, y);
      return radicalW + inner.width + l.size * 0.2 + indexW;
    }
    case 'sup': {
      const base = measureNodes(l, n.base);
      drawNodes(l, n.base, x, y);
      const supCtx: LayoutCtx = { ...l, size: l.size * 0.7 };
      drawNodes(supCtx, n.sup, x + base.width + 1, y - base.ascent * 0.6);
      const sup = measureNodes(supCtx, n.sup);
      return base.width + sup.width + 2;
    }
    case 'sub': {
      const base = measureNodes(l, n.base);
      drawNodes(l, n.base, x, y);
      const subCtx: LayoutCtx = { ...l, size: l.size * 0.7 };
      drawNodes(subCtx, n.sub, x + base.width + 1, y + base.descent * 0.9);
      const sub = measureNodes(subCtx, n.sub);
      return base.width + sub.width + 2;
    }
    case 'supsub': {
      const base = measureNodes(l, n.base);
      drawNodes(l, n.base, x, y);
      const scriptCtx: LayoutCtx = { ...l, size: l.size * 0.7 };
      const sup = measureNodes(scriptCtx, n.sup);
      const sub = measureNodes(scriptCtx, n.sub);
      drawNodes(scriptCtx, n.sup, x + base.width + 1, y - base.ascent * 0.6);
      drawNodes(scriptCtx, n.sub, x + base.width + 1, y + base.descent * 0.9);
      return base.width + Math.max(sup.width, sub.width) + 2;
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface FormulaPayload {
  latex: string;
  label?: string;
  steps?: string[];
}

export async function rasterizeFormula(
  payload: FormulaPayload,
  theme: SlideTheme,
  widthPx = 1600,
  heightPx = 1100,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.clearRect(0, 0, widthPx, heightPx);

  const accent = theme.accent.startsWith('#') ? theme.accent : `#${theme.accent}`;
  const textPrimary = theme.textPrimary.startsWith('#') ? theme.textPrimary : `#${theme.textPrimary}`;
  const textSecondary = theme.textSecondary.startsWith('#') ? theme.textSecondary : `#${theme.textSecondary}`;

  const pad = 60;
  let cursorY = pad;

  if (payload.label) {
    ctx.fillStyle = textSecondary;
    ctx.font = 'bold 42px "Inter", "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(payload.label, widthPx / 2, cursorY);
    cursorY += 72;
  }

  // Render the main formula centered.
  const nodes = parse(payload.latex);
  // Pick a size that fits horizontally.
  let size = 160;
  let metrics: Metrics;
  for (;;) {
    const l: LayoutCtx = { ctx, size, color: accent };
    metrics = measureNodes(l, nodes);
    if (metrics.width <= widthPx - pad * 2 || size <= 60) break;
    size -= 8;
  }
  const formulaL: LayoutCtx = { ctx, size, color: accent };
  const baselineY = cursorY + metrics.ascent + 20;
  const startX = (widthPx - metrics.width) / 2;
  drawNodes(formulaL, nodes, startX, baselineY);
  cursorY = baselineY + metrics.descent + 60;

  if (payload.steps && payload.steps.length > 0) {
    ctx.textAlign = 'left';

    // Pre-parse + measure every step so each row claims its true height
    // (fractions and radicals have ascents well above the nominal font size,
    // so a fixed line-height causes neighbouring rows to overlap).
    const available = heightPx - cursorY - pad;
    const stepSize = Math.min(
      38,
      Math.max(22, Math.floor(available / payload.steps.length / 2.2)),
    );
    const rowPadding = Math.max(14, Math.round(stepSize * 0.5));

    const parsedSteps = payload.steps.map((step) => {
      const nodes = parse(step);
      const m = measureNodes({ ctx, size: stepSize, color: textPrimary }, nodes);
      return { nodes, metrics: m };
    });

    for (let i = 0; i < parsedSteps.length; i++) {
      const { nodes: stepNodes, metrics: m } = parsedSteps[i];
      const rowHeight = m.ascent + m.descent;
      if (cursorY + rowHeight > heightPx - pad) break;

      const baselineY = cursorY + m.ascent;

      ctx.fillStyle = accent;
      ctx.font = `bold ${stepSize}px "Inter", "Helvetica Neue", Arial, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${i + 1}.`, pad, baselineY);

      const lCtx: LayoutCtx = { ctx, size: stepSize, color: textPrimary };
      drawNodes(lCtx, stepNodes, pad + stepSize * 1.8, baselineY);

      cursorY += rowHeight + rowPadding;
    }
  }

  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}
