import type { SlideStructured } from './slideSchema';
import type { SlideTheme } from './slideThemes';
import { rasterizeFormula } from './formulaRenderer';

/**
 * Rasterise a structured slide payload (table / process / comparison / box
 * method) to a PNG using an offscreen canvas. The PNG is used both by the
 * PDF builder (which cannot otherwise render shape content) and as a
 * fallback anywhere a bitmap is needed.
 */
export async function rasterizeStructured(
  struct: SlideStructured,
  theme: SlideTheme,
  widthPx = 1600,
  heightPx = 1100,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // Transparent background — slide background is already drawn by PDF/PPTX.
  ctx.clearRect(0, 0, widthPx, heightPx);

  switch (struct.kind) {
    case 'table': drawTable(ctx, struct, theme, widthPx, heightPx); break;
    case 'process': drawProcess(ctx, struct, theme, widthPx, heightPx); break;
    case 'comparison': drawComparison(ctx, struct, theme, widthPx, heightPx); break;
    case 'boxMethod': drawTable(ctx, boxToTable(struct), theme, widthPx, heightPx); break;
    case 'formula':
      return rasterizeFormula({ latex: struct.latex, label: struct.label, steps: struct.steps }, theme, widthPx, heightPx);
  }

  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}

// ─── Box method → table conversion (mirror of pptxBuilder logic) ───────────

function boxToTable(struct: Extract<SlideStructured, { kind: 'boxMethod' }>) {
  const base = struct.base ?? 2;
  const input = struct.input.trim();
  const n = input.length;
  const placeValues: number[] = [];
  const digits: number[] = [];
  for (let i = 0; i < n; i++) {
    placeValues.push(Math.pow(base, n - 1 - i));
    const ch = input[i].toUpperCase();
    const d = /[0-9]/.test(ch) ? parseInt(ch, 10) : 'ABCDEF'.indexOf(ch) + 10;
    digits.push(isNaN(d) || d < 0 ? 0 : d);
  }
  const products = digits.map((d, i) => d * placeValues[i]);
  const total = products.reduce((a, b) => a + b, 0);
  const activeTerms = products.filter((_, i) => digits[i] !== 0);
  return {
    kind: 'table' as const,
    caption: struct.label ?? `Converting ${input} (base ${base}) to decimal`,
    headers: placeValues.map(String),
    rows: [
      digits.map(String),
      placeValues.map((p) => `×${p}`),
      products.map(String),
    ],
    rowLabels: ['Digit', '× place', 'Result'],
    summary: `${input}${subscript(base)} = ${activeTerms.join(' + ') || '0'} = ${total}\u2081\u2080`,
  };
}

function subscript(n: number): string {
  const map: Record<string, string> = {
    '0': '\u2080', '1': '\u2081', '2': '\u2082', '3': '\u2083', '4': '\u2084',
    '5': '\u2085', '6': '\u2086', '7': '\u2087', '8': '\u2088', '9': '\u2089',
  };
  return String(n).split('').map((c) => map[c] ?? c).join('');
}

// ─── Colours ────────────────────────────────────────────────────────────────

function hex(h: string): string {
  return h.startsWith('#') ? h : `#${h}`;
}

