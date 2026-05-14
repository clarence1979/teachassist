import { createEvents, type EventAttributes, type DateArray } from 'ics';
import { PDFDocument, rgb } from 'pdf-lib';
import type { BlockOccurrence } from './recurrence';
import { parseLocal, fmtTime, isoDate } from './dates';
import { winAnsiSafe } from '../studio/winAnsi';
import { embedUnicodeFonts } from '../studio/unicodeFonts';

function toDateArray(iso: string): DateArray {
  const d = parseLocal(iso);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
}

/** Build an iCal (.ics) string from occurrences. */
export function buildICS(occurrences: BlockOccurrence[]): string {
  const events: EventAttributes[] = occurrences.map((o) => ({
    start: toDateArray(o.startISO),
    end: toDateArray(o.endISO),
    title: o.block.title,
    description: o.block.notes ?? '',
    location: o.block.location ?? '',
    calName: 'Pedagogy Timetable',
    categories: [o.block.type],
    status: o.block.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
  }));
  const { error, value } = createEvents(events);
  if (error) throw error;
  return value ?? '';
}

export function downloadBlob(data: string | Blob, filename: string, mime = 'text/plain'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a CSV summary of occurrences. */
export function buildCSV(occurrences: BlockOccurrence[]): string {
  const rows = [
    ['Date', 'Start', 'End', 'Title', 'Type', 'Location', 'Notes'],
    ...occurrences.map((o) => [
      isoDate(parseLocal(o.startISO)),
      fmtTime(o.startISO),
      fmtTime(o.endISO),
      o.block.title,
      o.block.type,
      o.block.location ?? '',
      o.block.notes ?? '',
    ]),
  ];
  return rows.map((r) => r.map((c) => csvEscape(String(c))).join(',')).join('\n');
}

/** Build a simple PDF weekly agenda. */
export async function buildPDF(occurrences: BlockOccurrence[], title = 'Timetable'): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const { regular: font, bold } = await embedUnicodeFonts(pdf);

  const grouped = new Map<string, BlockOccurrence[]>();
  for (const o of occurrences) {
    const k = isoDate(parseLocal(o.startISO));
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(o);
  }
  const days = [...grouped.keys()].sort();

  let page = pdf.addPage([595, 842]); // A4
  let y = 800;
  const drawText = (text: string, opts: { x?: number; size?: number; bold?: boolean; color?: [number, number, number] } = {}) => {
    const size = opts.size ?? 10;
    if (y < 40) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawText(winAnsiSafe(text), {
      x: opts.x ?? 40,
      y,
      size,
      font: opts.bold ? bold : font,
      color: rgb(...(opts.color ?? [0.1, 0.1, 0.15] as [number, number, number])),
    });
    y -= size + 4;
  };

  drawText(title, { size: 18, bold: true });
  drawText(`Generated ${new Date().toLocaleString('en-AU')}`, { size: 9, color: [0.4, 0.4, 0.5] });
  y -= 8;

  for (const day of days) {
    const d = parseLocal(`${day}T00:00:00`);
    drawText(d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), { size: 12, bold: true, color: [0.1, 0.25, 0.5] });
    for (const occ of grouped.get(day)!) {
      drawText(`  ${fmtTime(occ.startISO)}–${fmtTime(occ.endISO)}  ${occ.block.title}  [${occ.block.type}]`, { size: 10 });
      if (occ.block.location) drawText(`     @ ${occ.block.location}`, { size: 9, color: [0.4, 0.4, 0.5] });
    }
    y -= 4;
  }

  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
