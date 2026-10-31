/**
 * PDF (pdf-lib) and DOCX (docx) builders for Student Notes.
 * Also exports buildNotesMd() for raw Markdown download.
 */

import {
  PDFDocument, rgb, type PDFPage, type PDFFont, type Color,
} from 'pdf-lib';
import { embedUnicodeFonts } from './unicodeFonts';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} from 'docx';
import type { StudentNotes, NotesBlock, GlossaryEntry } from './notesSchema';
import { winAnsiSafe } from './winAnsi';
import { wrapText } from './pdfText';

// ─── PDF layout constants ─────────────────────────────────────────────────────

const PAGE_W = 595.28, PAGE_H = 841.89, M = 54, CW = PAGE_W - M * 2;
const INK: Color = rgb(0.11, 0.11, 0.13);
const MUTED: Color = rgb(0.38, 0.42, 0.48);
const DIM: Color = rgb(0.58, 0.62, 0.68);
const ACCENT: Color = rgb(0.06, 0.30, 0.51);
const RULE: Color = rgb(0.80, 0.82, 0.85);
const NOTE_BG: Color = rgb(0.97, 0.97, 0.99);
const TIP_BG: Color = rgb(0.95, 0.99, 0.96);
const WARN_BG: Color = rgb(1.0, 0.97, 0.91);
const NOTE_BORDER: Color = rgb(0.41, 0.53, 0.78);
const TIP_BORDER: Color = rgb(0.13, 0.77, 0.37);
const WARN_BORDER: Color = rgb(0.95, 0.62, 0.12);

interface Ctx { pdf: PDFDocument; page: PDFPage; y: number; pn: number; font: PDFFont; bold: PDFFont; italic: PDFFont; mono: PDFFont; title: string; }

async function mkCtx(title: string): Promise<Ctx> {
  const pdf = await PDFDocument.create();
  const { regular: font, bold, italic, mono } = await embedUnicodeFonts(pdf);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = { pdf, page, y: PAGE_H - M, pn: 1, font, bold, italic, mono, title };
  footer(ctx);
  return ctx;
}

function np(ctx: Ctx) {
  ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
  ctx.pn++;
  ctx.y = PAGE_H - M;
  footer(ctx);
}

function gap(ctx: Ctx, need: number) { if (ctx.y - need < M + 40) np(ctx); }

function footer(ctx: Ctx) {
  const { page, font, title, pn } = ctx;
  page.drawLine({ start: { x: M, y: M - 10 }, end: { x: PAGE_W - M, y: M - 10 }, thickness: 0.5, color: RULE });
  page.drawText('TEACH ASSIST', { x: M, y: M - 22, size: 8, font, color: MUTED });
  const pg = `Page ${pn}`;
  const pw = font.widthOfTextAtSize(pg, 8);
  page.drawText(pg, { x: PAGE_W - M - pw, y: M - 22, size: 8, font, color: MUTED });
  const safeTitle = clean(title);
  const tw = font.widthOfTextAtSize(safeTitle, 8);
  page.drawText(safeTitle, { x: (PAGE_W - tw) / 2, y: M - 22, size: 8, font, color: DIM });
}

function clean(s: string) { return winAnsiSafe(s); }

function dt(ctx: Ctx, text: string, { size = 10.5, font, color = INK, indent = 0, gap: g = 4 }: { size?: number; font?: PDFFont; color?: Color; indent?: number; gap?: number } = {}) {
  const f = font ?? ctx.font;
  const lines = wrapText(clean(text), f, size, CW - indent);
  for (const line of lines) {
    gap(ctx, size + g);
    ctx.page.drawText(line, { x: M + indent, y: ctx.y - size, size, font: f, color });
    ctx.y -= size + g;
  }
}

function dh(ctx: Ctx, text: string, level: 1 | 2 | 3 = 2) {
  const sz = level === 1 ? 20 : level === 2 ? 14 : 12;
  gap(ctx, sz + 16 + 8);
  ctx.y -= level === 1 ? 0 : 10;
  ctx.page.drawText(clean(text), { x: M, y: ctx.y - sz, size: sz, font: ctx.bold, color: INK });
  ctx.y -= sz;
  if (level <= 2) { ctx.page.drawLine({ start: { x: M, y: ctx.y - 2 }, end: { x: M + (level === 1 ? 60 : 28), y: ctx.y - 2 }, thickness: 1.5, color: ACCENT }); }
  ctx.y -= 6;
}

