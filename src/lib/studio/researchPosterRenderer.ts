/**
 * Renders a research-paper infographic poster as SVG, then exports to PNG via canvas.
 * Pure client-side — no image generation API needed.
 */

export interface PosterData {
  title: string;
  authors: string;
  organization: string;
  year: string;
  motivation: string;
  method: string;
  results: string;
  analysis: string;
  takeaways: string;
  theme: PosterTheme;
}

export interface PosterTheme {
  id: string;
  primary: string;
  secondary: string;
  accent: string;
  bg: string;
  headerBg: string;
  text: string;
  textMuted: string;
  panelBg: string;
  panelBorder: string;
}

export const POSTER_THEMES: Record<string, PosterTheme> = {
  'blue-white': {
    id: 'blue-white',
    primary: '#1d4ed8', secondary: '#1e40af', accent: '#3b82f6',
    bg: '#f8fafc', headerBg: '#1e3a8a', text: '#0f172a', textMuted: '#475569',
    panelBg: '#ffffff', panelBorder: '#cbd5e1',
  },
  'dark-navy': {
    id: 'dark-navy',
    primary: '#0ea5e9', secondary: '#0284c7', accent: '#38bdf8',
    bg: '#0f172a', headerBg: '#020617', text: '#f1f5f9', textMuted: '#94a3b8',
    panelBg: '#1e293b', panelBorder: '#334155',
  },
  'green-teal': {
    id: 'green-teal',
    primary: '#059669', secondary: '#047857', accent: '#10b981',
    bg: '#f0fdf4', headerBg: '#064e3b', text: '#052e16', textMuted: '#4b7563',
    panelBg: '#ffffff', panelBorder: '#a7f3d0',
  },
  'purple': {
    id: 'purple',
    primary: '#7c3aed', secondary: '#6d28d9', accent: '#a855f7',
    bg: '#faf5ff', headerBg: '#3b0764', text: '#1a0533', textMuted: '#6b21a8',
    panelBg: '#ffffff', panelBorder: '#e9d5ff',
  },
};

