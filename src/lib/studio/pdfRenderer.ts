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
import { wrapText, breakLongWord, normalizeWhitespace } from './pdfText';

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
  footer: { schoolName?: string; teacherName?: string; date?: string; title: string };
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
}

const BOTTOM_LIMIT = MARGIN + 40;

async function createCtx(
  footer: Ctx['footer'],
): Promise<Ctx> {
  const pdf = await PDFDocument.create();
  const { regular: font, bold, italic, mono } = await embedUnicodeFonts(pdf);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = {
    pdf, page, y: PAGE_H - MARGIN,
    pageNum: 1,
    footer, font, bold, italic, mono,
  };
  drawFooter(ctx);
  return ctx;
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
  ctx.pageNum += 1;
  ctx.y = PAGE_H - MARGIN;
  drawFooter(ctx);
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed < BOTTOM_LIMIT) newPage(ctx);
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxW: number): string {
  if (maxW <= 0) return '';
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length && font.widthOfTextAtSize(chars.join('') + '…', size) > maxW) chars.pop();
  return chars.length ? chars.join('').trimEnd() + '…' : '';
}

function drawFooter(ctx: Ctx) {
  const { page, footer, font } = ctx;
  const size = 8;
  const baseY = MARGIN - 22;
  const bits: string[] = [];
  if (footer.schoolName) bits.push(footer.schoolName);
  if (footer.teacherName) bits.push(footer.teacherName);
  if (footer.date) bits.push(footer.date);
  page.drawLine({
    start: { x: MARGIN, y: MARGIN - 10 },
    end: { x: PAGE_W - MARGIN, y: MARGIN - 10 },
    thickness: 0.5, color: RULE,
  });
  const right = `Page ${ctx.pageNum}`;
  const rightW = font.widthOfTextAtSize(right, size);
  page.drawText(right, { x: PAGE_W - MARGIN - rightW, y: baseY, size, font, color: MUTED });

  const left = truncateToWidth(sanitize(bits.join('  ·  ')), font, size, CONTENT_W * 0.38);
  const leftW = left ? font.widthOfTextAtSize(left, size) : 0;
  if (left) page.drawText(left, { x: MARGIN, y: baseY, size, font, color: MUTED });

  const center = PAGE_W / 2;
  const halfRoom = Math.min(center - (MARGIN + leftW + 16), PAGE_W - MARGIN - rightW - 16 - center);
  const title = truncateToWidth(sanitize(footer.title), font, size, halfRoom * 2);
  if (title) {
    const tw = font.widthOfTextAtSize(title, size);
    page.drawText(title, { x: center - tw / 2, y: baseY, size, font, color: DIM });
  }
}

// ─── Text wrapping ───────────────────────────────────────────────────────────

/** Monospace wrap that preserves leading/inner spaces (code, ASCII diagrams). */
function wrapMono(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const maxChars = Math.max(1, Math.floor(maxW / font.widthOfTextAtSize('M', size)));
  const lines: string[] = [];
  for (const raw of normalizeWhitespace(text).split('\n')) {
    const chars = Array.from(raw.replace(/\s+$/, ''));
    if (!chars.length) {
      lines.push('');
      continue;
    }
    for (let i = 0; i < chars.length; i += maxChars) lines.push(chars.slice(i, i + maxChars).join(''));
  }
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function sanitize(text: string): string {
  return winAnsiSafe(text ?? '');
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
    if (line) ctx.page.drawText(line, { x: MARGIN + indent, y: ctx.y - size, size, font, color });
    ctx.y -= size + lineGap;
  }
}

/**
 * Text with a hanging label ("3.", "A.") — wrapped lines align under the text,
 * not under the label. Optional right-aligned note sits on the first line.
 */
