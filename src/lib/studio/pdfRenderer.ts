/**
 * Low-level PDF layout engine built on pdf-lib.
 *
 * Exposes:
 *   • buildDocumentPdf(doc)  — renders a StructuredDocument
 *   • buildWorksheetPdf(ws, { includeAnswerKey }) — renders a Worksheet (all tiers)
 *
 * Both return a base64 string (suitable for Dexie storage and download).
 */

import {
  PDFDocument,
  rgb,
  PDFPage,
  PDFFont,
  type Color,
} from 'pdf-lib';
import { embedUnicodeFonts } from './unicodeFonts';
import type { StructuredDocument, DocBlock } from './documentSchema';
import type {
  Worksheet,
  WorksheetTier,
  Question,
} from './worksheetSchema';
import { TIER_LABELS } from './worksheetSchema';
import { winAnsiSafe } from './winAnsi';

// ─── Layout constants ─────────────────────────────────────────────────────────

const PAGE_W = 595.28;   // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 54;       // ~19mm
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK: Color = rgb(0.11, 0.11, 0.13);
const MUTED: Color = rgb(0.38, 0.42, 0.48);
const DIM: Color = rgb(0.58, 0.62, 0.68);
const ACCENT: Color = rgb(0.06, 0.30, 0.51); // Paper-Mono ink-blue — prints clean
const RULE: Color = rgb(0.80, 0.82, 0.85);
const CALLOUT_BG: Color = rgb(0.96, 0.97, 0.99);

// ─── Layout context ──────────────────────────────────────────────────────────

interface Ctx {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  pageNum: number;
  totalPagesRef: { value: number };
  footer: { schoolName?: string; teacherName?: string; date?: string; title: string };
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
}

async function createCtx(
  footer: Ctx['footer'],
): Promise<Ctx> {
  const pdf = await PDFDocument.create();
  const { regular: font, bold, italic, mono } = await embedUnicodeFonts(pdf);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = {
    pdf, page, y: PAGE_H - MARGIN,
    pageNum: 1,
    totalPagesRef: { value: 1 },
    footer, font, bold, italic, mono,
  };
  drawFooter(ctx);
  return ctx;
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
  ctx.pageNum += 1;
  ctx.totalPagesRef.value = ctx.pageNum;
  ctx.y = PAGE_H - MARGIN;
  drawFooter(ctx);
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 40) newPage(ctx);
}

function drawFooter(ctx: Ctx) {
  const { page, footer, font } = ctx;
  const bits: string[] = [];
  if (footer.schoolName) bits.push(footer.schoolName);
  if (footer.teacherName) bits.push(footer.teacherName);
  if (footer.date) bits.push(footer.date);
  const left = bits.join('  ·  ');
  page.drawLine({
    start: { x: MARGIN, y: MARGIN - 10 },
    end: { x: PAGE_W - MARGIN, y: MARGIN - 10 },
    thickness: 0.5, color: RULE,
  });
  if (left) {
    page.drawText(sanitize(left), { x: MARGIN, y: MARGIN - 22, size: 8, font, color: MUTED });
  }
  const right = `Page ${ctx.pageNum}`;
  const w = font.widthOfTextAtSize(right, 8);
  page.drawText(right, { x: PAGE_W - MARGIN - w, y: MARGIN - 22, size: 8, font, color: MUTED });
  const titleText = footer.title;
  const tw = font.widthOfTextAtSize(titleText, 8);
  page.drawText(titleText, { x: (PAGE_W - tw) / 2, y: MARGIN - 22, size: 8, font, color: DIM });
}

// ─── Text wrapping ───────────────────────────────────────────────────────────

function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function sanitize(text: string): string {
  return winAnsiSafe(text);
}

// ─── Primitive drawers ──────────────────────────────────────────────────────

function drawText(
  ctx: Ctx,
  text: string,
  opts: { size?: number; font?: PDFFont; color?: Color; indent?: number; lineGap?: number } = {},
): void {
  const size = opts.size ?? 10.5;
  const font = opts.font ?? ctx.font;
  const color = opts.color ?? INK;
  const indent = opts.indent ?? 0;
  const lineGap = opts.lineGap ?? size * 0.45;
  const lines = wrapText(sanitize(text), font, size, CONTENT_W - indent);
  for (const line of lines) {
    ensureSpace(ctx, size + lineGap);
    ctx.page.drawText(line, { x: MARGIN + indent, y: ctx.y - size, size, font, color });
    ctx.y -= size + lineGap;
  }
}