function dr(ctx: Ctx) {
  gap(ctx, 8);
  ctx.page.drawLine({ start: { x: M, y: ctx.y - 4 }, end: { x: PAGE_W - M, y: ctx.y - 4 }, thickness: 0.4, color: RULE });
  ctx.y -= 10;
}

function dbullets(ctx: Ctx, items: string[], ordered = false) {
  items.forEach((item, i) => {
    gap(ctx, 14);
    ctx.page.drawText(ordered ? `${i + 1}.` : '•', { x: M, y: ctx.y - 10.5, size: 10.5, font: ctx.bold, color: ACCENT });
    dt(ctx, item, { indent: 18, gap: 3 });
  });
}

function dcallout(ctx: Ctx, type: 'note' | 'tip' | 'warning', text: string) {
  const bgMap = { note: NOTE_BG, tip: TIP_BG, warning: WARN_BG };
  const bMap = { note: NOTE_BORDER, tip: TIP_BORDER, warning: WARN_BORDER };
  const lMap = { note: 'NOTE', tip: 'TIP', warning: 'WARNING' };
  const lines = wrapText(clean(text), ctx.font, 10, CW - 24);
  const h = 22 + lines.length * 13;
  gap(ctx, h + 6);
  ctx.page.drawRectangle({ x: M, y: ctx.y - h, width: CW, height: h, color: bgMap[type], borderColor: bMap[type], borderWidth: 0.6 });
  ctx.page.drawText(lMap[type], { x: M + 12, y: ctx.y - 14, size: 9, font: ctx.bold, color: bMap[type] });
  lines.forEach((line, i) => ctx.page.drawText(line, { x: M + 12, y: ctx.y - 28 - i * 13, size: 10, font: ctx.font, color: INK }));
  ctx.y -= h + 8;
}

function dmono(ctx: Ctx, text: string) {
  const lines = text.split('\n').flatMap((l) => wrapText(clean(l), ctx.mono, 9, CW - 20));
  const h = lines.length * 12 + 14;
  gap(ctx, h + 4);
  ctx.page.drawRectangle({ x: M, y: ctx.y - h, width: CW, height: h, color: rgb(0.97, 0.97, 0.98), borderColor: RULE, borderWidth: 0.5 });
  lines.forEach((l, i) => ctx.page.drawText(l, { x: M + 10, y: ctx.y - 12 - i * 12, size: 9, font: ctx.mono, color: INK }));
  ctx.y -= h + 6;
}

function u8ToB64(bytes: Uint8Array): string {
  let s = ''; const C = 0x8000;
  for (let i = 0; i < bytes.length; i += C) s += String.fromCharCode(...bytes.subarray(i, i + C));
  return btoa(s);
}

// ─── Notes PDF ───────────────────────────────────────────────────────────────

export async function buildNotesPdf(notes: StudentNotes): Promise<string> {
  const ctx = await mkCtx(notes.title);
  // Title block
  ctx.page.drawRectangle({ x: M, y: ctx.y - 6, width: 4, height: 44, color: ACCENT });
  ctx.page.drawText('TEACH ASSIST', { x: M + 14, y: ctx.y - 4, size: 8, font: ctx.bold, color: ACCENT });
  ctx.y -= 14;
  ctx.page.drawText(clean(notes.title), { x: M + 14, y: ctx.y - 22, size: 22, font: ctx.bold, color: INK });
  ctx.y -= 28;
  const meta = [notes.yearLevel, notes.depth].filter(Boolean).join('  ·  ');
  ctx.page.drawText(meta, { x: M + 14, y: ctx.y - 11, size: 9, font: ctx.font, color: MUTED });
  ctx.y -= 18;
  dr(ctx);

  if (notes.objectives?.length) {
    dh(ctx, 'Learning Objectives', 2);
    dbullets(ctx, notes.objectives);
    dr(ctx);
  }

  for (const block of notes.blocks) renderNotesBlock(ctx, block);

  if (notes.glossary?.length) {
    np(ctx);
    dh(ctx, 'Glossary', 1);
    for (const g of notes.glossary) {
      gap(ctx, 16);
      ctx.page.drawText(clean(g.term), { x: M, y: ctx.y - 11, size: 11, font: ctx.bold, color: ACCENT });
      ctx.y -= 14;
      dt(ctx, g.definition, { indent: 16, gap: 3 });
    }
  }

  if (notes.selfCheck?.length) {
    np(ctx);
    dh(ctx, 'Self-Check Questions', 1);
    dcallout(ctx, 'tip', 'Try to answer these without looking at your notes first.');
    dbullets(ctx, notes.selfCheck, true);
  }

  return u8ToB64(await ctx.pdf.save());
}

