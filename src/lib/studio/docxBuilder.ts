/**
 * DOCX builder for worksheets and structured documents.
 * Produces a base64-encoded .docx for download / Dexie persistence.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} from 'docx';
import type { StructuredDocument, DocBlock } from './documentSchema';
import type { Worksheet, WorksheetTier, Question } from './worksheetSchema';
import { TIER_LABELS } from './worksheetSchema';

const ACCENT = '0F4C81';
const MUTED = '6B7280';

// ─── Shared helpers ──────────────────────────────────────────────────────────

function para(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string; spacing?: number } = {}) {
  return new Paragraph({
    spacing: { after: opts.spacing ?? 120 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        italics: opts.italic,
        size: opts.size ? opts.size * 2 : 22,
        color: opts.color,
      }),
    ],
  });
}

function heading(text: string, level: 1 | 2 | 3 = 2) {
  return new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, color: ACCENT, size: level === 1 ? 36 : level === 2 ? 28 : 24 })],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 22 })],
  });
}

function numbered(text: string, i: number): Paragraph {
  return new Paragraph({
    numbering: { reference: 'default-numbering', level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text: `${i}. ${text}`, size: 22 })],
  });
}

function keyValueTable(pairs: Array<{ key: string; value: string }>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: allBorders('DDDDDD'),
    rows: pairs.map(({ key, value }) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F6FA' },
            children: [para(key, { bold: true, color: ACCENT })],
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            children: [para(value)],
          }),
        ],
      }),
    ),
  });
}

function dataTable(rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: allBorders('CCCCCC'),
    rows: rows.map((row, ri) =>
      new TableRow({
        children: row.map((cell) =>
          new TableCell({
            shading: ri === 0 ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F6FA' } : undefined,
            children: [para(cell, { bold: ri === 0 })],
          }),
        ),
      }),
    ),
  });
}

function allBorders(color: string) {
  const b = { style: BorderStyle.SINGLE, size: 4, color };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
}

function calloutTable(label: string, text: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: allBorders(ACCENT),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F6FA' },
            children: [
              para(label.toUpperCase(), { bold: true, color: ACCENT, size: 9 }),
              para(text, { spacing: 0 }),
            ],
          }),
        ],
      }),
    ],
  });
}

function titleBlock(title: string, subtitle?: string, meta?: Array<{ label: string; value: string }>): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 60 },
    children: [new TextRun({ text: 'TEACH ASSIST', bold: true, color: ACCENT, size: 16 })],
  }));
  out.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 120 },
    children: [new TextRun({ text: title, bold: true, size: 44 })],
  }));
  if (subtitle) {
    out.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: subtitle, italics: true, color: MUTED, size: 24 })],
    }));
  }
  if (meta && meta.length) {
    out.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({
        text: meta.map((m) => `${m.label}: ${m.value}`).join('   ·   '),
        color: MUTED, size: 18,
      })],
    }));
  }
  return out;
}

// ─── Document builder ────────────────────────────────────────────────────────

export async function buildDocumentDocx(doc: StructuredDocument): Promise<string> {
  const children: (Paragraph | Table)[] = [];
  const meta: Array<{ label: string; value: string }> = [];
  if (doc.meta.yearLevel) meta.push({ label: 'Year', value: doc.meta.yearLevel });
  if (doc.meta.durationMin) meta.push({ label: 'Duration', value: `${doc.meta.durationMin} min` });
  if (doc.meta.curriculumStandard) meta.push({ label: 'Curriculum', value: doc.meta.curriculumStandard });
  if (doc.meta.topic) meta.push({ label: 'Topic', value: doc.meta.topic });
  if (doc.meta.teacherName) meta.push({ label: 'Teacher', value: doc.meta.teacherName });
  if (doc.meta.schoolName) meta.push({ label: 'School', value: doc.meta.schoolName });
  if (doc.meta.date) meta.push({ label: 'Date', value: doc.meta.date });

  children.push(...titleBlock(doc.title, doc.subtitle, meta));

  for (const block of doc.blocks) {
    children.push(...renderBlock(block));
  }

  const docxFile = new Document({
    creator: 'Teach Assist',
    title: doc.title,
    subject: doc.meta.topic,
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(docxFile);
  return await blobToBase64(blob);
}

function renderBlock(b: DocBlock): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  if (b.heading) out.push(heading(b.heading, 2));
  if (b.paragraphs) for (const p of b.paragraphs) out.push(para(p));
  if (b.bullets) out.push(...b.bullets.map((t) => bullet(t)));
  if (b.numbered) out.push(...b.numbered.map((t, i) => numbered(t, i + 1)));
  if (b.table) out.push(dataTable(b.table), para(''));
  if (b.keyValue) out.push(keyValueTable(b.keyValue), para(''));
  if (b.callout) out.push(calloutTable(b.callout.label, b.callout.text), para(''));
  return out;
}

// ─── Worksheet builder ───────────────────────────────────────────────────────

export async function buildWorksheetDocx(
  ws: Worksheet,
  opts: { includeAnswerKey: boolean } = { includeAnswerKey: true },
): Promise<string> {
  const children: (Paragraph | Table)[] = [];
  const meta: Array<{ label: string; value: string }> = [];
  if (ws.yearLevel) meta.push({ label: 'Year', value: ws.yearLevel });
  if (ws.estimatedTimeMin) meta.push({ label: 'Time', value: `${ws.estimatedTimeMin} min` });
  if (ws.curriculumStandard) meta.push({ label: 'Standard', value: ws.curriculumStandard });
  if (ws.bloomOverall) meta.push({ label: "Bloom's", value: ws.bloomOverall });

  children.push(...titleBlock(ws.title, ws.topic, meta));
  children.push(para('Name: ______________________________      Date: _______________'));
  children.push(para(''));

  ws.tiers.forEach((tier) => {
    children.push(...renderWorksheetTier(tier, false));
  });

  if (opts.includeAnswerKey) {
    children.push(new Paragraph({
      pageBreakBefore: true,
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Answer Key', bold: true, color: ACCENT, size: 36 })],
    }));
    ws.tiers.forEach((tier) => {
      children.push(heading(`${TIER_LABELS[tier.tier]} — answers`, 3));
      tier.questions.forEach((q, i) => {
        const parts: string[] = [];
        if (q.answer) parts.push(q.answer);
        if (q.blanks?.length) parts.push(q.blanks.join(' / '));
        if (q.sequence) parts.push(q.sequence.join(' → '));
        if (q.pairs) parts.push(q.pairs.map((p) => `${p.left} ↔ ${p.right}`).join('; '));
        if (q.workedSolution) parts.push(q.workedSolution);
        if (q.labels) parts.push(q.labels.join(', '));
        children.push(para(`${i + 1}. ${parts.join(' | ') || '(see rubric)'}`));
        if (q.explanation) children.push(para(q.explanation, { italic: true, color: MUTED, size: 10 }));
      });
    });
  }

  const docxFile = new Document({
    creator: 'Teach Assist',
    title: ws.title,
    subject: ws.topic,
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(docxFile);
  return await blobToBase64(blob);
}

function renderWorksheetTier(tier: WorksheetTier, isKey: boolean): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  out.push(new Paragraph({
    pageBreakBefore: true,
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: TIER_LABELS[tier.tier], bold: true, color: ACCENT, size: 36 })],
  }));
  if (tier.readingLevelNote) out.push(para(tier.readingLevelNote, { italic: true, color: MUTED }));
  if (tier.instructions) out.push(calloutTable('Instructions', tier.instructions), para(''));
  tier.questions.forEach((q, i) => {
    out.push(...renderQuestion(q, i + 1, isKey));
  });
  return out;
}

function renderQuestion(q: Question, num: number, showAnswer: boolean): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const marks = q.marks ? `  [${q.marks} mark${q.marks === 1 ? '' : 's'}]` : '';
  const tag = q.bloom ? `  (${q.bloom})` : '';
  out.push(new Paragraph({
    spacing: { before: 160, after: 80 },
    children: [
      new TextRun({ text: `${num}.  `, bold: true, color: ACCENT, size: 22 }),
      new TextRun({ text: `${q.prompt}${marks}${tag}`, size: 22 }),
    ],
  }));

  switch (q.type) {
    case 'multiple_choice':
      q.choices?.forEach((c) => {
        out.push(new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: `   ☐  ${c.id}.  ${c.text}`, size: 22 })],
        }));
      });
      break;
    case 'true_false':
      out.push(para('   ☐ True       ☐ False'));
      break;
    case 'fill_blank': {
      const filled = q.prompt.replace(/\{\{\d+\}\}/g, '__________');
      out.push(para(filled, { color: MUTED }));
      break;
    }
    case 'matching':
      if (q.pairs) {
        const rows = q.pairs.map((p, i) => [`${i + 1}. ${p.left}`, '____', `${String.fromCharCode(65 + i)}. ${p.right}`]);
        out.push(dataTable([['Item', 'Match', 'Option'], ...rows]), para(''));
      }
      break;
    case 'ordering':
      if (q.sequence) {
        const scrambled = [...q.sequence].sort(() => Math.random() - 0.5);
        out.push(para('Put in order (write the number in each blank):', { italic: true, color: MUTED }));
        scrambled.forEach((item) => out.push(para(`___  ${item}`)));
      }
      break;
    case 'label_diagram':
      if (q.diagramDescription) {
        out.push(new Paragraph({
          children: [new TextRun({ text: q.diagramDescription, font: 'Consolas', size: 18 })],
        }));
      }
      if (q.labels) out.push(para(`Labels to use: ${q.labels.join(', ')}`, { italic: true, color: MUTED }));
      break;
    case 'code_trace':
      if (q.code) {
        q.code.split('\n').forEach((ln) => out.push(new Paragraph({
          children: [new TextRun({ text: ln || ' ', font: 'Consolas', size: 18 })],
        })));
      }
      out.push(para('Expected output:'));
      out.push(para('__________________________________________________________'));
      out.push(para('__________________________________________________________'));
      break;
    case 'worked_example':
      out.push(para('Show your working:'));
      for (let i = 0; i < 5; i++) out.push(para('__________________________________________________________'));
      break;
    case 'short_answer':
      out.push(para('__________________________________________________________'));
      out.push(para('__________________________________________________________'));
      break;
    case 'long_answer':
      for (let i = 0; i < 6; i++) out.push(para('__________________________________________________________'));
      break;
  }

  if (showAnswer && q.answer) {
    out.push(para(`Answer: ${q.answer}`, { italic: true, color: ACCENT }));
  }
  return out;
}

// ─── base64 helper / download ────────────────────────────────────────────────

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function downloadBase64Docx(base64: string, filename: string) {
  const link = document.createElement('a');
  link.href = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64}`;
  link.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
