/**
 * Unicode-capable font loader for pdf-lib.
 *
 * pdf-lib's StandardFonts (Helvetica/Courier/Times) use WinAnsi/CP1252 and
 * cannot encode math or Unicode symbols like √, π, ≤, ≥, ±, Δ, etc. We embed
 * DejaVu Sans so teaching artefacts (slides, worksheets, notes, quizzes,
 * rubrics) can display formulas legibly.
 *
 * To avoid bundler-resolution issues in sandboxed dev environments (where
 * node_modules asset imports and CJS packages like @pdf-lib/fontkit can be
 * brittle), the font bytes and the fontkit module are loaded at runtime from
 * a public CDN. Both are cached after first fetch.
 */

import type { PDFDocument, PDFFont } from 'pdf-lib';

export interface UnicodeFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
}

const DEJAVU_BASE = 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf';
const FONT_URLS = {
  regular: `${DEJAVU_BASE}/DejaVuSans.ttf`,
  bold: `${DEJAVU_BASE}/DejaVuSans-Bold.ttf`,
  italic: `${DEJAVU_BASE}/DejaVuSans-Oblique.ttf`,
  mono: `${DEJAVU_BASE}/DejaVuSansMono.ttf`,
};
// esm.sh rewrites bare specifiers (like `pako`) into relative URLs, which is
// required because @pdf-lib/fontkit's ES build imports `pako` by bare name.
const FONTKIT_URL = 'https://esm.sh/@pdf-lib/fontkit@1.1.1';

const byteCache = new Map<string, Promise<ArrayBuffer>>();

function fetchFont(url: string): Promise<ArrayBuffer> {
  let p = byteCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Failed to load font ${url}`);
      return r.arrayBuffer();
    });
    byteCache.set(url, p);
  }
  return p;
}

let fontkitPromise: Promise<unknown> | null = null;
async function loadFontkit(): Promise<unknown> {
  if (!fontkitPromise) {
    fontkitPromise = import(/* @vite-ignore */ FONTKIT_URL).then(
      (m) => (m as { default?: unknown }).default ?? m,
    );
  }
  return fontkitPromise;
}

export async function embedUnicodeFonts(pdf: PDFDocument): Promise<UnicodeFonts> {
  const fontkit = await loadFontkit();
  (pdf as unknown as { registerFontkit: (fk: unknown) => void }).registerFontkit(fontkit);
  const [reg, bold, italic, mono] = await Promise.all([
    fetchFont(FONT_URLS.regular),
    fetchFont(FONT_URLS.bold),
    fetchFont(FONT_URLS.italic),
    fetchFont(FONT_URLS.mono),
  ]);
  const [regFont, boldFont, italicFont, monoFont] = await Promise.all([
    pdf.embedFont(reg, { subset: true }),
    pdf.embedFont(bold, { subset: true }),
    pdf.embedFont(italic, { subset: true }),
    pdf.embedFont(mono, { subset: true }),
  ]);
  return { regular: regFont, bold: boldFont, italic: italicFont, mono: monoFont };
}
