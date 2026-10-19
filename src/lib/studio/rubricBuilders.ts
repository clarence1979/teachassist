/**
 * PDF (pdf-lib) + DOCX (docx) builders for Rubrics.
 */

import {
  PDFDocument, rgb, type PDFPage, type PDFFont, type Color,
} from 'pdf-lib';
import { embedUnicodeFonts } from './unicodeFonts';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} from 'docx';
import type { Rubric, RubricCriterion } from './rubricSchema';
import { winAnsiSafe } from './winAnsi';
import { wrapText } from './pdfText';

// ─── PDF helpers ──────────────────────────────────────────────────────────────

const PAGE_W = 841.89, PAGE_H = 595.28, M = 40; // A4 landscape for rubrics
const INK: Color = rgb(0.11, 0.11, 0.13);
const MUTED: Color = rgb(0.38, 0.42, 0.48);
const DIM: Color = rgb(0.58, 0.62, 0.68);
const ACCENT: Color = rgb(0.06, 0.30, 0.51);
const RULE: Color = rgb(0.80, 0.82, 0.85);
const HDR_BG: Color = rgb(0.06, 0.30, 0.51);
const HDR_FG: Color = rgb(1, 1, 1);
const ALT_BG: Color = rgb(0.97, 0.97, 0.99);

interface Ctx { pdf: PDFDocument; page: PDFPage; y: number; pn: number; font: PDFFont; bold: PDFFont; italic: PDFFont; title: string; }

async function mkCtx(title: string, landscape = true): Promise<Ctx> {
  const pdf = await PDFDocument.create();
  const { regular: font, bold, italic } = await embedUnicodeFonts(pdf);
  const dims: [number, number] = landscape ? [PAGE_W, PAGE_H] : [595.28, 841.89];
  const page = pdf.addPage(dims);
  const ctx: Ctx = { pdf, page, y: dims[1] - M, pn: 1, font, bold, italic, title };
  drawFooter(ctx, dims[0], dims[1]); return ctx;
}

function drawFooter(ctx: Ctx, w = PAGE_W, _h = PAGE_H) {
  const { page, font, pn, title } = ctx;
  page.drawLine({ start: { x: M, y: M - 8 }, end: { x: w - M, y: M - 8 }, thickness: 0.4, color: RULE });
  page.drawText('TEACH ASSIST', { x: M, y: M - 19, size: 7, font, color: MUTED });
  const pg = `Page ${pn}`; page.drawText(pg, { x: w - M - font.widthOfTextAtSize(pg, 7), y: M - 19, size: 7, font, color: MUTED });
  page.drawText(title, { x: (w - font.widthOfTextAtSize(title, 7)) / 2, y: M - 19, size: 7, font, color: DIM });
}

function clean(s: string) { return winAnsiSafe(s); }

function u8ToB64(b: Uint8Array): string {
  let s = ''; const C = 0x8000;
  for (let i = 0; i < b.length; i += C) s += String.fromCharCode(...b.subarray(i, i + C));
  return btoa(s);
}

// ─── Rubric PDF ───────────────────────────────────────────────────────────────

export async function buildRubricPdf(rubric: Rubric): Promise<string> {
  const landscape = rubric.style !== 'holistic';
  const W = landscape ? PAGE_W : 595.28;
  const H = landscape ? PAGE_H : 841.89;
  const ctx = await mkCtx(rubric.title, landscape);
  const cw = W - M * 2;

  // Title block
  ctx.page.drawRectangle({ x: M, y: ctx.y - 4, width: 3, height: 32, color: ACCENT });
  ctx.page.drawText('TEACH ASSIST', { x: M + 10, y: ctx.y - 3, size: 7, font: ctx.bold, color: ACCENT });
  ctx.y -= 10;
  ctx.page.drawText(clean(rubric.title), { x: M + 10, y: ctx.y - 18, size: 18, font: ctx.bold, color: INK });
  ctx.y -= 24;
  const meta = [rubric.yearLevel, rubric.style, `${rubric.maxScore} marks`, rubric.curriculumStandard].filter(Boolean).join('  ·  ');
  ctx.page.drawText(clean(meta), { x: M + 10, y: ctx.y - 10, size: 8.5, font: ctx.font, color: MUTED });
  ctx.y -= 16;
  ctx.page.drawLine({ start: { x: M, y: ctx.y }, end: { x: W - M, y: ctx.y }, thickness: 0.5, color: RULE });
  ctx.y -= 8;

  // Name strip
  ctx.page.drawText('Student: _________________________    Teacher: _________________    Date: ___________', { x: M, y: ctx.y - 10, size: 9, font: ctx.font, color: INK });
  ctx.y -= 18;

  if (rubric.style === 'analytic' || rubric.style === 'single_point') {
    drawAnalyticTable(ctx, rubric, cw, H);
  } else {
    drawHolisticTable(ctx, rubric, cw, H);
  }

  return u8ToB64(await ctx.pdf.save());
}