function drawHanging(
  ctx: Ctx,
  label: string,
  text: string,
  opts: {
    indent?: number; hang: number; size?: number; font?: PDFFont; color?: Color;
    labelFont?: PDFFont; labelColor?: Color; rightNote?: string;
  },
): void {
  const size = opts.size ?? 10.5;
  const font = opts.font ?? ctx.font;
  const lineH = size * 1.45;
  const labelFont = opts.labelFont ?? ctx.bold;
  const labelX = MARGIN + (opts.indent ?? 0);
  const labelW = label ? labelFont.widthOfTextAtSize(label, size) : 0;
  const textX = labelX + Math.max(opts.hang, labelW + 5);
  const note = opts.rightNote ? sanitize(opts.rightNote) : '';
  const noteSize = size - 1.5;
  const noteW = note ? ctx.font.widthOfTextAtSize(note, noteSize) : 0;
  const maxW = PAGE_W - MARGIN - textX - (note ? noteW + 12 : 0);
  const lines = wrapText(sanitize(text), font, size, maxW);

  lines.forEach((line, i) => {
    ensureSpace(ctx, lineH);
    const baseY = ctx.y - size;
    if (i === 0) {
      if (label) {
        ctx.page.drawText(label, { x: labelX, y: baseY, size, font: labelFont, color: opts.labelColor ?? INK });
      }
      if (note) {
        ctx.page.drawText(note, { x: PAGE_W - MARGIN - noteW, y: baseY, size: noteSize, font: ctx.font, color: MUTED });
      }
    }
    if (line) ctx.page.drawText(line, { x: textX, y: baseY, size, font, color: opts.color ?? INK });
    ctx.y -= lineH;
  });
}

function drawHeading(ctx: Ctx, text: string, level: 1 | 2 | 3 = 2): void {
  const size = level === 1 ? 22 : level === 2 ? 14 : 11.5;
  const lineH = size * 1.2;
  const spaceBefore = level === 1 ? 0 : 12;
  const spaceAfter = level === 3 ? 6 : 10;
  const lines = wrapText(sanitize(text), ctx.bold, size, CONTENT_W);
  // keep heading with at least two lines of following content
  ensureSpace(ctx, spaceBefore + lines.length * lineH + spaceAfter + 30);
  ctx.y -= spaceBefore;
  for (const line of lines) {
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y - size, size, font: ctx.bold, color: INK });
    ctx.y -= lineH;
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
  ctx.y -= 12;
}

function drawBullets(ctx: Ctx, items: string[], ordered = false) {
  items.forEach((item, i) => {
    drawHanging(ctx, ordered ? `${i + 1}.` : '•', item, {
      hang: 18, labelFont: ctx.bold, labelColor: ACCENT,
    });
  });
  ctx.y -= 2;
}

function drawKeyValue(ctx: Ctx, pairs: Array<{ key: string; value: string }>) {
  const keyW = 140;
  const size = 10;
  const lineH = 13;
  for (const { key, value } of pairs) {
    const keyLines = wrapText(sanitize(key), ctx.bold, size, keyW - 10);
    const valLines = wrapText(sanitize(value), ctx.font, size, CONTENT_W - keyW);
    const rows = Math.max(keyLines.length, valLines.length);
    for (let i = 0; i < rows; i++) {
      ensureSpace(ctx, lineH);
      const baseY = ctx.y - size;
      if (keyLines[i]) ctx.page.drawText(keyLines[i], { x: MARGIN, y: baseY, size, font: ctx.bold, color: MUTED });
      if (valLines[i]) ctx.page.drawText(valLines[i], { x: MARGIN + keyW, y: baseY, size, font: ctx.font, color: INK });
      ctx.y -= lineH;
    }
    ctx.y -= 3;
  }
}