function renderNotesBlock(ctx: Ctx, b: NotesBlock) {
  dh(ctx, b.heading, 2);
  if (b.paragraphs) for (const p of b.paragraphs) { dt(ctx, p); ctx.y -= 4; }
  if (b.bullets) dbullets(ctx, b.bullets);
  if (b.example) { dh(ctx, 'Worked Example', 3); dmono(ctx, b.example); }
  if (b.diagram) { dh(ctx, 'Diagram', 3); dmono(ctx, b.diagram); }
  if (b.callout) dcallout(ctx, b.callout.type, b.callout.text);
  if (b.subSections) {
    for (const s of b.subSections) {
      dh(ctx, s.heading, 3);
      for (const p of s.paragraphs) { dt(ctx, p); ctx.y -= 3; }
      if (s.bullets) dbullets(ctx, s.bullets);
      if (s.example) dmono(ctx, s.example);
    }
  }
  if (b.quickCheck?.length) {
    dcallout(ctx, 'note', 'Quick Check: ' + b.quickCheck.join(' · '));
  }
  ctx.y -= 8;
  dr(ctx);
}

// ─── Notes DOCX ──────────────────────────────────────────────────────────────

const ACC = '0F4C81', MUT = '6B7280';

function p(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string; spacing?: number } = {}) {
  return new Paragraph({ spacing: { after: opts.spacing ?? 100 }, children: [new TextRun({ text, bold: opts.bold, italics: opts.italic, size: opts.size ? opts.size * 2 : 22, color: opts.color })] });
}

function h(text: string, level: 1 | 2 | 3 = 2) {
  return new Paragraph({ heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, spacing: { before: 240, after: 100 }, children: [new TextRun({ text, bold: true, color: ACC, size: level === 1 ? 36 : level === 2 ? 28 : 24 })] });
}

function bul(text: string) { return new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text, size: 22 })] }); }

function calloutDocx(type: 'note' | 'tip' | 'warning', text: string) {
  const labels = { note: 'NOTE', tip: 'TIP', warning: 'WARNING' };
  const colors = { note: '4285F4', tip: '22C55E', warning: 'F59E0B' };
  const fill = { note: 'EEF2FF', tip: 'F0FDF4', warning: 'FFFBEB' };
  const b = { style: BorderStyle.SINGLE, size: 4, color: colors[type] };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b },
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: fill[type] },
      children: [
        new Paragraph({ children: [new TextRun({ text: labels[type], bold: true, size: 18, color: colors[type] })] }),
        p(text),
      ],
    })] })],
  });
}

function monoDocx(text: string) {
  return new Paragraph({ children: [new TextRun({ text, font: 'Consolas', size: 18 })] });
}

async function blobB64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let s = ''; const C = 0x8000;
  for (let i = 0; i < bytes.length; i += C) s += String.fromCharCode(...bytes.subarray(i, i + C));
  return btoa(s);
}

