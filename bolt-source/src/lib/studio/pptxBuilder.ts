import PptxGenJS from 'pptxgenjs';
import type { SlideDeck, SlideSpec, SlideStructured } from './slideSchema';
import type { SlideTheme } from './slideThemes';

/**
 * Build a PowerPoint file from a parsed deck using the given theme.
 * Returns a base64 string of the .pptx contents (suitable for Dexie storage
 * and for triggering a download via <a href="data:...">).
 */
export async function buildPptx(deck: SlideDeck, theme: SlideTheme): Promise<string> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches
  pptx.title = deck.title;
  pptx.author = 'Teach Assist';
  pptx.subject = deck.topic;

  // Slide width / height in inches (widescreen)
  const W = 13.33;
  const H = 7.5;

  deck.slides.forEach((slide, i) => {
    const s = pptx.addSlide();
    const isTitle = slide.layout === 'title' || i === 0;
    s.background = { color: isTitle ? theme.titleBackground : theme.background };

    // Speaker notes
    if (slide.speakerNotes) s.addNotes(slide.speakerNotes);

    // Slide number + footer (skip for title)
    if (!isTitle && i !== 0) {
      s.addText(`${i + 1} / ${deck.slides.length}`, {
        x: W - 1.2, y: H - 0.4, w: 1, h: 0.3,
        fontFace: theme.fontMono,
        fontSize: 9,
        color: theme.textSecondary,
        align: 'right',
      });
      s.addText(deck.title.toUpperCase(), {
        x: 0.5, y: H - 0.4, w: W - 2, h: 0.3,
        fontFace: theme.fontMono,
        fontSize: 8,
        color: theme.textSecondary,
        charSpacing: 3,
      });
    }

    if (isTitle) {
      renderTitleSlide(s, slide, deck, theme, W, H, i);
    } else {
      renderContentSlide(s, slide, theme, W, H);
    }
  });

  const result = await pptx.write({ outputType: 'base64' });
  return typeof result === 'string' ? result : String(result);
}

// ─── Slide renderers ──────────────────────────────────────────────────────────

function renderTitleSlide(
  s: PptxGenJS.Slide,
  slide: SlideSpec,
  deck: SlideDeck,
  t: SlideTheme,
  W: number,
  H: number,
  index: number,
) {
  // Decorative rule on the left
  s.addShape('rect', {
    x: 0.5, y: H / 2 - 0.02, w: 1.2, h: 0.04,
    fill: { color: t.accent },
    line: { color: t.accent, width: 0 },
  });

  // Accent label (year level / topic)
  if (index === 0 && deck.yearLevel) {
    s.addText(deck.yearLevel.toUpperCase(), {
      x: 0.5, y: 0.6, w: W - 1, h: 0.4,
      fontFace: t.fontMono,
      fontSize: 12,
      color: t.accent,
      charSpacing: 6,
      bold: true,
    });
  }

  // Title
  s.addText(slide.title, {
    x: 0.5, y: H / 2 + 0.2, w: W - 1, h: 1.6,
    fontFace: t.fontHeading,
    fontSize: 44,
    bold: true,
    color: t.textPrimary,
    valign: 'top',
  });

  // Subtitle (first bullet or deck subtitle)
  const subtitle = slide.bullets[0] ?? deck.subtitle;
  if (subtitle) {
    s.addText(subtitle, {
      x: 0.5, y: H / 2 + 2, w: W - 1, h: 1,
      fontFace: t.fontBody,
      fontSize: 18,
      color: t.textSecondary,
      valign: 'top',
    });
  }

  // Footer label
  s.addText('TEACH ASSIST', {
    x: 0.5, y: H - 0.5, w: 4, h: 0.3,
    fontFace: t.fontMono,
    fontSize: 8,
    color: t.accentSecondary,
    charSpacing: 4,
  });
}