function drawCallout(ctx: Ctx, label: string, text: string) {
  const size = 10;
  const lineH = 13.5;
  const pad = 12;
  const lines = wrapText(sanitize(text), ctx.font, size, CONTENT_W - pad * 2);
  const h = pad + 9 + 8 + lines.length * lineH + pad - (lineH - size);
  if (h > PAGE_H - MARGIN - BOTTOM_LIMIT) {
    drawText(ctx, label.toUpperCase(), { size: 9, font: ctx.bold, color: ACCENT });
    drawText(ctx, text, { size });
    ctx.y -= 6;
    return;
  }
  ensureSpace(ctx, h + 8);
  const top = ctx.y;
  ctx.page.drawRectangle({
    x: MARGIN, y: top - h, width: CONTENT_W, height: h,
    color: CALLOUT_BG, borderColor: ACCENT, borderWidth: 0.6,
  });
  ctx.page.drawText(sanitize(label.toUpperCase()), {
    x: MARGIN + pad, y: top - pad - 7, size: 9, font: ctx.bold, color: ACCENT,
  });
  lines.forEach((line, i) => {
    if (!line) return;
    ctx.page.drawText(line, {
      x: MARGIN + pad, y: top - pad - 9 - 8 - size * 0.8 - i * lineH, size, font: ctx.font, color: INK,
    });
  });
  ctx.y = top - h - 10;
}

function drawTable(
  ctx: Ctx,
  rows: string[][],
  layout: { indent?: number; widths?: number[] } = {},
) {
  if (!rows.length) return;
  const cols = Math.max(...rows.map((r) => r.length));
  const indent = layout.indent ?? 0;
  const totalW = CONTENT_W - indent;
  const fractions = layout.widths && layout.widths.length === cols
    ? layout.widths
    : Array.from({ length: cols }, () => 1 / cols);
  const fracSum = fractions.reduce((a, b) => a + b, 0);
  const colW = fractions.map((f) => (f / fracSum) * totalW);
  const colX = colW.map((_, i) => MARGIN + indent + colW.slice(0, i).reduce((a, b) => a + b, 0));
  const size = 9.5;
  const lineH = 12;
  const cellPad = 6;
  const HEADER_BG = rgb(0.95, 0.96, 0.98);

  rows.forEach((row, rowIdx) => {
    const font = rowIdx === 0 ? ctx.bold : ctx.font;
    const cellLines = colW.map((w, c) => wrapText(sanitize(row[c] ?? ''), font, size, w - cellPad * 2));
    const rowH = Math.max(...cellLines.map((l) => l.length), 1) * lineH + cellPad * 2 - (lineH - size) + 2;
    ensureSpace(ctx, rowH + 2);

    colW.forEach((w, c) => {
      ctx.page.drawRectangle({
        x: colX[c], y: ctx.y - rowH, width: w, height: rowH,
        borderColor: RULE, borderWidth: 0.5, color: rowIdx === 0 ? HEADER_BG : rgb(1, 1, 1),
      });
      cellLines[c].forEach((ln, i) => {
        if (!ln) return;
        ctx.page.drawText(ln, {
          x: colX[c] + cellPad, y: ctx.y - cellPad - size * 0.85 - i * lineH,
          size, font, color: INK,
        });
      });
    });

    ctx.y -= rowH;
  });
  ctx.y -= 8;
}

function drawMonoBlock(ctx: Ctx, text: string, indent = 0) {
  const size = 9;
  const lineH = 11.5;
  const pad = 8;
  const x = MARGIN + indent;
  const w = CONTENT_W - indent;
  const lines = wrapMono(sanitize(text), ctx.mono, size, w - pad * 2);
  if (!lines.length) return;

  while (lines.length) {
    ensureSpace(ctx, lineH * Math.min(lines.length, 3) + pad * 2);
    const fit = Math.max(1, Math.floor((ctx.y - BOTTOM_LIMIT - pad * 2) / lineH));
    const chunk = lines.splice(0, fit);
    const h = chunk.length * lineH + pad * 2;
    ctx.page.drawRectangle({
      x, y: ctx.y - h, width: w, height: h,
      color: rgb(0.97, 0.97, 0.98), borderColor: RULE, borderWidth: 0.5,
    });
    chunk.forEach((ln, i) => {
      if (!ln) return;
      ctx.page.drawText(ln, {
        x: x + pad, y: ctx.y - pad - lineH * 0.78 - i * lineH, size, font: ctx.mono, color: INK,
      });
    });
    ctx.y -= h;
    if (lines.length) newPage(ctx);
  }
  ctx.y -= 8;
}