export async function buildNotesDocx(notes: StudentNotes): Promise<string> {
  const ch: (Paragraph | Table)[] = [];
  ch.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 60 }, children: [new TextRun({ text: 'TEACH ASSIST', bold: true, color: ACC, size: 16 })] }));
  ch.push(new Paragraph({ children: [new TextRun({ text: notes.title, bold: true, size: 44 })] }));
  ch.push(p(`${notes.yearLevel}   ·   Depth: ${notes.depth}`, { color: MUT, size: 10 }));
  if (notes.objectives?.length) { ch.push(h('Learning Objectives', 2)); notes.objectives.forEach((o) => ch.push(bul(o))); }

  for (const block of notes.blocks) {
    ch.push(h(block.heading, 2));
    if (block.paragraphs) block.paragraphs.forEach((pp) => ch.push(p(pp)));
    if (block.bullets) block.bullets.forEach((b_) => ch.push(bul(b_)));
    if (block.example) { ch.push(h('Worked Example', 3)); ch.push(monoDocx(block.example)); }
    if (block.diagram) { ch.push(h('Diagram', 3)); ch.push(monoDocx(block.diagram)); }
    if (block.callout) ch.push(calloutDocx(block.callout.type, block.callout.text));
    if (block.subSections) {
      for (const ss of block.subSections) {
        ch.push(h(ss.heading, 3));
        ss.paragraphs.forEach((pp) => ch.push(p(pp)));
        if (ss.bullets) ss.bullets.forEach((b_) => ch.push(bul(b_)));
        if (ss.example) ch.push(monoDocx(ss.example));
      }
    }
    if (block.quickCheck?.length) ch.push(calloutDocx('note', 'Quick Check: ' + block.quickCheck.join(' · ')));
  }

  if (notes.glossary?.length) {
    ch.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Glossary', bold: true, color: ACC, size: 36 })] }));
    notes.glossary.forEach((g) => {
      ch.push(new Paragraph({ children: [new TextRun({ text: g.term, bold: true, color: ACC, size: 22 })] }));
      ch.push(p(g.definition));
    });
  }

  if (notes.selfCheck?.length) {
    ch.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Self-Check Questions', bold: true, color: ACC, size: 36 })] }));
    notes.selfCheck.forEach((q, i) => ch.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `${i + 1}. ${q}`, size: 22 })] })));
  }

  const docx = new Document({ creator: 'Teach Assist', title: notes.title, sections: [{ children: ch }] });
  return blobB64(await Packer.toBlob(docx));
}

// ─── Notes Markdown ───────────────────────────────────────────────────────────

export function buildNotesMd(notes: StudentNotes): string {
  const lines: string[] = [];
  lines.push(`# ${notes.title}`);
  lines.push(`> **Year:** ${notes.yearLevel}  ·  **Depth:** ${notes.depth}`);
  lines.push('');
  if (notes.objectives?.length) {
    lines.push('## Learning Objectives');
    notes.objectives.forEach((o) => lines.push(`- ${o}`));
    lines.push('');
  }
  for (const block of notes.blocks) {
    lines.push(`## ${block.heading}`);
    if (block.paragraphs) { block.paragraphs.forEach((pp) => { lines.push(pp); lines.push(''); }); }
    if (block.bullets) { block.bullets.forEach((b) => lines.push(`- ${b}`)); lines.push(''); }
    if (block.example) { lines.push('**Worked Example**'); lines.push('```'); lines.push(block.example); lines.push('```'); lines.push(''); }
    if (block.diagram) { lines.push('**Diagram**'); lines.push('```'); lines.push(block.diagram); lines.push('```'); lines.push(''); }
    if (block.callout) { lines.push(`> **${block.callout.type.toUpperCase()}:** ${block.callout.text}`); lines.push(''); }
    if (block.subSections) {
      for (const ss of block.subSections) {
        lines.push(`### ${ss.heading}`);
        ss.paragraphs.forEach((pp) => { lines.push(pp); lines.push(''); });
        if (ss.bullets) { ss.bullets.forEach((b) => lines.push(`- ${b}`)); lines.push(''); }
        if (ss.example) { lines.push('```'); lines.push(ss.example); lines.push('```'); lines.push(''); }
      }
    }
    if (block.quickCheck?.length) {
      lines.push('**Quick Check**');
      block.quickCheck.forEach((q) => lines.push(`- ${q}`));
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }
  if (notes.glossary?.length) {
    lines.push('## Glossary');
    notes.glossary.forEach((g: GlossaryEntry) => lines.push(`**${g.term}** — ${g.definition}`));
    lines.push('');
  }
  if (notes.selfCheck?.length) {
    lines.push('## Self-Check');
    notes.selfCheck.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  }
  return lines.join('\n');
}

export function downloadBase64Pdf(base64: string, filename: string) {
  const a = document.createElement('a');
  a.href = `data:application/pdf;base64,${base64}`;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

export function downloadBase64Docx(base64: string, filename: string) {
  const a = document.createElement('a');
  a.href = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64}`;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

export function downloadText(text: string, filename: string, mimeType = 'text/markdown') {
  const a = document.createElement('a');
  a.href = `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`;
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