function renderContentSlide(
  s: PptxGenJS.Slide,
  slide: SlideSpec,
  t: SlideTheme,
  W: number,
  H: number,
) {
  const startX = 0.5;

  // Title
  s.addText(slide.title, {
    x: startX, y: 0.5, w: W - 1, h: 0.7,
    fontFace: t.fontHeading,
    fontSize: 26,
    bold: true,
    color: t.textPrimary,
    valign: 'top',
  });

  // Rule under title
  s.addShape('rect', {
    x: startX, y: 1.15, w: 0.6, h: 0.04,
    fill: { color: t.rule },
    line: { color: t.rule, width: 0 },
  });

  // When the slide has native structured content (table / process / comparison /
  // box method), render it and keep bullets narrow on the left. We NEVER embed
  // an AI-generated image alongside structured content.
  if (slide.structured) {
    renderStructuredWithBullets(s, slide, t, W, H, startX);
    return;
  }

  // Any non-structured slide with an image (decorative hero or plain bullets
  // with a Pexels / OpenAI photo) uses the two-column layout.
  const hasImage = !!slide.imageBase64;
  const bulletWidth = hasImage ? W / 2 - 0.9 : W - 1;

  const bulletItems = slide.bullets.map((b) => ({
    text: b,
    options: { bullet: { code: '25A0' }, color: t.textPrimary, fontSize: 16, fontFace: t.fontBody },
  }));

  if (bulletItems.length > 0) {
    s.addText(bulletItems, {
      x: startX, y: 1.5, w: bulletWidth, h: H - 2.2,
      valign: 'top',
      paraSpaceAfter: 8,
      lineSpacingMultiple: 1.3,
      bullet: { code: '25A0' },
      color: t.textPrimary,
      fontFace: t.fontBody,
      fontSize: 16,
    });
  }

  if (hasImage) {
    const imgX = W / 2 + 0.2;
    const imgY = 1.5;
    const imgW = W - imgX - 0.5;
    const imgH = H - 2.2;
    s.addImage({
      data: `data:image/png;base64,${slide.imageBase64}`,
      x: imgX, y: imgY, w: imgW, h: imgH,
      sizing: { type: 'contain', w: imgW, h: imgH },
    });
  }
}

// ─── Structured renderers ─────────────────────────────────────────────────────

function renderStructuredWithBullets(
  s: PptxGenJS.Slide,
  slide: SlideSpec,
  t: SlideTheme,
  W: number,
  H: number,
  startX: number,
) {
  const struct = slide.structured!;
  const bulletBandWidth = slide.bullets.length > 0 ? 3.8 : 0;
  const visualLeft = startX + bulletBandWidth + (bulletBandWidth > 0 ? 0.3 : 0);
  const visualWidth = W - visualLeft - 0.5;
  const visualTop = 1.5;
  const visualHeight = H - 2.2;

  // Bullets column (left)
  if (bulletBandWidth > 0) {
    const bulletItems = slide.bullets.map((b) => ({
      text: b,
      options: { bullet: { code: '25A0' }, color: t.textPrimary, fontSize: 14, fontFace: t.fontBody },
    }));
    s.addText(bulletItems, {
      x: startX, y: visualTop, w: bulletBandWidth, h: visualHeight,
      valign: 'top',
      paraSpaceAfter: 6,
      lineSpacingMultiple: 1.3,
      bullet: { code: '25A0' },
      color: t.textPrimary,
      fontFace: t.fontBody,
      fontSize: 14,
    });
  }

  renderStructured(s, slide, struct, t, visualLeft, visualTop, visualWidth, visualHeight);
}

function renderStructured(
  s: PptxGenJS.Slide,
  slide: SlideSpec,
  struct: SlideStructured,
  t: SlideTheme,
  x: number, y: number, w: number, h: number,
) {
  switch (struct.kind) {
    case 'table': return renderTable(s, struct, t, x, y, w, h);
    case 'process': return renderProcess(s, struct, t, x, y, w, h);
    case 'comparison': return renderComparison(s, struct, t, x, y, w, h);
    case 'boxMethod': return renderBoxMethod(s, struct, t, x, y, w, h);
    case 'formula':
      if (slide.structuredImageBase64) {
        s.addImage({
          data: `data:image/png;base64,${slide.structuredImageBase64}`,
          x, y, w, h,
          sizing: { type: 'contain', w, h },
        });
      }
      return;
  }
}

