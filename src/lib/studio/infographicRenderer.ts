/**
 * Render an Infographic document to an SVG string and convert to PNG.
 * Pure client-side — uses a canvas to rasterize the SVG so we can save as PNG.
 */

import type { Infographic, InfographicOrientation } from './infographicSchema';

const DIMS: Record<InfographicOrientation, { w: number; h: number }> = {
  portrait: { w: 1080, h: 1920 },
  landscape: { w: 1920, h: 1080 },
  square: { w: 1200, h: 1200 },
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderInfographicSvg(info: Infographic): string {
  const { w, h } = DIMS[info.orientation];
  const pad = 64;
  const p = info.palette;

  // Header band
  const headerH = info.orientation === 'landscape' ? 180 : 240;
  const titleLines = wrapText(info.title, info.orientation === 'landscape' ? 40 : 26);
  const subtitleLines = info.subtitle ? wrapText(info.subtitle, info.orientation === 'landscape' ? 60 : 40) : [];

  let cursorY = headerH + 40;

  // Layout sections — responsive grid
  const cols = info.orientation === 'landscape' ? 3 : info.orientation === 'square' ? 2 : 2;
  const gap = 28;
  const sectionW = (w - pad * 2 - gap * (cols - 1)) / cols;
  const sectionH = info.orientation === 'portrait' ? 260 : 240;

  const sectionCells: string[] = [];
  info.sections.forEach((sec, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (sectionW + gap);
    const y = cursorY + row * (sectionH + gap);

    const headingLines = wrapText(sec.heading, Math.floor(sectionW / 14));
    const bodyLines = sec.body ? wrapText(sec.body, Math.floor(sectionW / 9)).slice(0, 4) : [];
    const bulletLines = (sec.bullets ?? []).slice(0, 4);

    const cell = `
      <g transform="translate(${x}, ${y})">
        <rect width="${sectionW}" height="${sectionH}" rx="18" fill="${p.primary}" fill-opacity="0.08" stroke="${p.primary}" stroke-opacity="0.3" stroke-width="1.5"/>
        <rect x="0" y="0" width="6" height="${sectionH}" rx="3" fill="${p.accent}"/>
        ${sec.stat ? `
          <text x="${sectionW - 24}" y="48" font-family="Inter, sans-serif" font-weight="800" font-size="34" fill="${p.accent}" text-anchor="end">${escapeXml(sec.stat.value)}</text>
          <text x="${sectionW - 24}" y="72" font-family="Inter, sans-serif" font-weight="500" font-size="13" fill="${p.text}" fill-opacity="0.7" text-anchor="end">${escapeXml(sec.stat.label.slice(0, 40))}</text>
        ` : ''}
        ${headingLines.map((line, li) => `
          <text x="24" y="${48 + li * 28}" font-family="Inter, sans-serif" font-weight="700" font-size="22" fill="${p.text}">${escapeXml(line)}</text>
        `).join('')}
        ${bodyLines.map((line, li) => `
          <text x="24" y="${48 + headingLines.length * 28 + 16 + li * 20}" font-family="Inter, sans-serif" font-weight="400" font-size="14" fill="${p.text}" fill-opacity="0.85">${escapeXml(line)}</text>
        `).join('')}
        ${bulletLines.map((b, bi) => {
          const yy = 48 + headingLines.length * 28 + 16 + bodyLines.length * 20 + 16 + bi * 22;
          const bulletText = wrapText(b, Math.floor(sectionW / 9))[0] ?? b;
          return `
            <circle cx="30" cy="${yy - 5}" r="3" fill="${p.accent}"/>
            <text x="42" y="${yy}" font-family="Inter, sans-serif" font-weight="500" font-size="14" fill="${p.text}" fill-opacity="0.9">${escapeXml(bulletText.slice(0, 60))}</text>
          `;
        }).join('')}
      </g>
    `;
    sectionCells.push(cell);
  });

  const rowsUsed = Math.ceil(info.sections.length / cols);
  cursorY = cursorY + rowsUsed * (sectionH + gap);

  // Headline stat
  let headlineSvg = '';
  if (info.headline) {
    headlineSvg = `
      <g transform="translate(${w / 2}, ${headerH - 60})">
        <rect x="-220" y="-40" width="440" height="80" rx="40" fill="${p.accent}" fill-opacity="0.15" stroke="${p.accent}" stroke-opacity="0.5" stroke-width="1.5"/>
        <text x="-180" y="12" font-family="Inter, sans-serif" font-weight="800" font-size="42" fill="${p.accent}">${escapeXml(info.headline.value)}</text>
        <text x="-100" y="10" font-family="Inter, sans-serif" font-weight="500" font-size="14" fill="${p.text}" fill-opacity="0.85">${escapeXml(info.headline.label.slice(0, 40))}</text>
      </g>
    `;
  }

  // Timeline
  let timelineSvg = '';
  if (info.timeline && info.timeline.length > 0) {
    const items = info.timeline.slice(0, 6);
    const timelineH = 180;
    const itemW = (w - pad * 2) / items.length;
    timelineSvg = `
      <g transform="translate(${pad}, ${cursorY})">
        <text x="0" y="-10" font-family="Inter, sans-serif" font-weight="700" font-size="18" fill="${p.text}">Timeline</text>
        <line x1="0" y1="40" x2="${w - pad * 2}" y2="40" stroke="${p.primary}" stroke-opacity="0.5" stroke-width="2"/>
        ${items.map((t, i) => {
          const cx = itemW * i + itemW / 2;
          const labelLines = wrapText(t.label, 18).slice(0, 2);
          return `
            <circle cx="${cx}" cy="40" r="10" fill="${p.accent}" stroke="${p.background}" stroke-width="3"/>
            <text x="${cx}" y="20" font-family="Inter, sans-serif" font-weight="700" font-size="13" fill="${p.accent}" text-anchor="middle">${escapeXml(t.when)}</text>
            ${labelLines.map((ll, li) => `<text x="${cx}" y="${70 + li * 18}" font-family="Inter, sans-serif" font-weight="500" font-size="13" fill="${p.text}" text-anchor="middle">${escapeXml(ll)}</text>`).join('')}
          `;
        }).join('')}
      </g>
    `;
    cursorY += timelineH;
  }

  // Key takeaway band
  let takeawaySvg = '';
  if (info.keyTakeaway) {
    const takeawayY = h - 140;
    const lines = wrapText(info.keyTakeaway, info.orientation === 'landscape' ? 110 : 70).slice(0, 2);
    takeawaySvg = `
      <g transform="translate(0, ${takeawayY})">
        <rect x="${pad}" y="0" width="${w - pad * 2}" height="90" rx="14" fill="${p.accent}" fill-opacity="0.12" stroke="${p.accent}" stroke-opacity="0.4" stroke-width="1.5"/>
        <text x="${pad + 20}" y="28" font-family="Inter, sans-serif" font-weight="700" font-size="12" letter-spacing="2" fill="${p.accent}">KEY TAKEAWAY</text>
        ${lines.map((l, i) => `<text x="${pad + 20}" y="${56 + i * 24}" font-family="Inter, sans-serif" font-weight="600" font-size="18" fill="${p.text}">${escapeXml(l)}</text>`).join('')}
      </g>
    `;
  }

  // Footer
  const footerY = h - 36;
  const footerText = `${info.topic ? info.topic + '  ·  ' : ''}${info.yearLevel}  ·  Generated with Teach Assist`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${p.primary}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${p.secondary}" stop-opacity="1"/>
    </linearGradient>
    <pattern id="dotsPattern" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1" fill="${p.text}" fill-opacity="0.05"/>
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="${w}" height="${h}" fill="${p.background}"/>
  <rect width="${w}" height="${h}" fill="url(#dotsPattern)"/>

  <!-- Header -->
  <rect x="0" y="0" width="${w}" height="${headerH}" fill="url(#headerGrad)"/>
  ${titleLines.map((line, i) => `
    <text x="${pad}" y="${80 + i * 56}" font-family="Inter, sans-serif" font-weight="800" font-size="48" fill="#ffffff">${escapeXml(line)}</text>
  `).join('')}
  ${subtitleLines.map((line, i) => `
    <text x="${pad}" y="${80 + titleLines.length * 56 + 14 + i * 24}" font-family="Inter, sans-serif" font-weight="400" font-size="18" fill="#ffffff" fill-opacity="0.85">${escapeXml(line)}</text>
  `).join('')}

  ${headlineSvg}

  <!-- Sections -->
  ${sectionCells.join('\n')}

  ${timelineSvg}

  ${takeawaySvg}

  <!-- Footer -->
  <line x1="${pad}" y1="${footerY - 14}" x2="${w - pad}" y2="${footerY - 14}" stroke="${p.primary}" stroke-opacity="0.3" stroke-width="1"/>
  <text x="${pad}" y="${footerY}" font-family="Inter, sans-serif" font-weight="500" font-size="12" fill="${p.text}" fill-opacity="0.6">${escapeXml(footerText)}</text>
</svg>`;
}

/** Convert an SVG string to a base64 PNG using canvas. */
export async function svgToPngBase64(svg: string, width: number, height: number): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load SVG as image'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function svgToBase64(svg: string): string {
  return btoa(unescape(encodeURIComponent(svg)));
}

export function getInfographicDims(orientation: InfographicOrientation) {
  return DIMS[orientation];
}

export function downloadSvg(svg: string, filename: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadPngFromBase64(b64: string, filename: string) {
  const a = document.createElement('a');
  a.href = `data:image/png;base64,${b64}`;
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