// ─── Titleblock ──────────────────────────────────────────────────────────────

function drawTitleblock(ctx: Ctx, title: string, subtitle?: string, meta?: Array<{ label: string; value: string }>) {
  const textX = MARGIN + 14;
  const textW = CONTENT_W - 14;
  const titleSize = 22;
  const titleLH = 26;
  const top = ctx.y;

  ctx.page.drawText('TEACH ASSIST', { x: textX, y: top - 7, size: 8, font: ctx.bold, color: ACCENT });
  let y = top - 14;

  const titleLines = wrapText(sanitize(title), ctx.bold, titleSize, textW);
  for (const ln of titleLines) {
    ctx.page.drawText(ln, { x: textX, y: y - 20, size: titleSize, font: ctx.bold, color: INK });
    y -= titleLH;
  }
  ctx.page.drawRectangle({ x: MARGIN, y: y + 2, width: 4, height: top - y - 2, color: ACCENT });
  y -= 4;

  if (subtitle) {
    const lines = wrapText(sanitize(subtitle), ctx.italic, 11, textW);
    for (const ln of lines) {
      if (ln) ctx.page.drawText(ln, { x: textX, y: y - 11, size: 11, font: ctx.italic, color: MUTED });
      y -= 15;
    }
    y -= 2;
  }

  if (meta && meta.length) {
    const text = meta.map((m) => `${m.label}: ${m.value}`).join('    ·    ');
    const lines = wrapText(sanitize(text), ctx.font, 9, textW);
    for (const ln of lines) {
      if (ln) ctx.page.drawText(ln, { x: textX, y: y - 9, size: 9, font: ctx.font, color: MUTED });
      y -= 12;
    }
  }

  ctx.y = y - 4;
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

const Q_HANG = 24;
const Q_SIZE = 10.5;
const Q_LINE_H = Q_SIZE * 1.45;

type Shuffles = WeakMap<Question, number[]>;

function shuffledOrder(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (n > 1 && order.every((v, i) => v === i)) order.push(order.shift() as number);
  return order;
}

function orderFor(shuffles: Shuffles, q: Question, n: number): number[] {
  let order = shuffles.get(q);
  if (!order || order.length !== n) {
    order = shuffledOrder(n);
    shuffles.set(q, order);
  }
  return order;
}

function questionNote(q: Question): string {
  const bits: string[] = [];
  if (q.marks) bits.push(`[${q.marks} mark${q.marks === 1 ? '' : 's'}]`);
  if (q.bloom) bits.push(q.bloom.charAt(0).toUpperCase() + q.bloom.slice(1));
  return bits.join('  ·  ');
}

function drawFillBlankPrompt(ctx: Ctx, label: string, prompt: string, note: string) {
  const size = Q_SIZE;
  const font = ctx.font;
  const blankW = 72;
  const labelX = MARGIN;
  const startX = MARGIN + Q_HANG;
  const noteText = sanitize(note);
  const noteSize = size - 1.5;
  const noteW = noteText ? font.widthOfTextAtSize(noteText, noteSize) : 0;
  const maxX = PAGE_W - MARGIN - (noteText ? noteW + 12 : 0);
  const spaceW = font.widthOfTextAtSize(' ', size);

  type Tok = { kind: 'word'; text: string } | { kind: 'blank' } | { kind: 'space' } | { kind: 'break' };
  const tokens: Tok[] = [];
  for (const part of normalizeWhitespace(sanitize(prompt)).trim().split(/(\{\{\s*\d+\s*\}\})/)) {
    if (/^\{\{\s*\d+\s*\}\}$/.test(part)) {
      tokens.push({ kind: 'blank' });
      continue;
    }
    for (const piece of part.split(/(\n|[ ]+)/)) {
      if (!piece) continue;
      if (piece === '\n') tokens.push({ kind: 'break' });
      else if (/^ +$/.test(piece)) tokens.push({ kind: 'space' });
      else tokens.push({ kind: 'word', text: piece });
    }
  }

  let x = startX;
  let pendingSpace = false;
  let firstLine = true;
  const startLine = () => {
    ensureSpace(ctx, Q_LINE_H);
    if (firstLine) {
      const baseY = ctx.y - size;
      ctx.page.drawText(label, { x: labelX, y: baseY, size, font: ctx.bold, color: ACCENT });
      if (noteText) {
        ctx.page.drawText(noteText, { x: PAGE_W - MARGIN - noteW, y: baseY, size: noteSize, font, color: MUTED });
      }
      firstLine = false;
    }
  };
  const breakLine = () => {
    ctx.y -= Q_LINE_H;
    x = startX;
    pendingSpace = false;
    startLine();
  };

  startLine();
  for (const tok of tokens) {
    if (tok.kind === 'space') { pendingSpace = x > startX; continue; }
    if (tok.kind === 'break') { breakLine(); continue; }
    const pieces = tok.kind === 'word' ? breakLongWord(tok.text, font, size, maxX - startX) : [null];
    for (const piece of pieces) {
      const w = piece === null ? blankW : font.widthOfTextAtSize(piece, size);
      const gap = pendingSpace ? spaceW : 0;
      if (x > startX && x + gap + w > maxX) breakLine();
      else x += gap;
      pendingSpace = false;
      const baseY = ctx.y - size;
      if (piece === null) {
        ctx.page.drawLine({
          start: { x: x + 2, y: baseY - 1.5 },
          end: { x: x + w - 2, y: baseY - 1.5 },
          thickness: 0.8, color: INK,
        });
      } else {
        ctx.page.drawText(piece, { x, y: baseY, size, font, color: INK });
      }
      x += w;
    }
  }
  ctx.y -= Q_LINE_H;
}

function drawNameDateStrip(ctx: Ctx) {
  const size = 10;
  ensureSpace(ctx, 30);
  const baseY = ctx.y - 16;
  const nameLabel = 'Name';
  const dateLabel = 'Date';
  const nameEnd = MARGIN + CONTENT_W * 0.64;
  const dateX = nameEnd + 20;
  ctx.page.drawText(nameLabel, { x: MARGIN, y: baseY, size, font: ctx.bold, color: INK });
  ctx.page.drawLine({
    start: { x: MARGIN + ctx.bold.widthOfTextAtSize(nameLabel, size) + 8, y: baseY - 2 },
    end: { x: nameEnd, y: baseY - 2 },
    thickness: 0.6, color: MUTED,
  });
  ctx.page.drawText(dateLabel, { x: dateX, y: baseY, size, font: ctx.bold, color: INK });
  ctx.page.drawLine({
    start: { x: dateX + ctx.bold.widthOfTextAtSize(dateLabel, size) + 8, y: baseY - 2 },
    end: { x: PAGE_W - MARGIN, y: baseY - 2 },
    thickness: 0.6, color: MUTED,
  });
  ctx.y -= 28;
  drawRule(ctx);
}

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
  const shuffles: Shuffles = new WeakMap();

  const meta: Array<{ label: string; value: string }> = [];
  if (ws.yearLevel) meta.push({ label: 'Year', value: ws.yearLevel });
  if (ws.estimatedTimeMin) meta.push({ label: 'Time', value: `${ws.estimatedTimeMin} min` });
  if (ws.curriculumStandard) meta.push({ label: 'Standard', value: ws.curriculumStandard });
  if (ws.bloomOverall) meta.push({ label: "Bloom's", value: ws.bloomOverall });

  drawTitleblock(ctx, ws.title, ws.topic, meta);
  drawNameDateStrip(ctx);

  ws.tiers.forEach((tier, idx) => {
    if (idx > 0) {
      newPage(ctx);
      drawNameDateStrip(ctx);
    }
    renderWorksheetTier(ctx, tier, shuffles, ws.tiers.length > 1 ? `Version ${idx + 1} of ${ws.tiers.length}` : undefined);
  });

  if (opts.includeAnswerKey) {
    newPage(ctx);
    drawHeading(ctx, 'Answer Key', 1);
    ws.tiers.forEach((tier, idx) => {
      if (idx > 0) ctx.y -= 6;
      if (ws.tiers.length > 1) {
        drawHeading(ctx, `Version ${idx + 1} — ${TIER_LABELS[tier.tier] ?? tier.tier}`, 3);
      }
      if (tier.readingLevelNote) {
        drawText(ctx, tier.readingLevelNote, { size: 9.5, font: ctx.italic, color: MUTED });
        ctx.y -= 4;
      }
      tier.questions.forEach((q, qi) => renderAnswer(ctx, q, qi + 1, shuffles));
    });
  }

  const bytes = await ctx.pdf.save();
  return uint8ToBase64(bytes);
}