function renderTable(
  s: PptxGenJS.Slide,
  struct: Extract<SlideStructured, { kind: 'table' }>,
  t: SlideTheme,
  x: number, y: number, w: number, h: number,
) {
  const { headers, rows, rowLabels, summary, caption } = struct;
  let cursorY = y;

  if (caption) {
    s.addText(caption, {
      x, y: cursorY, w, h: 0.35,
      fontFace: t.fontBody, fontSize: 13, italic: true, color: t.textSecondary,
    });
    cursorY += 0.4;
  }

  const hasLabelCol = !!rowLabels && rowLabels.length === rows.length;
  const labelColWidth = hasLabelCol ? 1.4 : 0;
  const tableX = x + labelColWidth;
  const tableW = w - labelColWidth;

  const tableRows: PptxGenJS.TableRow[] = [];
  tableRows.push(headers.map((h) => ({
    text: h,
    options: {
      bold: true, align: 'center' as const, valign: 'middle' as const,
      fill: { color: t.accent }, color: 'FFFFFF',
      fontFace: t.fontHeading, fontSize: 14,
    },
  })));
  rows.forEach((row, ri) => {
    tableRows.push(row.map((cell) => ({
      text: cell,
      options: {
        align: 'center' as const, valign: 'middle' as const,
        fill: { color: ri % 2 === 0 ? shade(t.background, 0.08) : shade(t.background, 0.16) },
        color: t.textPrimary,
        fontFace: t.fontMono, fontSize: 13,
      },
    })));
  });

  const tableHeight = Math.min(h - (cursorY - y) - (summary ? 0.8 : 0.2), 0.55 * (rows.length + 1) + 0.4);
  const colW = tableW / headers.length;
  s.addTable(tableRows, {
    x: tableX, y: cursorY, w: tableW, h: tableHeight,
    colW: new Array(headers.length).fill(colW),
    border: { type: 'solid', pt: 0.5, color: t.accent },
    fontFace: t.fontBody,
  });

  if (hasLabelCol) {
    const rowH = tableHeight / (rows.length + 1);
    rowLabels!.forEach((label, i) => {
      s.addText(label, {
        x, y: cursorY + rowH * (i + 1), w: labelColWidth - 0.1, h: rowH,
        align: 'right', valign: 'middle',
        fontFace: t.fontMono, fontSize: 12, color: t.textSecondary,
      });
    });
  }

  if (summary) {
    s.addText(summary, {
      x, y: y + h - 0.6, w, h: 0.5,
      align: 'center', valign: 'middle',
      fontFace: t.fontMono, fontSize: 16, bold: true, color: t.accent,
    });
  }
}

function renderProcess(
  s: PptxGenJS.Slide,
  struct: Extract<SlideStructured, { kind: 'process' }>,
  t: SlideTheme,
  x: number, y: number, w: number, h: number,
) {
  const { steps, orientation = 'horizontal' } = struct;
  const n = steps.length;
  if (n === 0) return;

  if (orientation === 'vertical') {
    const gap = 0.18;
    const boxH = Math.min(0.9, (h - gap * (n - 1)) / n);
    const boxW = Math.min(w, 5);
    const centerX = x + (w - boxW) / 2;
    steps.forEach((step, i) => {
      const by = y + i * (boxH + gap);
      drawStepBox(s, t, centerX, by, boxW, boxH, `${i + 1}. ${step}`);
      if (i < n - 1) {
        s.addShape('downArrow', {
          x: centerX + boxW / 2 - 0.12, y: by + boxH, w: 0.24, h: gap,
          fill: { color: t.accent }, line: { color: t.accent, width: 0 },
        });
      }
    });
    return;
  }

  const gap = 0.2;
  const boxW = Math.max(1.2, (w - gap * (n - 1)) / n);
  const boxH = Math.min(h, 1.6);
  const rowY = y + (h - boxH) / 2;
  steps.forEach((step, i) => {
    const bx = x + i * (boxW + gap);
    drawStepBox(s, t, bx, rowY, boxW, boxH, `${i + 1}. ${step}`);
    if (i < n - 1) {
      s.addShape('rightArrow', {
        x: bx + boxW, y: rowY + boxH / 2 - 0.1, w: gap, h: 0.2,
        fill: { color: t.accent }, line: { color: t.accent, width: 0 },
      });
    }
  });
}

function drawStepBox(
  s: PptxGenJS.Slide, t: SlideTheme,
  x: number, y: number, w: number, h: number, text: string,
) {
  s.addShape('roundRect', {
    x, y, w, h,
    fill: { color: shade(t.background, 0.12) },
    line: { color: t.accent, width: 1.25 },
    rectRadius: 0.08,
  });
  s.addText(text, {
    x: x + 0.1, y, w: w - 0.2, h,
    align: 'center', valign: 'middle',
    fontFace: t.fontBody, fontSize: 13, bold: true, color: t.textPrimary,
  });
}

