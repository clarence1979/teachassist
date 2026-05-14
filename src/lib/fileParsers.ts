import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import mammoth from 'mammoth';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

// ─── Supported types ─────────────────────────────────────────────────────────

export const TEXT_EXTRACT_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'application/json',
]);

export const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

// ─── Parsers ─────────────────────────────────────────────────────────────────

export async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const chunks: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? (item.str as string) : ''))
      .join(' ');
    chunks.push(`\n\n— Page ${i} —\n${text}`);
  }
  return chunks.join('').trim();
}

export async function extractDocxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value.trim();
}

export async function extractPlainText(file: File): Promise<string> {
  return (await file.text()).trim();
}

export async function fileToBase64(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * The Anthropic API validates the base64-encoded size of images against a
 * 5 MB ceiling. Base64 inflates raw bytes by ~4/3, so raw must be below ~3.75 MB.
 * We target 3.6 MB to leave a safety margin.
 */
const MAX_IMAGE_RAW_BYTES = 3.6 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 2048;

export async function compressImageIfLarge(file: File): Promise<{ blob: Blob; mediaType: string }> {
  if (file.size <= MAX_IMAGE_RAW_BYTES && file.type !== 'image/webp') {
    return { blob: file, mediaType: file.type };
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { blob: file, mediaType: file.type };

  let width = bitmap.width;
  let height = bitmap.height;
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const qualities = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25];
  for (const q of qualities) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', q),
    );
    if (blob && blob.size <= MAX_IMAGE_RAW_BYTES) {
      bitmap.close?.();
      return { blob, mediaType: 'image/jpeg' };
    }
    // Still too big → shrink dimensions for next pass
    width = Math.max(320, Math.round(width * 0.8));
    height = Math.max(240, Math.round(height * 0.8));
  }

  bitmap.close?.();
  return { blob: file, mediaType: file.type };
}

/**
 * Extracted text from files can also blow past provider input limits. We keep
 * the head + a marker rather than silently truncating to zero so the model
 * still sees the start of the document.
 */
const MAX_TEXT_CHARS = 120_000;

export function capText(text: string, maxChars = MAX_TEXT_CHARS): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const dropped = text.length - maxChars;
  return `${head}\n\n…[truncated ${dropped.toLocaleString()} characters to fit the model's context window]`;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface ParsedFile {
  kind: 'image' | 'file';
  name: string;
  mediaType: string;
  size: number;
  /** base64 for images, extracted text for files */
  data: string;
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name;
  const size = file.size;
  const lower = name.toLowerCase();
  const type = file.type || guessType(lower);

  if (IMAGE_MIME.has(type)) {
    const { blob, mediaType } = await compressImageIfLarge(file);
    const data = await fileToBase64(blob);
    return { kind: 'image', name, mediaType, size: blob.size, data };
  }

  let text = '';
  if (type === 'application/pdf' || lower.endsWith('.pdf')) {
    text = await extractPdfText(file);
  } else if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    text = await extractDocxText(file);
  } else if (
    type.startsWith('text/') ||
    lower.endsWith('.md') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.json')
  ) {
    text = await extractPlainText(file);
  } else {
    throw new Error(`Unsupported file type: ${type || name}`);
  }

  const capped = capText(text);
  return { kind: 'file', name, mediaType: type || 'text/plain', size, data: capped };
}

function guessType(lowerName: string): string {
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lowerName.endsWith('.md')) return 'text/markdown';
  if (lowerName.endsWith('.txt')) return 'text/plain';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  return '';
}
