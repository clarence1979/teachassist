/**
 * PDF (pdf-lib) + DOCX (docx) builders for Quiz/Test artifacts.
 */

import {
  PDFDocument, rgb, type PDFPage, type PDFFont, type Color,
} from 'pdf-lib';
import { embedUnicodeFonts } from './unicodeFonts';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} from 'docx';
import type { Quiz, QuizQuestion } from './quizSchema';
import { winAnsiSafe } from './winAnsi';

// ─── PDF helpers (mirrors pdfRenderer layout engine) ──────────────────────────

const PAGE_W = 595.28, PAGE_H = 841.89, M = 54, CW = PAGE_W - M * 2;
const INK: Color = rgb(0.11, 0.11, 0.13);
const MUTED: Color = rgb(0.38, 0.42, 0.48);
const DIM: Color = rgb(0.58, 0.62, 0.68);
const ACCENT: Color = rgb(0.06, 0.30, 0.51);
const RULE: Color = rgb(0.80, 0.82, 0.85);
const CALLOUT_BG: Color = rgb(0.96, 0.97, 0.99);

interface Ctx { pdf: PDFDocument; page: PDFPage; y: number; pn: number; font: PDFFont; bold: PDFFont; italic: PDFFont; mono: PDFFont; title: string; }

async function mkCtx(title: string): Promise<Ctx> {
  const pdf = await PDFDocument.create();
  const { regular: font, bold, italic, mono } = await embedUnicodeFonts(pdf);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = { pdf, page, y: PAGE_H - M, pn: 1, font, bold, italic, mono, title };
  drawFooter(ctx); return ctx;
}

function np(ctx: Ctx) { ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H]); ctx.pn++; ctx.y = PAGE_H - M; drawFooter(ctx); }
function ensureSpace(ctx: Ctx, n: number) { if (ctx.y - n < M + 40) np(ctx); }
function clean(s: string) { return winAnsiSafe(s); }

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = text.split(/\s+/); const lines: string[] = []; let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (font.widthOfTextAtSize(t, size) > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines.length ? lines : [''];
}

function dt(ctx: Ctx, text: string, { size = 10.5, font, color = INK, indent = 0, g = 4 }: { size?: number; font?: PDFFont; color?: Color; indent?: number; g?: number } = {}) {
  const f = font ?? ctx.font;
  for (const line of wrap(clean(text), f, size, CW - indent)) {
    ensureSpace(ctx, size + g);
    ctx.page.drawText(line, { x: M + indent, y: ctx.y - size, size, font: f, color });
    ctx.y -= size + g;
  }
}

function dh(ctx: Ctx, text: string, level: 1 | 2 | 3 = 2) {
  const sz = level === 1 ? 20 : level === 2 ? 14 : 12;
  ensureSpace(ctx, sz + 16);
  ctx.y -= level === 1 ? 0 : 10;
  ctx.page.drawText(clean(text), { x: M, y: ctx.y - sz, size: sz, font: ctx.bold, color: INK });
  ctx.y -= sz;
  if (level <= 2) ctx.page.drawLine({ start: { x: M, y: ctx.y - 2 }, end: { x: M + (level === 1 ? 60 : 28), y: ctx.y - 2 }, thickness: 1.5, color: ACCENT });
  ctx.y -= 6;
}

function dbullets(ctx: Ctx, items: string[], ordered = false) {
  items.forEach((item, i) => {
    ensureSpace(ctx, 14);
    ctx.page.drawText(ordered ? `${i + 1}.` : '•', { x: M, y: ctx.y - 10.5, size: 10.5, font: ctx.bold, color: ACCENT });
    dt(ctx, item, { indent: 18, g: 3 });
  });
}

function drawFooter(ctx: Ctx) {
  const { page, font, title, pn } = ctx;
  page.drawLine({ start: { x: M, y: M - 10 }, end: { x: PAGE_W - M, y: M - 10 }, thickness: 0.5, color: RULE });
  page.drawText('TEACH ASSIST', { x: M, y: M - 22, size: 8, font, color: MUTED });
  const pg = `Page ${pn}`; const pw = font.widthOfTextAtSize(pg, 8);
  page.drawText(pg, { x: PAGE_W - M - pw, y: M - 22, size: 8, font, color: MUTED });
  const safeTitle = clean(title);
  const tw = font.widthOfTextAtSize(safeTitle, 8); page.drawText(safeTitle, { x: (PAGE_W - tw) / 2, y: M - 22, size: 8, font, color: DIM });
}

function drawCallout(ctx: Ctx, label: string, text: string) {
  const lines = wrap(clean(text), ctx.font, 10, CW - 24);
  const h = 22 + lines.length * 13; ensureSpace(ctx, h + 6);
  ctx.page.drawRectangle({ x: M, y: ctx.y - h, width: CW, height: h, color: CALLOUT_BG, borderColor: ACCENT, borderWidth: 0.6 });
  ctx.page.drawText(label.toUpperCase(), { x: M + 12, y: ctx.y - 14, size: 9, font: ctx.bold, color: ACCENT });
  lines.forEach((line, i) => ctx.page.drawText(line, { x: M + 12, y: ctx.y - 28 - i * 13, size: 10, font: ctx.font, color: INK }));
  ctx.y -= h + 8;
}