function renderComparison(
  s: PptxGenJS.Slide,
  struct: Extract<SlideStructured, { kind: 'comparison' }>,
  t: SlideTheme,
  x: number, y: number, w: number, h: number,
) {
  const gap = 0.25;
  const colW = (w - gap) / 2;
  const headerH = 0.55;
  drawComparisonColumn(s, t, x, y, colW, h, headerH, struct.leftTitle, struct.leftPoints, t.accent);
  drawComparisonColumn(s, t, x + colW + gap, y, colW, h, headerH, struct.rightTitle, struct.rightPoints, t.accentSecondary);
}

function drawComparisonColumn(
  s: PptxGenJS.Slide, t: SlideTheme,
  x: number, y: number, w: number, h: number, headerH: number,
  title: string, points: string[], accent: string,
) {
  s.addShape('rect', {
    x, y, w, h: headerH,
    fill: { color: accent }, line: { color: accent, width: 0 },
  });
  s.addText(title, {
    x, y, w, h: headerH,
    align: 'center', valign: 'middle', bold: true,
    fontFace: t.fontHeading, fontSize: 16, color: 'FFFFFF',
  });
  s.addShape('rect', {
    x, y: y + headerH, w, h: h - headerH,
    fill: { color: shade(t.background, 0.1) },
    line: { color: accent, width: 0.75 },
  });
  const items = points.map((p) => ({
    text: p,
    options: { bullet: { code: '25B8' }, color: t.textPrimary, fontSize: 13, fontFace: t.fontBody },
  }));
  if (items.length > 0) {
    s.addText(items, {
      x: x + 0.2, y: y + headerH + 0.15, w: w - 0.4, h: h - headerH - 0.3,
      valign: 'top', paraSpaceAfter: 6, lineSpacingMultiple: 1.3,
      bullet: { code: '25B8' },
      color: t.textPrimary, fontFace: t.fontBody, fontSize: 13,
    });
  }
}

function renderBoxMethod(
  s: PptxGenJS.Slide,
  struct: Extract<SlideStructured, { kind: 'boxMethod' }>,
  t: SlideTheme,
  x: number, y: number, w: number, h: number,
) {
  const base = struct.base ?? 2;
  const input = struct.input.trim();
  const n = input.length;
  if (n === 0) return;

  const placeValues: number[] = [];
  const digits: number[] = [];
  for (let i = 0; i < n; i++) {
    placeValues.push(Math.pow(base, n - 1 - i));
    const ch = input[i].toUpperCase();
    const d = /[0-9]/.test(ch) ? parseInt(ch, 10) : 'ABCDEF'.indexOf(ch) + 10;
    digits.push(isNaN(d) || d < 0 ? 0 : d);
  }
  const products = digits.map((d, i) => d * placeValues[i]);
  const total = products.reduce((a, b) => a + b, 0);

  const headers = placeValues.map((p) => String(p));
  const rowLabels = ['Digit', `× place`, 'Result'];
  const rows = [
    digits.map(String),
    placeValues.map((p) => `×${p}`),
    products.map(String),
  ];

  const tableStruct: Extract<SlideStructured, { kind: 'table' }> = {
    kind: 'table',
    caption: struct.label ?? `Converting ${input} (base ${base}) to decimal`,
    headers,
    rows,
    rowLabels,
    summary: `${input}${subscript(base)} = ${products.filter((_, i) => digits[i] !== 0).map((p) => p).join(' + ') || '0'} = ${total}\u2081\u2080`,
  };
  renderTable(s, tableStruct, t, x, y, w, h);
}

function subscript(n: number): string {
  const map: Record<string, string> = {
    '0': '\u2080', '1': '\u2081', '2': '\u2082', '3': '\u2083', '4': '\u2084',
    '5': '\u2085', '6': '\u2086', '7': '\u2087', '8': '\u2088', '9': '\u2089',
  };
  return String(n).split('').map((c) => map[c] ?? c).join('');
}

/** Lighten or darken a hex color by a 0-1 ratio (positive = lighter). */
function shade(hex: string, ratio: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => {
    const target = ratio >= 0 ? 255 : 0;
    const amt = Math.abs(ratio);
    return Math.round(c + (target - c) * amt);
  };
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`.toUpperCase();
}

// ─── Download helper ──────────────────────────────────────────────────────────

export function downloadBase64Pptx(base64: string, filename: string) {
  const link = document.createElement('a');
  link.href = `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${base64}`;
  link.download = filename.endsWith('.pptx') ? filename : `${filename}.pptx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