function drawHeading(ctx: Ctx, text: string, level: 1 | 2 | 3 = 2): void {
  const size = level === 1 ? 22 : level === 2 ? 14 : 11.5;
  const spaceBefore = level === 1 ? 0 : 12;
  const spaceAfter = 6;
  ensureSpace(ctx, size + spaceBefore + spaceAfter + 6);
  ctx.y -= spaceBefore;
  ctx.page.drawText(sanitize(text), {
    x: MARGIN, y: ctx.y - size, size, font: ctx.bold, color: INK,
  });
  ctx.y -= size;
  if (level === 1 || level === 2) {
    // Accent rule under heading
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y - 2 },
      end: { x: MARGIN + (level === 1 ? 60 : 28), y: ctx.y - 2 },
      thickness: 1.5, color: ACCENT,
    });
  }
  ctx.y -= spaceAfter;
}

function drawRule(ctx: Ctx) {
  ensureSpace(ctx, 10);
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y - 4 },
    end: { x: PAGE_W - MARGIN, y: ctx.y - 4 },
    thickness: 0.5, color: RULE,
  });
  ctx.y -= 10;
}

function drawBullets(ctx: Ctx, items: string[], ordered = false) {
  items.forEach((item, i) => {
    const bullet = ordered ? `${i + 1}.` : '•';
    ensureSpace(ctx, 12);
    ctx.page.drawText(bullet, {
      x: MARGIN, y: ctx.y - 10.5, size: 10.5, font: ctx.bold, color: ACCENT,
    });
    drawText(ctx, item, { indent: 18, lineGap: 4 });
  });
}

function drawKeyValue(ctx: Ctx, pairs: Array<{ key: string; value: string }>) {
  const keyW = 140;
  for (const { key, value } of pairs) {
    ensureSpace(ctx, 14);
    ctx.page.drawText(sanitize(key), {
      x: MARGIN, y: ctx.y - 10, size: 10, font: ctx.bold, color: MUTED,
    });
    const valLines = wrapText(sanitize(value), ctx.font, 10, CONTENT_W - keyW);
    valLines.forEach((line, i) => {
      if (i > 0) ensureSpace(ctx, 12);
      ctx.page.drawText(line, {
        x: MARGIN + keyW, y: ctx.y - 10, size: 10, font: ctx.font, color: INK,
      });
      if (i < valLines.length - 1) ctx.y -= 12;
    });
    ctx.y -= 14;
  }
}

function drawCallout(ctx: Ctx, label: string, text: string) {
  const lines = wrapText(sanitize(text), ctx.font, 10, CONTENT_W - 24);
  const h = 22 + lines.length * 13;
  ensureSpace(ctx, h + 6);
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - h, width: CONTENT_W, height: h,
    color: CALLOUT_BG, borderColor: ACCENT, borderWidth: 0.6,
  });
  ctx.page.drawText(sanitize(label.toUpperCase()), {
    x: MARGIN + 12, y: ctx.y - 14, size: 9, font: ctx.bold, color: ACCENT,
  });
  lines.forEach((line, i) => {
    ctx.page.drawText(line, {
      x: MARGIN + 12, y: ctx.y - 30 - i * 13, size: 10, font: ctx.font, color: INK,
    });
  });
  ctx.y -= h + 8;
}