const W = 1920;
const H = 1080;
const PAD = 48;
const HEADER_H = 160;
const FOOTER_H = 90;
const PANEL_GAP = 20;
const BODY_TOP = HEADER_H + PANEL_GAP;
const BODY_H = H - HEADER_H - FOOTER_H - PANEL_GAP * 2;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapSvgText(
  text: string,
  x: number, startY: number,
  maxWidth: number, fontSize: number,
  fontFamily: string, fontWeight: string,
  fill: string, lineHeight: number,
  maxLines: number,
  anchor = 'start',
): string {
  const avgCharWidth = fontSize * 0.55;
  const charsPerLine = Math.max(10, Math.floor(maxWidth / avgCharWidth));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? line + ' ' + w : w;
    if (candidate.length > charsPerLine && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  return lines.slice(0, maxLines).map((l, i) =>
    `<text x="${x}" y="${startY + i * lineHeight}" font-family="${fontFamily}" font-weight="${fontWeight}" font-size="${fontSize}" fill="${fill}" text-anchor="${anchor}">${esc(l)}</text>`
  ).join('\n');
}

function parseBullets(text: string): string[] {
  return text
    .split(/\n|•|;/)
    .map(s => s.replace(/^[-*\u2022\s]+/, '').trim())
    .filter(Boolean);
}

function parseResults(text: string): Array<[string, string, string, string]> {
  return text
    .split('\n')
    .map(row => row.split(/[,|]/).map(s => s.trim()))
    .filter(r => r.length >= 2 && r[0])
    .map(r => [r[0] ?? '', r[1] ?? '', r[2] ?? '', r[3] ?? ''] as [string, string, string, string]);
}

function parseTakeaways(text: string): string[] {
  return text.split('|').map(s => s.trim()).filter(Boolean).slice(0, 4);
}

function panel(
  x: number, y: number, w: number, h: number,
  t: PosterTheme,
  headerColor: string,
  headerLabel: string,
  children: string,
): string {
  return `
<g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${t.panelBg}" stroke="${t.panelBorder}" stroke-width="1.5"/>
  <rect x="${x}" y="${y}" width="${w}" height="34" rx="10" fill="${headerColor}"/>
  <rect x="${x}" y="${y + 24}" width="${w}" height="12" fill="${headerColor}"/>
  <text x="${x + 14}" y="${y + 22}" font-family="Inter, ui-sans-serif, sans-serif" font-weight="700" font-size="13" letter-spacing="1.5" fill="#ffffff">${esc(headerLabel.toUpperCase())}</text>
  ${children}
</g>`;
}

export function renderPoster(d: PosterData): string {
  const t = POSTER_THEMES[d.theme.id] ?? POSTER_THEMES['blue-white'];
  const ff = 'Inter, ui-sans-serif, sans-serif';

  // Layout: 3 columns, 2 rows
  const COL_W = (W - PAD * 2 - PANEL_GAP * 2) / 3;
  const ROW_H = (BODY_H - PANEL_GAP) / 2;
  const col = (i: number) => PAD + i * (COL_W + PANEL_GAP);
  const row = (i: number) => BODY_TOP + i * (ROW_H + PANEL_GAP);

  // ── Header ──────────────────────────────────────────────────────────────
  const titleLines = d.title.split(/(.{0,55}\s|.{55})/g).filter(Boolean).slice(0, 2);
  const header = `
<rect x="0" y="0" width="${W}" height="${HEADER_H}" fill="${t.headerBg}"/>
<rect x="0" y="${HEADER_H - 4}" width="${W}" height="4" fill="${t.accent}"/>
${titleLines.map((l, i) => `<text x="${PAD}" y="${56 + i * 52}" font-family="${ff}" font-weight="800" font-size="42" fill="#ffffff">${esc(l.trim())}</text>`).join('\n')}
<text x="${PAD}" y="${HEADER_H - 24}" font-family="${ff}" font-weight="400" font-size="16" fill="#ffffffcc">${esc(d.authors)}${d.organization ? '  ·  ' + esc(d.organization) : ''}  ·  ${esc(d.year)}</text>`;

  // ── Panel 1: Motivation ─────────────────────────────────────────────────
  const motBullets = parseBullets(d.motivation);
  const motContent = motBullets.slice(0, 7).map((b, i) => {
    const y = row(0) + 50 + i * 36;
    const lines = b.length > 52 ? [b.slice(0, 52), b.slice(52, 104)] : [b];
    return lines.map((l, li) => li === 0
      ? `<circle cx="${col(0) + 22}" cy="${y - 5}" r="4" fill="${t.accent}"/>
         <text x="${col(0) + 36}" y="${y}" font-family="${ff}" font-weight="500" font-size="15" fill="${t.text}">${esc(l)}</text>`
      : `<text x="${col(0) + 36}" y="${y + 17}" font-family="${ff}" font-weight="400" font-size="14" fill="${t.textMuted}">${esc(l)}</text>`
    ).join('\n');
  }).join('\n');
  const p1 = panel(col(0), row(0), COL_W, ROW_H, t, t.primary, 'Motivation & Key Idea', motContent);

  // ── Panel 2: Method ─────────────────────────────────────────────────────
  const methBullets = parseBullets(d.method);
  const methContent = methBullets.slice(0, 7).map((b, i) => {
    const y = row(0) + 50 + i * 36;
    const num = `${i + 1}`;
    const lines = b.length > 50 ? [b.slice(0, 50), b.slice(50, 100)] : [b];
    return lines.map((l, li) => li === 0
      ? `<rect x="${col(1) + 14}" y="${y - 16}" width="20" height="20" rx="4" fill="${t.accent}"/>
         <text x="${col(1) + 24}" y="${y - 1}" font-family="${ff}" font-weight="700" font-size="12" fill="#ffffff" text-anchor="middle">${num}</text>
         <text x="${col(1) + 42}" y="${y}" font-family="${ff}" font-weight="500" font-size="15" fill="${t.text}">${esc(l)}</text>`
      : `<text x="${col(1) + 42}" y="${y + 17}" font-family="${ff}" font-weight="400" font-size="14" fill="${t.textMuted}">${esc(l)}</text>`
    ).join('\n');
  }).join('\n');
  const p2 = panel(col(1), row(0), COL_W, ROW_H, t, '#0369a1', 'Method', methContent);

  // ── Panel 3: Task / Pipeline diagram (simple visual) ───────────────────
  const stages = ['Input', 'Tokenize', 'Encode', 'Transform', 'Output'];
  const stageColors = [t.primary, t.accent, '#f59e0b', '#10b981', t.secondary];
  const boxW = (COL_W - 40) / stages.length - 8;
  const diagramY = row(0) + 50;
  const diagramContent = stages.map((s, i) => {
    const bx = col(2) + 20 + i * (boxW + 8);
    return `
      <rect x="${bx}" y="${diagramY}" width="${boxW}" height="36" rx="6" fill="${stageColors[i]}"/>
      <text x="${bx + boxW / 2}" y="${diagramY + 22}" font-family="${ff}" font-weight="600" font-size="12" fill="#ffffff" text-anchor="middle">${esc(s)}</text>
      ${i < stages.length - 1 ? `<text x="${bx + boxW + 3}" y="${diagramY + 22}" font-family="${ff}" font-size="16" fill="${t.textMuted}" text-anchor="middle">›</text>` : ''}
    `;
  }).join('\n');

  const taskTypes = ['Classification', 'Entailment', 'Similarity', 'Multi-Choice'];
  const taskColors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981'];
  const taskContent = taskTypes.map((tt, i) => {
    const ty = row(0) + 110 + i * 48;
    return `
      <rect x="${col(2) + 14}" y="${ty}" width="80" height="22" rx="4" fill="${taskColors[i]}" fill-opacity="0.15" stroke="${taskColors[i]}" stroke-width="1"/>
      <text x="${col(2) + 24}" y="${ty + 15}" font-family="${ff}" font-weight="600" font-size="11" fill="${taskColors[i]}">${esc(tt)}</text>
      <rect x="${col(2) + 104}" y="${ty + 2}" width="${COL_W - 124}" height="18" rx="3" fill="${taskColors[i]}" fill-opacity="0.08" stroke="${taskColors[i]}" stroke-width="1" stroke-dasharray="4,3"/>
    `;
  }).join('\n');
  const p3 = panel(col(2), row(0), COL_W, ROW_H, t, '#0f766e', 'Task Formatting', diagramContent + taskContent);

  // ── Panel 4: Evaluation / Analysis ─────────────────────────────────────
  const anaBullets = parseBullets(d.analysis);
  const anaContent = anaBullets.slice(0, 7).map((b, i) => {
    const y = row(1) + 50 + i * 36;
    const lines = b.length > 52 ? [b.slice(0, 52), b.slice(52, 104)] : [b];
    return lines.map((l, li) => li === 0
      ? `<rect x="${col(0) + 14}" y="${y - 14}" width="6" height="20" rx="3" fill="${t.accent}"/>
         <text x="${col(0) + 28}" y="${y}" font-family="${ff}" font-weight="500" font-size="15" fill="${t.text}">${esc(l)}</text>`
      : `<text x="${col(0) + 28}" y="${y + 17}" font-family="${ff}" font-weight="400" font-size="14" fill="${t.textMuted}">${esc(l)}</text>`
    ).join('\n');
  }).join('\n');
  const p4 = panel(col(0), row(1), COL_W, ROW_H, t, '#7c3aed', 'Analysis', anaContent);

  // ── Panel 5: Results table ──────────────────────────────────────────────
  const rows = parseResults(d.results);
  const tableHeaderY = row(1) + 46;
  const tableCols = [14, COL_W * 0.5, COL_W * 0.66, COL_W * 0.82];
  const tableHeaders = ['Benchmark', 'Ours', 'Prior Best', 'Δ'];
  const tableHeaderRow = tableHeaders.map((h, i) =>
    `<text x="${col(1) + tableCols[i]}" y="${tableHeaderY}" font-family="${ff}" font-weight="700" font-size="13" fill="${t.textMuted}">${esc(h)}</text>`
  ).join('\n');

  const tableRows = rows.slice(0, 9).map((r, i) => {
    const ry = tableHeaderY + 22 + i * 30;
    const isEven = i % 2 === 0;
    const delta = r[3];
    const deltaColor = delta.startsWith('+') ? '#10b981' : delta.startsWith('-') ? '#ef4444' : t.text;
    return `
      ${isEven ? `<rect x="${col(1) + 8}" y="${ry - 16}" width="${COL_W - 16}" height="26" rx="4" fill="${t.accent}" fill-opacity="0.05"/>` : ''}
      <text x="${col(1) + tableCols[0]}" y="${ry}" font-family="${ff}" font-weight="500" font-size="14" fill="${t.text}">${esc(r[0])}</text>
      <text x="${col(1) + tableCols[1]}" y="${ry}" font-family="${ff}" font-weight="700" font-size="14" fill="${t.accent}">${esc(r[1])}</text>
      <text x="${col(1) + tableCols[2]}" y="${ry}" font-family="${ff}" font-weight="400" font-size="14" fill="${t.textMuted}">${esc(r[2])}</text>
      <text x="${col(1) + tableCols[3]}" y="${ry}" font-family="${ff}" font-weight="700" font-size="14" fill="${deltaColor}">${esc(delta)}</text>
    `;
  }).join('\n');
  const p5 = panel(col(1), row(1), COL_W, ROW_H, t, '#b45309', 'Main Results', tableHeaderRow + tableRows);

  // ── Panel 6: Chart (simple SVG line chart) ──────────────────────────────
  const chartX = col(2) + 20;
  const chartY = row(1) + 50;
  const chartW = COL_W - 40;
  const chartH = ROW_H - 80;
  const numPts = 6;
  const ptSpacing = chartW / (numPts - 1);

  // Two synthetic curves based on analysis content length as seed
  const seed = d.analysis.length;
  const curve1 = Array.from({ length: numPts }, (_, i) => 0.3 + 0.55 * (i / (numPts - 1)) + Math.sin(i * 0.9 + seed % 3) * 0.05);
  const curve2 = Array.from({ length: numPts }, (_, i) => 0.2 + 0.4 * (i / (numPts - 1)) + Math.sin(i * 1.3 + (seed % 5)) * 0.04);

  const toSvgY = (v: number) => chartY + chartH - v * chartH;

  const path1 = curve1.map((v, i) => `${i === 0 ? 'M' : 'L'} ${chartX + i * ptSpacing},${toSvgY(v)}`).join(' ');
  const path2 = curve2.map((v, i) => `${i === 0 ? 'M' : 'L'} ${chartX + i * ptSpacing},${toSvgY(v)}`).join(' ');

  const chartContent = `
    <rect x="${chartX}" y="${chartY}" width="${chartW}" height="${chartH}" rx="6" fill="${t.panelBg}" stroke="${t.panelBorder}" stroke-width="1"/>
    ${[0, 0.25, 0.5, 0.75, 1].map(v =>
      `<line x1="${chartX}" y1="${toSvgY(v)}" x2="${chartX + chartW}" y2="${toSvgY(v)}" stroke="${t.panelBorder}" stroke-width="1" stroke-dasharray="4,4"/>`
    ).join('\n')}
    <path d="${path1}" fill="none" stroke="${t.accent}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${path2}" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="8,4"/>
    ${curve1.map((v, i) => `<circle cx="${chartX + i * ptSpacing}" cy="${toSvgY(v)}" r="4" fill="${t.accent}"/>`).join('\n')}
    <text x="${chartX + 6}" y="${chartY + chartH + 18}" font-family="${ff}" font-size="11" fill="${t.accent}">— Fine-tuned layers</text>
    <text x="${chartX + 140}" y="${chartY + chartH + 18}" font-family="${ff}" font-size="11" fill="#f59e0b}">— Baseline</text>
    <text x="${chartX}" y="${chartY - 8}" font-family="${ff}" font-weight="700" font-size="12" fill="${t.textMuted}">Performance vs. transfer depth</text>
  `;
  const p6 = panel(col(2), row(1), COL_W, ROW_H, t, '#0f766e', 'Analysis Charts', chartContent);

  // ── Footer / Takeaways ──────────────────────────────────────────────────
  const takeaways = parseTakeaways(d.takeaways);
  const footerY = H - FOOTER_H;
  const twW = (W - PAD * 2 - PANEL_GAP * 3) / 4;
  const footer = `
<rect x="0" y="${footerY}" width="${W}" height="${FOOTER_H}" fill="${t.headerBg}"/>
${takeaways.map((tw, i) => {
  const tx = PAD + i * (twW + PANEL_GAP);
  const lines = tw.length > 30 ? [tw.slice(0, 30), tw.slice(30)] : [tw];
  return `
    <rect x="${tx}" y="${footerY + 12}" width="28" height="28" rx="14" fill="${t.accent}" fill-opacity="0.25"/>
    <text x="${tx + 14}" y="${footerY + 30}" font-family="${ff}" font-weight="700" font-size="14" fill="${t.accent}" text-anchor="middle">${i + 1}</text>
    ${lines.map((l, li) => `<text x="${tx + 38}" y="${footerY + (li === 0 ? 26 : 40)}" font-family="${ff}" font-weight="${li === 0 ? '600' : '400'}" font-size="${li === 0 ? 14 : 12}" fill="#ffffffdd">${esc(l)}</text>`).join('\n')}
  `;
}).join('\n')}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>
      text { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    </style>
  </defs>
  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${header}
  ${p1}
  ${p2}
  ${p3}
  ${p4}
  ${p5}
  ${p6}
  ${footer}
</svg>`;
}

export async function posterToPng(svg: string): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('SVG render failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.drawImage(img, 0, 0, W, H);
    return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  } finally {
    URL.revokeObjectURL(url);
  }
}