function shade(h: string, ratio: number): string {
  const clean = h.replace('#', '');
  if (clean.length !== 6) return hex(h);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const mix = (c: number) => {
    const target = ratio >= 0 ? 255 : 0;
    const amt = Math.abs(ratio);
    return Math.round(c + (target - c) * amt);
  };
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

// ─── Renderers ──────────────────────────────────────────────────────────────

interface TableData {
  caption?: string;
  headers: string[];
  rows: string[][];
  rowLabels?: string[];
  summary?: string;
}

function drawTable(
  ctx: CanvasRenderingContext2D,
  data: TableData,
  theme: SlideTheme,
  W: number,
  H: number,
) {
  const pad = 20;
  const accent = hex(theme.accent);
  const textPrimary = hex(theme.textPrimary);
  const textSecondary = hex(theme.textSecondary);

  let cursorY = pad;
  if (data.caption) {
    ctx.fillStyle = textSecondary;
    ctx.font = 'italic 32px "Inter", "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(data.caption, pad, cursorY);
    cursorY += 56;
  }

  const hasLabelCol = !!data.rowLabels && data.rowLabels.length === data.rows.length;
  const labelColW = hasLabelCol ? 220 : 0;
  const tableX = pad + labelColW;
  const tableW = W - pad * 2 - labelColW;
  const rowCount = data.rows.length + 1;
  const summaryH = data.summary ? 120 : pad;
  const rowH = Math.max(80, (H - cursorY - summaryH - 10) / rowCount);
  const colW = tableW / data.headers.length;

  // Header row
  ctx.fillStyle = accent;
  ctx.fillRect(tableX, cursorY, tableW, rowH);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 40px "Inter", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  data.headers.forEach((h, i) => {
    ctx.fillText(h, tableX + colW * i + colW / 2, cursorY + rowH / 2);
  });

  // Body rows
  data.rows.forEach((row, ri) => {
    const y = cursorY + rowH * (ri + 1);
    ctx.fillStyle = ri % 2 === 0 ? shade(theme.background, 0.1) : shade(theme.background, 0.18);
    ctx.fillRect(tableX, y, tableW, rowH);
    ctx.fillStyle = textPrimary;
    ctx.font = '36px "SF Mono", "Consolas", "Courier New", monospace';
    row.forEach((cell, ci) => {
      ctx.fillText(cell, tableX + colW * ci + colW / 2, y + rowH / 2);
    });
  });

  // Gridlines
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  for (let i = 0; i <= data.headers.length; i++) {
    const x = tableX + colW * i;
    ctx.beginPath(); ctx.moveTo(x, cursorY); ctx.lineTo(x, cursorY + rowH * rowCount); ctx.stroke();
  }
  for (let i = 0; i <= rowCount; i++) {
    const y = cursorY + rowH * i;
    ctx.beginPath(); ctx.moveTo(tableX, y); ctx.lineTo(tableX + tableW, y); ctx.stroke();
  }

  // Row labels (left column)
  if (hasLabelCol) {
    ctx.fillStyle = textSecondary;
    ctx.font = '30px "SF Mono", "Consolas", "Courier New", monospace';
    ctx.textAlign = 'right';
    data.rowLabels!.forEach((label, i) => {
      const y = cursorY + rowH * (i + 1) + rowH / 2;
      ctx.fillText(label, tableX - 20, y);
    });
  }

  // Summary line
  if (data.summary) {
    const y = cursorY + rowH * rowCount + 60;
    ctx.fillStyle = accent;
    ctx.font = 'bold 44px "SF Mono", "Consolas", "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.summary, W / 2, y);
  }
}

function drawProcess(
  ctx: CanvasRenderingContext2D,
  struct: Extract<SlideStructured, { kind: 'process' }>,
  theme: SlideTheme,
  W: number,
  H: number,
) {
  const { steps, orientation = 'horizontal' } = struct;
  if (steps.length === 0) return;
  const accent = hex(theme.accent);
  const textPrimary = hex(theme.textPrimary);
  const pad = 40;

  if (orientation === 'vertical') {
    const gap = 28;
    const boxW = Math.min(W - pad * 2, 760);
    const boxH = Math.min(130, (H - pad * 2 - gap * (steps.length - 1)) / steps.length);
    const x = (W - boxW) / 2;
    steps.forEach((step, i) => {
      const y = pad + i * (boxH + gap);
      drawStepBox(ctx, x, y, boxW, boxH, `${i + 1}. ${step}`, theme);
      if (i < steps.length - 1) drawArrow(ctx, x + boxW / 2, y + boxH, x + boxW / 2, y + boxH + gap, accent);
    });
    void textPrimary;
    return;
  }

  const gap = 30;
  const boxW = Math.max(180, (W - pad * 2 - gap * (steps.length - 1)) / steps.length);
  const boxH = Math.min(H - pad * 2, 240);
  const y = (H - boxH) / 2;
  steps.forEach((step, i) => {
    const x = pad + i * (boxW + gap);
    drawStepBox(ctx, x, y, boxW, boxH, `${i + 1}. ${step}`, theme);
    if (i < steps.length - 1) drawArrow(ctx, x + boxW, y + boxH / 2, x + boxW + gap, y + boxH / 2, accent);
  });
}

function drawStepBox(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  text: string,
  theme: SlideTheme,
) {
  const r = 14;
  ctx.fillStyle = shade(theme.background, 0.14);
  ctx.strokeStyle = hex(theme.accent);
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = hex(theme.textPrimary);
  ctx.font = 'bold 22px "Inter", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  wrapText(ctx, text, x + w / 2, y + h / 2, w - 24, 28);
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number, color: string,
) {
  const head = 14;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawComparison(
  ctx: CanvasRenderingContext2D,
  struct: Extract<SlideStructured, { kind: 'comparison' }>,
  theme: SlideTheme,
  W: number,
  H: number,
) {
  const pad = 40;
  const gap = 30;
  const colW = (W - pad * 2 - gap) / 2;
  drawComparisonCol(ctx, pad, pad, colW, H - pad * 2, struct.leftTitle, struct.leftPoints, hex(theme.accent), theme);
  drawComparisonCol(ctx, pad + colW + gap, pad, colW, H - pad * 2, struct.rightTitle, struct.rightPoints, hex(theme.accentSecondary), theme);
}

function drawComparisonCol(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  title: string, points: string[], accent: string,
  theme: SlideTheme,
) {
  const headerH = 72;
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, w, headerH);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 28px "Inter", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, x + w / 2, y + headerH / 2);

  ctx.fillStyle = shade(theme.background, 0.12);
  ctx.fillRect(x, y + headerH, w, h - headerH);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y + headerH, w, h - headerH);

  ctx.fillStyle = hex(theme.textPrimary);
  ctx.font = '22px "Inter", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const startY = y + headerH + 24;
  const bulletX = x + 24;
  const textX = bulletX + 20;
  const maxTextW = w - 60;
  let cursorY = startY;
  const lineH = 30;
  for (const p of points) {
    ctx.fillStyle = accent;
    ctx.font = 'bold 24px "Inter", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('▸', bulletX, cursorY);
    ctx.fillStyle = hex(theme.textPrimary);
    ctx.font = '22px "Inter", "Helvetica Neue", Arial, sans-serif';
    const lines = wrapToLines(ctx, p, maxTextW);
    lines.forEach((ln, i) => ctx.fillText(ln, textX, cursorY + i * lineH));
    cursorY += lines.length * lineH + 14;
    if (cursorY > y + h - lineH) break;
  }
}

// ─── Canvas helpers ─────────────────────────────────────────────────────────

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxW: number, lineH: number) {
  const lines = wrapToLines(ctx, text, maxW);
  const totalH = lines.length * lineH;
  const startY = cy - totalH / 2 + lineH / 2;
  lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineH));
}

function wrapToLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width > maxW && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}