function drawTable(ctx: Ctx, rows: string[][]) {
  if (!rows.length) return;
  const cols = rows[0].length;
  const colW = CONTENT_W / cols;
  const cellPad = 5;

  rows.forEach((row, rowIdx) => {
    const heights = row.map((cell) =>
      wrapText(sanitize(cell), ctx.font, 9.5, colW - cellPad * 2).length * 12 + cellPad * 2,
    );
    const rowH = Math.max(...heights, 20);
    ensureSpace(ctx, rowH + 2);

    if (rowIdx === 0) {
      ctx.page.drawRectangle({
        x: MARGIN, y: ctx.y - rowH, width: CONTENT_W, height: rowH, color: rgb(0.95, 0.96, 0.98),
      });
    }

    row.forEach((cell, colIdx) => {
      const x = MARGIN + colIdx * colW;
      ctx.page.drawRectangle({
        x, y: ctx.y - rowH, width: colW, height: rowH,
        borderColor: RULE, borderWidth: 0.5, color: rowIdx === 0 ? rgb(0.95, 0.96, 0.98) : rgb(1, 1, 1),
      });
      const lines = wrapText(sanitize(cell), ctx.font, 9.5, colW - cellPad * 2);
      lines.forEach((ln, i) => {
        ctx.page.drawText(ln, {
          x: x + cellPad, y: ctx.y - cellPad - 10 - i * 12,
          size: 9.5, font: rowIdx === 0 ? ctx.bold : ctx.font, color: INK,
        });
      });
    });

    ctx.y -= rowH;
  });
  ctx.y -= 8;
}

function drawMonoBlock(ctx: Ctx, text: string) {
  const lines = text.split('\n').flatMap((ln) => wrapText(sanitize(ln), ctx.mono, 9, CONTENT_W - 20));
  const h = lines.length * 12 + 14;
  ensureSpace(ctx, h + 4);
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - h, width: CONTENT_W, height: h,
    color: rgb(0.97, 0.97, 0.98), borderColor: RULE, borderWidth: 0.5,
  });
  lines.forEach((ln, i) => {
    ctx.page.drawText(ln, {
      x: MARGIN + 10, y: ctx.y - 12 - i * 12, size: 9, font: ctx.mono, color: INK,
    });
  });
  ctx.y -= h + 6;
}

// ─── Titleblock ──────────────────────────────────────────────────────────────

function drawTitleblock(ctx: Ctx, title: string, subtitle?: string, meta?: Array<{ label: string; value: string }>) {
  // Accent block top-left
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 6, width: 4, height: 40, color: ACCENT,
  });
  ctx.page.drawText('TEACH ASSIST', {
    x: MARGIN + 14, y: ctx.y - 4, size: 8, font: ctx.bold, color: ACCENT,
  });
  ctx.y -= 14;

  ctx.page.drawText(sanitize(title), {
    x: MARGIN + 14, y: ctx.y - 22, size: 22, font: ctx.bold, color: INK,
  });
  ctx.y -= 30;

  if (subtitle) {
    const lines = wrapText(sanitize(subtitle), ctx.italic, 11, CONTENT_W - 14);
    lines.forEach((ln, i) => {
      ctx.page.drawText(ln, {
        x: MARGIN + 14, y: ctx.y - 12 - i * 14, size: 11, font: ctx.italic, color: MUTED,
      });
    });
    ctx.y -= lines.length * 14 + 4;
  }

  if (meta && meta.length) {
    const text = meta.map((m) => `${m.label}: ${m.value}`).join('    ·    ');
    const lines = wrapText(sanitize(text), ctx.font, 9, CONTENT_W);
    lines.forEach((ln, i) => {
      ctx.page.drawText(ln, {
        x: MARGIN, y: ctx.y - 11 - i * 12, size: 9, font: ctx.font, color: MUTED,
      });
    });
    ctx.y -= lines.length * 12 + 6;
  }

  drawRule(ctx);
}

// ─── Document renderer ─────────────────────────────────────────────────────────

export async function buildDocumentPdf(doc: StructuredDocument): Promise<string> {
  const ctx = await createCtx({
    schoolName: doc.meta.schoolName,
    teacherName: doc.meta.teacherName,
    date: doc.meta.date,
    title: doc.title,
  });

  const metaBits: Array<{ label: string; value: string }> = [];
  if (doc.meta.yearLevel) metaBits.push({ label: 'Year', value: doc.meta.yearLevel });
  if (doc.meta.durationMin) metaBits.push({ label: 'Duration', value: `${doc.meta.durationMin} min` });
  if (doc.meta.curriculumStandard) metaBits.push({ label: 'Curriculum', value: doc.meta.curriculumStandard });
  if (doc.meta.topic) metaBits.push({ label: 'Topic', value: doc.meta.topic });

  drawTitleblock(ctx, doc.title, doc.subtitle, metaBits);

  for (const block of doc.blocks) renderBlock(ctx, block);

  const bytes = await ctx.pdf.save();
  return uint8ToBase64(bytes);
}