function drawAnalyticTable(ctx: Ctx, rubric: Rubric, cw: number, H: number) {
  if (!rubric.criteria.length) return;
  const levels = rubric.criteria[0]?.levels ?? [];
  const levelCount = levels.length;
  // columns: criterion | level... | score
  const criteriaW = cw * 0.22;
  const scoreW = cw * 0.08;
  const levelW = (cw - criteriaW - scoreW) / levelCount;

  // Header row
  const headerH = 28;
  let x = M;
  // Criterion cell
  ctx.page.drawRectangle({ x, y: ctx.y - headerH, width: criteriaW, height: headerH, color: HDR_BG });
  ctx.page.drawText('Criterion', { x: x + 4, y: ctx.y - 18, size: 9, font: ctx.bold, color: HDR_FG });
  x += criteriaW;
  // Level cells
  for (const lv of levels) {
    ctx.page.drawRectangle({ x, y: ctx.y - headerH, width: levelW, height: headerH, color: HDR_BG });
    ctx.page.drawText(`${clean(lv.label)} (${lv.score})`, { x: x + 4, y: ctx.y - 18, size: 9, font: ctx.bold, color: HDR_FG });
    x += levelW;
  }
  ctx.page.drawRectangle({ x, y: ctx.y - headerH, width: scoreW, height: headerH, color: HDR_BG });
  ctx.page.drawText('Score', { x: x + 4, y: ctx.y - 18, size: 9, font: ctx.bold, color: HDR_FG });
  ctx.y -= headerH;

  rubric.criteria.forEach((criterion, ci) => {
    const rowH = calcRowHeight(criterion, ctx.font, criteriaW, levelW, 9);
    if (ctx.y - rowH < M + 30) { ctx.page = ctx.pdf.addPage([PAGE_W, H]); ctx.pn++; ctx.y = H - M; drawFooter(ctx, PAGE_W, H); }
    const fill = ci % 2 === 0 ? rgb(1, 1, 1) : ALT_BG;
    let rx = M;
    // Criterion
    ctx.page.drawRectangle({ x: rx, y: ctx.y - rowH, width: criteriaW, height: rowH, color: fill, borderColor: RULE, borderWidth: 0.4 });
    ctx.page.drawText(clean(criterion.name), { x: rx + 4, y: ctx.y - 11, size: 9.5, font: ctx.bold, color: ACCENT });
    const descLines = wrapText(clean(criterion.description), ctx.font, 8.5, criteriaW - 8);
    descLines.forEach((l, i) => ctx.page.drawText(l, { x: rx + 4, y: ctx.y - 22 - i * 11, size: 8.5, font: ctx.font, color: MUTED }));
    if (criterion.weight) ctx.page.drawText(`${criterion.weight}%`, { x: rx + 4, y: ctx.y - rowH + 8, size: 8, font: ctx.italic, color: DIM });
    rx += criteriaW;
    // Levels
    for (const lv of criterion.levels) {
      ctx.page.drawRectangle({ x: rx, y: ctx.y - rowH, width: levelW, height: rowH, color: fill, borderColor: RULE, borderWidth: 0.4 });
      const descl = wrapText(clean(lv.descriptor), ctx.font, 8.5, levelW - 8);
      descl.forEach((l, i) => ctx.page.drawText(l, { x: rx + 4, y: ctx.y - 11 - i * 11, size: 8.5, font: ctx.font, color: INK }));
      rx += levelW;
    }
    // Score box
    ctx.page.drawRectangle({ x: rx, y: ctx.y - rowH, width: scoreW, height: rowH, color: fill, borderColor: RULE, borderWidth: 0.4 });
    ctx.page.drawText('/ ' + (criterion.levels[0]?.score ?? 0), { x: rx + 4, y: ctx.y - 11, size: 9, font: ctx.font, color: MUTED });
    ctx.y -= rowH;
  });

  // Total row
  ctx.page.drawRectangle({ x: M, y: ctx.y - 22, width: cw - scoreW, height: 22, color: rgb(0.97, 0.97, 0.99), borderColor: RULE, borderWidth: 0.4 });
  ctx.page.drawText('Total', { x: M + 4, y: ctx.y - 15, size: 9.5, font: ctx.bold, color: INK });
  ctx.page.drawRectangle({ x: M + cw - scoreW, y: ctx.y - 22, width: scoreW, height: 22, color: rgb(0.95, 0.96, 0.98), borderColor: RULE, borderWidth: 0.4 });
  ctx.page.drawText(`/ ${rubric.maxScore}`, { x: M + cw - scoreW + 4, y: ctx.y - 15, size: 9.5, font: ctx.bold, color: ACCENT });
  ctx.y -= 26;
}