// Difficulty level and reading note are teacher-facing; they appear in the answer key only.
function renderWorksheetTier(ctx: Ctx, tier: WorksheetTier, shuffles: Shuffles, versionLabel?: string) {
  if (versionLabel) {
    drawText(ctx, versionLabel, { size: 9, font: ctx.bold, color: MUTED });
    ctx.y -= 4;
  }
  if (tier.instructions) drawCallout(ctx, 'Instructions', tier.instructions);
  tier.questions.forEach((q, i) => renderQuestion(ctx, q, i + 1, shuffles));
}

function drawBubble(ctx: Ctx, x: number, baseY: number) {
  ctx.page.drawEllipse({
    x: x + 4.5, y: baseY + 3.4, xScale: 4.5, yScale: 4.5,
    borderColor: MUTED, borderWidth: 0.8,
  });
}

function renderQuestion(ctx: Ctx, q: Question, num: number, shuffles: Shuffles) {
  // keep the question number with its first lines and some response space
  ensureSpace(ctx, Q_LINE_H * 3);
  const label = `${num}.`;
  const note = questionNote(q);
  const subIndent = Q_HANG;

  if (q.type === 'fill_blank') {
    drawFillBlankPrompt(ctx, label, q.prompt, note);
  } else {
    drawHanging(ctx, label, q.prompt, {
      hang: Q_HANG, size: Q_SIZE, labelColor: ACCENT, rightNote: note,
    });
  }
  ctx.y -= 3;

  switch (q.type) {
    case 'multiple_choice':
      q.choices?.forEach((c) => {
        ensureSpace(ctx, Q_LINE_H);
        drawBubble(ctx, MARGIN + subIndent, ctx.y - 10);
        drawHanging(ctx, `${c.id}.`, c.text, {
          indent: subIndent + 16, hang: 18, size: 10, labelFont: ctx.bold, labelColor: INK,
        });
        ctx.y -= 1;
      });
      break;
    case 'true_false': {
      ensureSpace(ctx, Q_LINE_H);
      const baseY = ctx.y - 10;
      const x0 = MARGIN + subIndent;
      drawBubble(ctx, x0, baseY);
      ctx.page.drawText('True', { x: x0 + 16, y: baseY, size: 10, font: ctx.font, color: INK });
      drawBubble(ctx, x0 + 80, baseY);
      ctx.page.drawText('False', { x: x0 + 96, y: baseY, size: 10, font: ctx.font, color: INK });
      ctx.y -= Q_LINE_H;
      break;
    }
    case 'fill_blank':
      break;
    case 'matching':
      if (q.pairs?.length) {
        const order = orderFor(shuffles, q, q.pairs.length);
        const rows = q.pairs.map((p, i) => [
          `${i + 1}. ${p.left}`,
          '',
          `${String.fromCharCode(65 + i)}. ${q.pairs![order[i]].right}`,
        ]);
        drawTable(ctx, [['Item', 'Letter', 'Option'], ...rows], { indent: subIndent, widths: [0.44, 0.12, 0.44] });
      }
      break;
    case 'ordering':
      if (q.sequence?.length) {
        const order = orderFor(shuffles, q, q.sequence.length);
        drawText(ctx, 'Number the steps in the correct order:', { indent: subIndent, size: 9.5, font: ctx.italic, color: MUTED });
        order.forEach((srcIdx) => {
          ensureSpace(ctx, Q_LINE_H);
          const baseY = ctx.y - 10;
          ctx.page.drawRectangle({
            x: MARGIN + subIndent, y: baseY - 3, width: 18, height: 14,
            borderColor: MUTED, borderWidth: 0.7,
          });
          drawHanging(ctx, '', q.sequence![srcIdx], { indent: subIndent, hang: 28, size: 10 });
          ctx.y -= 2;
        });
      }
      break;
    case 'label_diagram':
      if (q.diagramDescription) drawMonoBlock(ctx, q.diagramDescription, subIndent);
      if (q.labels?.length) {
        drawText(ctx, `Labels to use: ${q.labels.join(', ')}`, { indent: subIndent, size: 9.5, font: ctx.italic, color: MUTED });
      }
      break;
    case 'code_trace':
      if (q.code) drawMonoBlock(ctx, q.code, subIndent);
      drawText(ctx, 'Trace the output / final state:', { indent: subIndent, size: 9.5, font: ctx.italic, color: MUTED });
      drawAnswerLines(ctx, 3);
      break;
    case 'worked_example':
      drawText(ctx, 'Show your working:', { indent: subIndent, size: 9.5, font: ctx.italic, color: MUTED });
      drawAnswerLines(ctx, 5);
      break;
    case 'short_answer':
      drawAnswerLines(ctx, 2);
      break;
    case 'long_answer':
      drawAnswerLines(ctx, 6);
      break;
  }

  ctx.y -= 10;
}