function renderBlock(ctx: Ctx, b: DocBlock) {
  if (b.heading) drawHeading(ctx, b.heading, 2);
  if (b.paragraphs) for (const p of b.paragraphs) { drawText(ctx, p); ctx.y -= 4; }
  if (b.bullets) drawBullets(ctx, b.bullets, false);
  if (b.numbered) drawBullets(ctx, b.numbered, true);
  if (b.table) drawTable(ctx, b.table);
  if (b.keyValue) drawKeyValue(ctx, b.keyValue);
  if (b.callout) drawCallout(ctx, b.callout.label, b.callout.text);
  ctx.y -= 4;
}

// ─── Worksheet renderer ─────────────────────────────────────────────────────

export async function buildWorksheetPdf(
  ws: Worksheet,
  opts: { includeAnswerKey: boolean } = { includeAnswerKey: true },
): Promise<string> {
  const ctx = await createCtx({
    schoolName: (ws as unknown as { schoolName?: string }).schoolName,
    teacherName: undefined,
    date: new Date().toISOString().slice(0, 10),
    title: ws.title,
  });

  const meta: Array<{ label: string; value: string }> = [];
  if (ws.yearLevel) meta.push({ label: 'Year', value: ws.yearLevel });
  if (ws.estimatedTimeMin) meta.push({ label: 'Time', value: `${ws.estimatedTimeMin} min` });
  if (ws.curriculumStandard) meta.push({ label: 'Standard', value: ws.curriculumStandard });
  if (ws.bloomOverall) meta.push({ label: "Bloom's", value: ws.bloomOverall });

  drawTitleblock(ctx, ws.title, ws.topic, meta);

  // Name/date strip
  ensureSpace(ctx, 22);
  ctx.page.drawText('Name: ______________________________', {
    x: MARGIN, y: ctx.y - 12, size: 10, font: ctx.font, color: INK,
  });
  ctx.page.drawText('Date: __________________', {
    x: MARGIN + 320, y: ctx.y - 12, size: 10, font: ctx.font, color: INK,
  });
  ctx.y -= 26;
  drawRule(ctx);

  // Each tier as its own section, new page between tiers
  ws.tiers.forEach((tier, idx) => {
    if (idx > 0) newPage(ctx);
    renderWorksheetTier(ctx, tier, false);
  });

  // Answer key (separate page)
  if (opts.includeAnswerKey) {
    newPage(ctx);
    drawHeading(ctx, 'Answer Key', 1);
    ws.tiers.forEach((tier, idx) => {
      if (idx > 0) ctx.y -= 10;
      drawHeading(ctx, `${TIER_LABELS[tier.tier]} — answers`, 3);
      tier.questions.forEach((q, qi) => renderAnswer(ctx, q, qi + 1));
    });
  }

  const bytes = await ctx.pdf.save();
  return uint8ToBase64(bytes);
}

function renderWorksheetTier(ctx: Ctx, tier: WorksheetTier, isKey: boolean) {
  drawHeading(ctx, `${TIER_LABELS[tier.tier]}`, 1);
  if (tier.readingLevelNote) {
    drawText(ctx, tier.readingLevelNote, { size: 9.5, font: ctx.italic, color: MUTED });
    ctx.y -= 2;
  }
  if (tier.instructions) {
    drawCallout(ctx, 'Instructions', tier.instructions);
  }
  tier.questions.forEach((q, i) => renderQuestion(ctx, q, i + 1, isKey));
}

