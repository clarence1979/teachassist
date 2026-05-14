import { PDFDocument, rgb, type PDFPage, type PDFFont, type Color } from 'pdf-lib';
import type { SlideDeck, SlideSpec } from './slideSchema';
import type { SlideTheme } from './slideThemes';
import { winAnsiSafe } from './winAnsi';
import { embedUnicodeFonts } from './unicodeFonts';

/**
 * Build a landscape PDF (16:9) that mirrors the PowerPoint deck visually.
 * Returns base64 for storage / download.
 */

const PAGE_W = 960;   // points — 16:9 landscape
const PAGE_H = 540;
const MARGIN = 40;

function hexToColor(hex: string): Color {
  const clean = hex.replace('#', '');
  const h = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return rgb(
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0,
  );
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function sanitize(s: string): string {
  return winAnsiSafe(s);
}

export async function buildSlidesPdf(deck: SlideDeck, theme: SlideTheme): Promise<string> {
  const pdf = await PDFDocument.create();
  const { regular: font, bold, mono } = await embedUnicodeFonts(pdf);

  const bg = hexToColor(theme.background);
  const titleBg = hexToColor(theme.titleBackground);
  const textPrimary = hexToColor(theme.textPrimary);
  const textSecondary = hexToColor(theme.textSecondary);
  const accent = hexToColor(theme.accent);

  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const isTitle = slide.layout === 'title' || i === 0;
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: isTitle ? titleBg : bg });

    if (isTitle) {
      drawTitleSlide(page, slide, deck, { font, bold, textPrimary, textSecondary, accent });
    } else {
      await drawContentSlide(pdf, page, slide, i, deck.slides.length, deck.title, {
        font, bold, mono, textPrimary, textSecondary, accent,
      });
    }
  }

  const bytes = await pdf.save();
  return uint8ToBase64(bytes);
}

interface BaseStyle {
  font: PDFFont;
  bold: PDFFont;
  textPrimary: Color;
  textSecondary: Color;
  accent: Color;
}

function drawTitleSlide(
  page: PDFPage,
  slide: SlideSpec,
  deck: SlideDeck,
  st: BaseStyle,
) {
  const title = sanitize(slide.title || deck.title);
  const subtitle = sanitize(slide.bullets?.join('  ·  ') || deck.subtitle || deck.topic || '');

  // Accent bar
  page.drawRectangle({ x: MARGIN, y: PAGE_H / 2 + 40, width: 60, height: 4, color: st.accent });

  const titleLines = wrap(title, st.bold, 38, PAGE_W - MARGIN * 2);
  titleLines.forEach((ln, i) => {
    page.drawText(ln, {
      x: MARGIN,
      y: PAGE_H / 2 - i * 44,
      size: 38,
      font: st.bold,
      color: st.textPrimary,
    });
  });

  if (subtitle) {
    const subLines = wrap(subtitle, st.font, 16, PAGE_W - MARGIN * 2);
    subLines.slice(0, 3).forEach((ln, i) => {
      page.drawText(ln, {
        x: MARGIN,
        y: PAGE_H / 2 - titleLines.length * 44 - 20 - i * 20,
        size: 16,
        font: st.font,
        color: st.textSecondary,
      });
    });
  }
}

async function drawContentSlide(
  pdf: PDFDocument,
  page: PDFPage,
  slide: SlideSpec,
  index: number,
  total: number,
  deckTitle: string,
  st: BaseStyle & { mono: PDFFont },
) {
  // Prefer the rasterised structured graphic when available (tables,
  // flowcharts, box method, comparisons). Otherwise fall back to the
  // Pexels/OpenAI image on decorative/plain slides.
  const sideImageB64 = slide.structuredImageBase64 ?? slide.imageBase64;
  const hasImage = !!sideImageB64;
  // Structured graphics (tables / flowcharts / box method) need more room
  // than a photo — bullets take a narrower left column so the diagram is
  // legible at ~60% of the slide, matching the PPTX proportion.
  const structuredMode = !!slide.structuredImageBase64;
  const bulletColW = structuredMode
    ? (PAGE_W - MARGIN * 2) * 0.38
    : hasImage ? (PAGE_W - MARGIN * 3) / 2 : PAGE_W - MARGIN * 2;
  const bodyMaxW = bulletColW;

  // Title
  const title = sanitize(slide.title);
  const titleLines = wrap(title, st.bold, 26, PAGE_W - MARGIN * 2);
  let y = PAGE_H - MARGIN;
  titleLines.forEach((ln) => {
    y -= 30;
    page.drawText(ln, { x: MARGIN, y, size: 26, font: st.bold, color: st.textPrimary });
  });
  // Accent underline
  page.drawLine({
    start: { x: MARGIN, y: y - 8 },
    end: { x: MARGIN + 40, y: y - 8 },
    thickness: 2,
    color: st.accent,
  });
  y -= 28;

  // Bullets
  const bulletSize = 14;
  const lineGap = 8;
  for (const bullet of slide.bullets) {
    const text = sanitize(bullet);
    const lines = wrap(text, st.font, bulletSize, bodyMaxW - 18);
    // Square marker
    page.drawRectangle({
      x: MARGIN, y: y - bulletSize + 2, width: 6, height: 6, color: st.accent,
    });
    lines.forEach((ln, i) => {
      if (y < MARGIN + 20) return;
      page.drawText(ln, {
        x: MARGIN + 16, y: y - bulletSize, size: bulletSize, font: st.font, color: st.textPrimary,
      });
      if (i < lines.length - 1) y -= bulletSize + 4;
    });
    y -= bulletSize + lineGap + 4;
  }

  // Image on right
  if (hasImage && sideImageB64) {
    try {
      const bytes = base64ToUint8(sideImageB64);
      let img;
      try { img = await pdf.embedPng(bytes); } catch { img = await pdf.embedJpg(bytes); }
      let boxX: number, boxY: number, boxW: number, boxH: number;
      if (structuredMode) {
        // Structured graphics take ~60% of page width and most of the
        // vertical space below the title so tables and flowcharts are
        // easy to read.
        boxX = MARGIN + bulletColW + 20;
        boxY = MARGIN + 30;
        boxW = PAGE_W - boxX - MARGIN;
        boxH = PAGE_H - MARGIN * 2 - 30;
      } else {
        boxX = PAGE_W / 2 + MARGIN / 2;
        boxY = MARGIN + 40;
        boxW = PAGE_W / 2 - MARGIN - MARGIN / 2;
        boxH = PAGE_H - MARGIN * 2 - 40;
      }
      const scale = Math.min(boxW / img.width, boxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = boxX + (boxW - w) / 2;
      const yImg = boxY + (boxH - h) / 2;
      page.drawImage(img, { x, y: yImg, width: w, height: h });
    } catch {
      // skip corrupted image
    }
  }

  // Footer: slide number + deck title
  const footerY = 18;
  const right = `${index + 1} / ${total}`;
  const rw = st.mono.widthOfTextAtSize(right, 9);
  page.drawText(right, { x: PAGE_W - MARGIN - rw, y: footerY, size: 9, font: st.mono, color: st.textSecondary });
  page.drawText(sanitize(deckTitle.toUpperCase()), {
    x: MARGIN, y: footerY, size: 8, font: st.mono, color: st.textSecondary,
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