function drawAnswerLines(ctx: Ctx, count: number) {
  for (let i = 0; i < count; i++) {
    ensureSpace(ctx, 16);
    ctx.page.drawLine({ start: { x: M + 30, y: ctx.y - 12 }, end: { x: PAGE_W - M, y: ctx.y - 12 }, thickness: 0.4, color: RULE });
    ctx.y -= 18;
  }
}

function u8ToB64(bytes: Uint8Array): string {
  let s = ''; const C = 0x8000;
  for (let i = 0; i < bytes.length; i += C) s += String.fromCharCode(...bytes.subarray(i, i + C));
  return btoa(s);
}

// ─── Quiz PDF ─────────────────────────────────────────────────────────────────

export async function buildQuizPdf(quiz: Quiz, opts: { includeAnswerKey: boolean } = { includeAnswerKey: true }): Promise<string> {
  const ctx = await mkCtx(quiz.title);
  // Title block
  ctx.page.drawRectangle({ x: M, y: ctx.y - 6, width: 4, height: 44, color: ACCENT });
  ctx.page.drawText('TEACH ASSIST', { x: M + 14, y: ctx.y - 4, size: 8, font: ctx.bold, color: ACCENT });
  ctx.y -= 14;
  ctx.page.drawText(clean(quiz.title), { x: M + 14, y: ctx.y - 22, size: 22, font: ctx.bold, color: INK });
  ctx.y -= 30;
  const meta = [quiz.yearLevel, quiz.timeLimitMin ? `${quiz.timeLimitMin} min` : '', `${quiz.totalPoints} pts`].filter(Boolean).join('  ·  ');
  ctx.page.drawText(clean(meta), { x: M + 14, y: ctx.y - 11, size: 9, font: ctx.font, color: MUTED });
  ctx.y -= 16;
  ctx.page.drawLine({ start: { x: M, y: ctx.y - 4 }, end: { x: PAGE_W - M, y: ctx.y - 4 }, thickness: 0.5, color: RULE });
  ctx.y -= 10;

  // Name/date strip
  ctx.page.drawText('Name: ______________________________', { x: M, y: ctx.y - 12, size: 10, font: ctx.font, color: INK });
  ctx.page.drawText('Date: __________________', { x: M + 320, y: ctx.y - 12, size: 10, font: ctx.font, color: INK });
  ctx.y -= 26;

  if (quiz.instructions) drawCallout(ctx, 'Instructions', quiz.instructions);

  quiz.questions.forEach((q, i) => renderPdfQuestion(ctx, q, i + 1, false));

  if (opts.includeAnswerKey) {
    np(ctx);
    dh(ctx, 'Answer Key', 1);
    quiz.questions.forEach((q, i) => {
      ensureSpace(ctx, 18);
      const parts = [q.answer, q.blanks?.join(' / '), q.sequence?.join(' → '), q.pairs?.map((p) => `${p.left} = ${p.right}`).join('; '), q.workedSolution].filter(Boolean).join(' | ');
      dt(ctx, `${i + 1}. (${q.points}pt) ${parts || '(rubric)'}`, { size: 10 });
      if (q.explanation) dt(ctx, q.explanation, { size: 9.5, font: ctx.italic, color: MUTED, indent: 16 });
    });
  }

  return u8ToB64(await ctx.pdf.save());
}

function renderPdfQuestion(ctx: Ctx, q: QuizQuestion, num: number, showAnswer: boolean) {
  ensureSpace(ctx, 28);
  const pts = `  [${q.points}pt]`;
  ctx.page.drawText(`${num}.`, { x: M, y: ctx.y - 11, size: 11, font: ctx.bold, color: ACCENT });
  dt(ctx, `${q.prompt}${pts}`, { indent: 20 });

  switch (q.type) {
    case 'multiple_choice':
      q.choices?.forEach((c) => dt(ctx, `(  )  ${c.id}.  ${c.text}`, { indent: 30, size: 10 }));
      break;
    case 'true_false':
      dt(ctx, '(  ) True        (  ) False', { indent: 30, size: 10 });
      break;
    case 'fill_blank':
      dt(ctx, q.prompt.replace(/\{\{\d+\}\}/g, '__________'), { indent: 30, size: 10, color: MUTED });
      break;
    case 'short_answer': drawAnswerLines(ctx, 2); break;
    case 'long_answer': drawAnswerLines(ctx, 5); break;
    case 'code_trace':
      if (q.code) { const lines = q.code.split('\n'); for (const l of lines) { ensureSpace(ctx, 13); ctx.page.drawText(clean(l), { x: M + 30, y: ctx.y - 11, size: 9.5, font: ctx.mono, color: INK }); ctx.y -= 13; } }
      drawAnswerLines(ctx, 2);
      break;
    case 'worked_example': drawAnswerLines(ctx, 6); break;
    case 'matching':
      if (q.pairs) dbullets(ctx, q.pairs.map((p, i) => `${i + 1}. ${p.left}  →  ____`));
      break;
    case 'ordering':
      if (q.sequence) dbullets(ctx, [...q.sequence].sort(() => Math.random() - 0.5).map((s) => `___ ${s}`));
      break;
  }
  if (showAnswer && q.answer) dt(ctx, `Answer: ${q.answer}`, { indent: 30, font: ctx.italic, color: ACCENT });
  ctx.y -= 6;
}