function renderQuestion(ctx: Ctx, q: Question, num: number, showAnswer: boolean) {
  ensureSpace(ctx, 26);
  const marks = q.marks ? `  [${q.marks} mark${q.marks === 1 ? '' : 's'}]` : '';
  const tag = q.bloom ? `  (${q.bloom})` : '';
  // Question number and prompt — for fill_blank, replace {{n}} markers with underlines
  const displayPrompt = q.type === 'fill_blank'
    ? q.prompt.replace(/\{\{\d+\}\}/g, '__________')
    : q.prompt;
  ctx.page.drawText(`${num}.`, {
    x: MARGIN, y: ctx.y - 11, size: 11, font: ctx.bold, color: ACCENT,
  });
  drawText(ctx, `${displayPrompt}${marks}${tag}`, { indent: 20, size: 10.5 });

  switch (q.type) {
    case 'multiple_choice':
      q.choices?.forEach((c) => {
        drawText(ctx, `(  )  ${c.id}.  ${c.text}`, { indent: 30, size: 10 });
      });
      break;
    case 'true_false':
      drawText(ctx, '(  ) True        (  ) False', { indent: 30, size: 10 });
      break;
    case 'fill_blank':
      // Prompt already rendered with blanks above; just add answer lines
      drawAnswerLines(ctx, 1);
      break;
    case 'matching':
      if (q.pairs) {
        const rows = q.pairs.map((p, i) => [`${i + 1}. ${p.left}`, '____', String.fromCharCode(65 + i) + '. ' + p.right]);
        drawTable(ctx, [['Item', 'Match', 'Option'], ...rows]);
      }
      break;
    case 'ordering':
      if (q.sequence) {
        const scrambled = [...q.sequence].sort(() => Math.random() - 0.5);
        drawText(ctx, 'Put in order (write numbers):', { indent: 30, size: 10, font: ctx.italic, color: MUTED });
        scrambled.forEach((item) => drawText(ctx, `___  ${item}`, { indent: 36, size: 10 }));
      }
      break;
    case 'label_diagram':
      if (q.diagramDescription) drawMonoBlock(ctx, q.diagramDescription);
      if (q.labels) {
        drawText(ctx, `Labels to use: ${q.labels.join(', ')}`, { indent: 30, size: 9.5, font: ctx.italic, color: MUTED });
      }
      break;
    case 'code_trace':
      if (q.code) drawMonoBlock(ctx, q.code);
      drawText(ctx, 'Trace the output / final state:', { indent: 30, size: 10, font: ctx.italic, color: MUTED });
      drawAnswerLines(ctx, 3);
      break;
    case 'worked_example':
      drawText(ctx, 'Show your working:', { indent: 30, size: 10, font: ctx.italic, color: MUTED });
      drawAnswerLines(ctx, 5);
      break;
    case 'short_answer':
      drawAnswerLines(ctx, 2);
      break;
    case 'long_answer':
      drawAnswerLines(ctx, 6);
      break;
  }

  if (showAnswer && q.answer) {
    drawText(ctx, `Answer: ${q.answer}`, { indent: 30, size: 10, font: ctx.italic, color: ACCENT });
  }
  ctx.y -= 6;
}

function drawAnswerLines(ctx: Ctx, count: number) {
  for (let i = 0; i < count; i++) {
    ensureSpace(ctx, 16);
    ctx.page.drawLine({
      start: { x: MARGIN + 30, y: ctx.y - 12 },
      end: { x: PAGE_W - MARGIN, y: ctx.y - 12 },
      thickness: 0.4, color: RULE,
    });
    ctx.y -= 18;
  }
}

function renderAnswer(ctx: Ctx, q: Question, num: number) {
  ensureSpace(ctx, 18);
  const parts: string[] = [];
  if (q.answer) parts.push(q.answer);
  if (q.blanks?.length) parts.push(q.blanks.join(' / '));
  if (q.sequence) parts.push(q.sequence.join(' → '));
  if (q.pairs) parts.push(q.pairs.map((p) => `${p.left} ↔ ${p.right}`).join('; '));
  if (q.workedSolution) parts.push(q.workedSolution);
  if (q.labels) parts.push(q.labels.join(', '));
  const answer = parts.join(' | ') || '(see rubric)';
  drawText(ctx, `${num}. ${answer}`, { size: 10 });
  if (q.explanation) {
    drawText(ctx, q.explanation, { size: 9.5, font: ctx.italic, color: MUTED, indent: 16 });
  }
}

// ─── base64 helpers / download ────────────────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function downloadBase64Pdf(base64: string, filename: string) {
  const link = document.createElement('a');
  link.href = `data:application/pdf;base64,${base64}`;
  link.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