function calcRowHeight(criterion: RubricCriterion, font: PDFFont, criteriaW: number, levelW: number, size: number): number {
  const descH = wrapText(criterion.description, font, size, criteriaW - 8).length * 11 + 22;
  const maxLevelH = Math.max(...criterion.levels.map((lv) => wrapText(lv.descriptor, font, size, levelW - 8).length * 11 + 12), 36);
  return Math.max(descH, maxLevelH);
}

function drawHolisticTable(ctx: Ctx, rubric: Rubric, cw: number, H: number) {
  const levels = rubric.holisticLevels ?? rubric.criteria.flatMap((c) => c.levels);
  if (!levels.length) return;
  const colW = cw / levels.length;
  // Header
  const headerH = 28; let x = M;
  for (const lv of levels) {
    ctx.page.drawRectangle({ x, y: ctx.y - headerH, width: colW, height: headerH, color: HDR_BG });
    ctx.page.drawText(`${clean(lv.label)} (${lv.score})`, { x: x + 4, y: ctx.y - 18, size: 9.5, font: ctx.bold, color: HDR_FG });
    x += colW;
  }
  ctx.y -= headerH;
  // Body
  const rowH = Math.max(...levels.map((lv) => wrapText(lv.descriptor, ctx.font, 9, colW - 8).length * 13 + 16), 60);
  if (ctx.y - rowH < M + 30) { ctx.page = ctx.pdf.addPage([PAGE_W, H]); ctx.pn++; ctx.y = H - M; drawFooter(ctx, PAGE_W, H); }
  x = M;
  for (const lv of levels) {
    ctx.page.drawRectangle({ x, y: ctx.y - rowH, width: colW, height: rowH, color: rgb(1, 1, 1), borderColor: RULE, borderWidth: 0.4 });
    wrapText(clean(lv.descriptor), ctx.font, 9, colW - 8).forEach((l, i) => ctx.page.drawText(l, { x: x + 4, y: ctx.y - 12 - i * 13, size: 9, font: ctx.font, color: INK }));
    x += colW;
  }
  ctx.y -= rowH + 8;
  // Criteria as reference
  if (rubric.criteria.length) {
    ctx.page.drawText('Criteria checklist:', { x: M, y: ctx.y - 11, size: 9.5, font: ctx.bold, color: ACCENT });
    ctx.y -= 14;
    rubric.criteria.forEach((c) => {
      if (ctx.y < M + 30) { ctx.page = ctx.pdf.addPage([PAGE_W, H]); ctx.pn++; ctx.y = H - M; drawFooter(ctx, PAGE_W, H); }
      ctx.page.drawText(`•  ${clean(c.name)}: ${clean(c.description)}`, { x: M + 10, y: ctx.y - 11, size: 9, font: ctx.font, color: MUTED });
      ctx.y -= 14;
    });
  }
}

// ─── Rubric DOCX ──────────────────────────────────────────────────────────────

const ACC = '0F4C81', MUT = '6B7280', HDR = '0F4C81';

function dp(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}) {
  return new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text, bold: opts.bold, italics: opts.italic, size: opts.size ? opts.size * 2 : 22, color: opts.color })] });
}

function border(color = 'CCCCCC') {
  const b = { style: BorderStyle.SINGLE, size: 4, color };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
}