function drawAnswerLines(ctx: Ctx, count: number) {
  const gap = 22;
  for (let i = 0; i < count; i++) {
    ensureSpace(ctx, gap);
    ctx.page.drawLine({
      start: { x: MARGIN + Q_HANG, y: ctx.y - gap + 4 },
      end: { x: PAGE_W - MARGIN, y: ctx.y - gap + 4 },
      thickness: 0.5, color: RULE,
    });
    ctx.y -= gap;
  }
}

function renderAnswer(ctx: Ctx, q: Question, num: number, shuffles: Shuffles) {
  const parts: string[] = [];
  if (q.type === 'matching' && q.pairs?.length) {
    const order = orderFor(shuffles, q, q.pairs.length);
    parts.push(q.pairs.map((p, i) => {
      const letter = String.fromCharCode(65 + order.indexOf(i));
      return `${i + 1}–${letter} (${p.left} ↔ ${p.right})`;
    }).join(';  '));
  } else if (q.type === 'ordering' && q.sequence?.length) {
    parts.push(q.sequence.map((s, i) => `${i + 1}. ${s}`).join('   '));
  } else {
    if (q.answer) parts.push(q.type === 'true_false' ? q.answer.charAt(0).toUpperCase() + q.answer.slice(1) : q.answer);
    if (q.blanks?.length) parts.push(q.blanks.map((b, i) => `(${i + 1}) ${b}`).join('   '));
    if (q.labels?.length && !q.answer) parts.push(q.labels.join(', '));
  }
  const answer = parts.join('  |  ') || '(see rubric)';
  drawHanging(ctx, `${num}.`, answer, { hang: Q_HANG, size: 10, labelColor: ACCENT });
  if (q.workedSolution) {
    drawText(ctx, q.workedSolution, { size: 9.5, indent: Q_HANG });
  }
  if (q.explanation) {
    drawText(ctx, q.explanation, { size: 9.5, font: ctx.italic, color: MUTED, indent: Q_HANG });
  }
  ctx.y -= 5;
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