// ─── Quiz DOCX ────────────────────────────────────────────────────────────────

const ACC = '0F4C81', MUT = '6B7280';

function dp(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}) {
  return new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text, bold: opts.bold, italics: opts.italic, size: opts.size ? opts.size * 2 : 22, color: opts.color })] });
}

function bul(text: string) { return new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text, size: 22 })] }); }

function calloutDocxQ(label: string, text: string) {
  const b = { style: BorderStyle.SINGLE, size: 4, color: ACC };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b },
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF2FF' },
      children: [new Paragraph({ children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 18, color: ACC })] }), dp(text)],
    })] })],
  });
}

async function blobB64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer(); const bytes = new Uint8Array(buf);
  let s = ''; const C = 0x8000;
  for (let i = 0; i < bytes.length; i += C) s += String.fromCharCode(...bytes.subarray(i, i + C));
  return btoa(s);
}

export async function buildQuizDocx(quiz: Quiz, opts: { includeAnswerKey: boolean } = { includeAnswerKey: true }): Promise<string> {
  const ch: (Paragraph | Table)[] = [];
  ch.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'TEACH ASSIST', bold: true, color: ACC, size: 16 })] }));
  ch.push(new Paragraph({ children: [new TextRun({ text: quiz.title, bold: true, size: 44 })] }));
  ch.push(dp(`${quiz.yearLevel}   ·   ${quiz.totalPoints} pts${quiz.timeLimitMin ? `   ·   ${quiz.timeLimitMin} min` : ''}`, { color: MUT, size: 10 }));
  ch.push(dp('Name: ______________________________      Date: _______________'));
  if (quiz.instructions) { ch.push(calloutDocxQ('Instructions', quiz.instructions)); ch.push(dp('')); }

  quiz.questions.forEach((q, i) => {
    ch.push(new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: `${i + 1}.  `, bold: true, color: ACC, size: 22 }), new TextRun({ text: `${q.prompt}  [${q.points}pt]`, size: 22 })] }));
    switch (q.type) {
      case 'multiple_choice': q.choices?.forEach((c) => ch.push(dp(`   ☐  ${c.id}.  ${c.text}`))); break;
      case 'true_false': ch.push(dp('   ☐ True       ☐ False')); break;
      case 'short_answer': ch.push(dp('__________________________________________________________')); ch.push(dp('__________________________________________________________')); break;
      case 'long_answer': for (let j = 0; j < 5; j++) ch.push(dp('__________________________________________________________')); break;
      case 'code_trace': if (q.code) q.code.split('\n').forEach((l) => ch.push(new Paragraph({ children: [new TextRun({ text: l || ' ', font: 'Consolas', size: 18 })] }))); ch.push(dp('Expected output: __________________')); break;
      case 'worked_example': for (let j = 0; j < 6; j++) ch.push(dp('__________________________________________________________')); break;
      case 'matching': q.pairs?.forEach((p, j) => ch.push(bul(`${j + 1}. ${p.left}  →  ____`))); break;
      case 'ordering': if (q.sequence) { [...q.sequence].sort(() => Math.random() - 0.5).forEach((s) => ch.push(bul(`___ ${s}`))); } break;
    }
  });

  if (opts.includeAnswerKey) {
    ch.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Answer Key', bold: true, color: ACC, size: 36 })] }));
    quiz.questions.forEach((q, i) => {
      const parts = [q.answer, q.blanks?.join(' / '), q.sequence?.join(' → '), q.pairs?.map((p) => `${p.left} = ${p.right}`).join('; '), q.workedSolution].filter(Boolean).join(' | ');
      ch.push(dp(`${i + 1}. (${q.points}pt) ${parts || '(rubric)'}`));
      if (q.explanation) ch.push(dp(q.explanation, { italic: true, color: MUT }));
    });
  }

  return blobB64(await Packer.toBlob(new Document({ creator: 'Teach Assist', title: quiz.title, sections: [{ children: ch }] })));
}

export function downloadBase64Pdf(base64: string, filename: string) {
  const a = document.createElement('a'); a.href = `data:application/pdf;base64,${base64}`; a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
export function downloadBase64Docx(base64: string, filename: string) {
  const a = document.createElement('a'); a.href = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64}`; a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
export function downloadText(text: string, filename: string, mime = 'application/json') {
  const a = document.createElement('a'); a.href = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
