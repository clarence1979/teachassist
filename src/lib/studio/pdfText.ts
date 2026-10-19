import type { PDFFont } from 'pdf-lib';

export function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
}

export function breakLongWord(word: string, font: PDFFont, size: number, maxW: number): string[] {
  if (font.widthOfTextAtSize(word, size) <= maxW) return [word];
  const parts: string[] = [];
  let cur = '';
  for (const ch of Array.from(word)) {
    if (cur && font.widthOfTextAtSize(cur + ch, size) > maxW) {
      parts.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Word-wraps to maxW, honouring explicit newlines and hard-breaking over-long words. */
export function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of normalizeWhitespace(text).trim().split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      for (const piece of breakLongWord(word, font, size, maxW)) {
        const test = line ? `${line} ${piece}` : piece;
        if (line && font.widthOfTextAtSize(test, size) > maxW) {
          lines.push(line);
          line = piece;
        } else {
          line = test;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}