async function blobB64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer(); const bytes = new Uint8Array(buf);
  let s = ''; const C = 0x8000;
  for (let i = 0; i < bytes.length; i += C) s += String.fromCharCode(...bytes.subarray(i, i + C));
  return btoa(s);
}

export async function buildRubricDocx(rubric: Rubric): Promise<string> {
  const ch: (Paragraph | Table)[] = [];
  ch.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'TEACH ASSIST', bold: true, color: ACC, size: 16 })] }));
  ch.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: rubric.title, bold: true, size: 44 })] }));
  ch.push(dp(`${rubric.yearLevel ?? ''}   ·   ${rubric.style}   ·   ${rubric.maxScore} marks`, { color: MUT, size: 10 }));
  ch.push(dp('Task: ' + rubric.task));
  ch.push(dp('Student: _________________________    Date: ___________    Score: ___ / ' + rubric.maxScore));
  ch.push(dp(''));

  if (rubric.style === 'analytic' || rubric.style === 'single_point') {
    const levels = rubric.criteria[0]?.levels ?? [];
    const colCount = levels.length + 2; // criterion + levels + score
    const colPct = Math.floor((100 - 20 - 8) / levels.length);

    const headerRow = new TableRow({
      children: [
        new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: HDR }, children: [new Paragraph({ children: [new TextRun({ text: 'Criterion', bold: true, color: 'FFFFFF', size: 18 })] })] }),
        ...levels.map((lv) => new TableCell({ width: { size: colPct, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: HDR }, children: [new Paragraph({ children: [new TextRun({ text: `${lv.label} (${lv.score})`, bold: true, color: 'FFFFFF', size: 18 })] })] })),
        new TableCell({ width: { size: 8, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: HDR }, children: [new Paragraph({ children: [new TextRun({ text: 'Score', bold: true, color: 'FFFFFF', size: 18 })] })] }),
      ],
    });

    const dataRows = rubric.criteria.map((c, ci) =>
      new TableRow({
        children: [
          new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: ci % 2 === 0 ? 'FFFFFF' : 'F4F6FA' }, children: [new Paragraph({ children: [new TextRun({ text: c.name, bold: true, color: ACC, size: 20 })] }), dp(c.description, { color: MUT, size: 10 }), c.weight ? dp(`${c.weight}%`, { color: MUT, size: 9, italic: true }) : dp('')] }),
          ...c.levels.map((lv) => new TableCell({ width: { size: colPct, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: ci % 2 === 0 ? 'FFFFFF' : 'F4F6FA' }, children: [dp(lv.descriptor)] })),
          new TableCell({ width: { size: 8, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: ci % 2 === 0 ? 'FFFFFF' : 'F4F6FA' }, children: [dp(`/ ${c.levels[0]?.score ?? 0}`, { color: MUT })] }),
        ],
      }),
    );

    ch.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: border(), rows: [headerRow, ...dataRows, new TableRow({ children: Array(colCount).fill(null).map((_, i) => new TableCell({ children: [i === 0 ? new Paragraph({ children: [new TextRun({ text: 'Total', bold: true, color: ACC, size: 22 })] }) : i === colCount - 1 ? dp(`/ ${rubric.maxScore}`, { bold: true, color: ACC }) : dp('')] })) })] }));
  } else {
    // Holistic
    const levels = rubric.holisticLevels ?? [];
    if (levels.length) {
      const headerRow = new TableRow({ children: levels.map((lv) => new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: HDR }, children: [new Paragraph({ children: [new TextRun({ text: `${lv.label} (${lv.score})`, bold: true, color: 'FFFFFF', size: 18 })] })] })) });
      const bodyRow = new TableRow({ children: levels.map((lv) => new TableCell({ children: [dp(lv.descriptor)] })) });
      ch.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: border(), rows: [headerRow, bodyRow] }));
    }
  }

  return blobB64(await Packer.toBlob(new Document({ creator: 'Teach Assist', title: rubric.title, sections: [{ children: ch }] })));
}

export function downloadBase64Pdf(base64: string, filename: string) {
  const a = document.createElement('a'); a.href = `data:application/pdf;base64,${base64}`; a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
export function downloadBase64Docx(base64: string, filename: string) {
  const a = document.createElement('a'); a.href = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64}`; a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
