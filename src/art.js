/* ═══════════════════════════════════════════════════════════════════════════
   Illustrations and icons (inline SVG, no external assets).
   ═══════════════════════════════════════════════════════════════════════════ */
let ART_UID = 0;
/** Unique gradient ids per instance so several copies on a page never clash. */
function artIds(...names) { const n = ++ART_UID; return Object.fromEntries(names.map((k) => [k, `${k}${n}`])); }

const ART = {
  /** Purple mortarboard with a gold tassel — the app logo. */
  logo() {
    const i = artIds('lt', 'lb');
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs>
<linearGradient id="${i.lt}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a48bff"/><stop offset="1" stop-color="#5b3fe0"/></linearGradient>
<linearGradient id="${i.lb}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c4cf0"/><stop offset="1" stop-color="#3a24a8"/></linearGradient></defs>
<path d="M15 29v10c0 6.5 7.6 11 17 11s17-4.5 17-11V29l-17 7.6z" fill="url(#${i.lb})"/>
<path d="M32 8 61 21 32 34 3 21z" fill="url(#${i.lt})"/>
<path d="M32 8 61 21 32 34 3 21z" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="1"/>
<path d="M32 21 54 25v15" fill="none" stroke="#f6b40c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M51 39h6l1.5 11h-9z" fill="#f6b40c"/><circle cx="32" cy="21" r="2.6" fill="#f6b40c"/></svg>`;
  },

  /** Friendly robot mascot in a graduation cap, holding a book, thumbs up. Original artwork. */
  mascot(viewBox = '0 0 260 250') {
    const i = artIds('mh', 'mv', 'mb', 'mk', 'mg', 'mc');
    return `<svg viewBox="${viewBox}" class="mascot" role="img" aria-label="Teach Assist robot"><defs>
<linearGradient id="${i.mh}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dcd8f0"/></linearGradient>
<linearGradient id="${i.mv}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2f57"/><stop offset="1" stop-color="#0c0f26"/></linearGradient>
<linearGradient id="${i.mb}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9a7bff"/><stop offset="1" stop-color="#5a33d6"/></linearGradient>
<linearGradient id="${i.mk}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f3567"/><stop offset="1" stop-color="#171b3d"/></linearGradient>
<radialGradient id="${i.mc}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#7cf3ff" stop-opacity=".9"/><stop offset="1" stop-color="#7cf3ff" stop-opacity="0"/></radialGradient>
<filter id="${i.mg}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<ellipse cx="128" cy="238" rx="78" ry="9" fill="#2a1f6b" opacity=".12"/>
<!-- body -->
<path d="M78 170c0-26 22-38 50-38s50 12 50 38v34c0 22-22 32-50 32s-50-10-50-32z" fill="url(#${i.mh})" stroke="#cfc9ea" stroke-width="1.5"/>
<path d="M104 168c8 6 40 6 48 0" fill="none" stroke="#c9c2ea" stroke-width="3" stroke-linecap="round"/>
<!-- right arm + thumbs up -->
<path d="M172 172c14-2 22-10 26-22" fill="none" stroke="#dcd7f1" stroke-width="18" stroke-linecap="round"/>
<rect x="186" y="128" width="32" height="30" rx="12" fill="url(#${i.mh})" stroke="#cfc9ea" stroke-width="1.5"/>
<rect x="193" y="104" width="13" height="32" rx="6.5" fill="url(#${i.mh})" stroke="#cfc9ea" stroke-width="1.5"/>
<path d="M190 138h24M190 146h24" stroke="#d6d0ee" stroke-width="2" stroke-linecap="round"/>
<!-- book + left hand -->
<g transform="rotate(-14 104 200)"><rect x="70" y="166" width="64" height="74" rx="7" fill="#4c22b8"/><rect x="74" y="168" width="58" height="68" rx="5" fill="url(#${i.mb})"/><rect x="128" y="170" width="7" height="66" rx="2" fill="#efeaff"/><path d="M84 186h30M84 196h22" stroke="#c6b6ff" stroke-width="3" stroke-linecap="round" opacity=".7"/></g>
<circle cx="88" cy="214" r="15" fill="url(#${i.mh})" stroke="#cfc9ea" stroke-width="1.5"/>
<!-- ears -->
<circle cx="47" cy="104" r="22" fill="url(#${i.mc})"/><circle cx="209" cy="104" r="22" fill="url(#${i.mc})"/>
<circle cx="47" cy="104" r="15" fill="#eef0fb" stroke="#57e3ff" stroke-width="5"/>
<circle cx="209" cy="104" r="15" fill="#eef0fb" stroke="#57e3ff" stroke-width="5"/>
<!-- head -->
<rect x="50" y="50" width="156" height="110" rx="54" fill="url(#${i.mh})" stroke="#cfc9ea" stroke-width="1.5"/>
<rect x="66" y="66" width="124" height="80" rx="38" fill="url(#${i.mv})"/>
<path d="M82 78c14-6 40-8 58-6" stroke="#fff" stroke-opacity=".18" stroke-width="5" stroke-linecap="round" fill="none"/>
<g filter="url(#${i.mg})"><path d="M92 113q13-19 26 0M138 113q13-19 26 0" fill="none" stroke="#5ef0ff" stroke-width="8" stroke-linecap="round"/></g>
<!-- cap -->
<path d="M90 50v12c22 10 54 10 76 0V50z" fill="url(#${i.mk})"/>
<path d="M128 16 194 40 128 64 62 40z" fill="#2c3263"/><path d="M128 16 194 40 128 64 62 40z" fill="none" stroke="#4b528f" stroke-width="1.5"/>
<path d="M128 40 72 50v28" fill="none" stroke="#f6b40c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M66 76h12l3 20H63z" fill="#f6b40c"/><path d="M68 80v14M72 80v14M76 80v14" stroke="#d99a00" stroke-width="1.2"/>
<circle cx="128" cy="40" r="4" fill="#f6b40c"/>
<!-- sparkle -->
<path d="M214 30l10-12M222 46l16-6M206 18l2-14" stroke="#f6c21c" stroke-width="5" stroke-linecap="round"/></svg>`;
  },

  /** Yellow brush swoosh under the headline. */
  swoosh: `<svg viewBox="0 0 220 26" class="swoosh" aria-hidden="true"><path d="M4 18C60 6 140 2 216 10" fill="none" stroke="#f6c21c" stroke-width="7" stroke-linecap="round"/></svg>`,

  /** Suggestion-card illustrations. */
  laptop: `<svg viewBox="0 0 64 56" aria-hidden="true"><rect x="9" y="6" width="46" height="32" rx="4" fill="#6d4cf5"/><rect x="12" y="9" width="40" height="26" rx="2" fill="#8f74ff"/><path d="M26 17l-5 5 5 5M38 17l5 5-5 5M34 15l-4 14" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 42h58l-4 8H7z" fill="#3b2a9e"/><rect x="26" y="42" width="12" height="2.5" rx="1.2" fill="#8f74ff"/></svg>`,
  pdf: `<svg viewBox="0 0 56 64" aria-hidden="true"><path d="M10 4h26l14 14v38a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#fff" stroke="#1f2547" stroke-width="3"/><path d="M36 4v14h14" fill="none" stroke="#1f2547" stroke-width="3" stroke-linejoin="round"/><rect x="2" y="28" width="38" height="18" rx="4" fill="#e5383b"/><text x="21" y="41.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="11.5" font-weight="800" fill="#fff">PDF</text></svg>`,
  easel: `<svg viewBox="0 0 64 60" aria-hidden="true"><rect x="6" y="6" width="52" height="34" rx="3" fill="#fff" stroke="#f26b1d" stroke-width="3.5"/><rect x="3" y="3" width="58" height="6" rx="3" fill="#f26b1d"/><rect x="16" y="26" width="6" height="9" rx="1" fill="#f26b1d"/><rect x="26" y="20" width="6" height="15" rx="1" fill="#f26b1d"/><rect x="36" y="23" width="6" height="12" rx="1" fill="#e5383b"/><rect x="46" y="15" width="6" height="20" rx="1" fill="#f26b1d"/><path d="M32 40v8M32 48l-10 9M32 48l10 9" stroke="#f26b1d" stroke-width="3.5" stroke-linecap="round"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

/** Stroke icons used across the redesigned UI (24×24). */
const ICON = {
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><path d="m15.5 8.5 4-4M17 4.5h2.5V7"/>',
  book: '<path d="M2 5.5a2 2 0 0 1 2-2h5a3 3 0 0 1 3 3v14a2.5 2.5 0 0 0-2.5-2.5H2z"/><path d="M22 5.5a2 2 0 0 0-2-2h-5a3 3 0 0 0-3 3v14a2.5 2.5 0 0 1 2.5-2.5H22z"/>',
  clipboard: '<rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6M9 15h6M9 19h3"/><path d="M7.5 11h.01M7.5 15h.01"/>',
  slides: '<rect x="2.5" y="3" width="19" height="13" rx="2"/><path d="M12 16v3M8 21l4-2 4 2"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="4"/><path d="M12 4v4M9 3h6"/><circle cx="9" cy="14" r="1.3" fill="currentColor"/><circle cx="15" cy="14" r="1.3" fill="currentColor"/><path d="M2 13v2M22 13v2"/>',
  layers: '<path d="m12 2 9.5 5L12 12 2.5 7z"/><path d="m2.5 12 9.5 5 9.5-5"/><path d="m2.5 17 9.5 5 9.5-5"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none"/>',
  chat: '<path d="M21 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-5 4V5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5z"/>',
  check: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  library: '<rect x="3" y="4" width="4" height="16" rx="1"/><rect x="8.5" y="4" width="4" height="16" rx="1"/><path d="m14.5 5.2 3.8-1 3.5 15.4-3.8 1z"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
  send: '<path d="M21.5 2.5 10.5 13.5"/><path d="m21.5 2.5-7 19-4-8-8-4z" fill="currentColor" fill-opacity=".18"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
  folder: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
};
function icon(name, cls = '') { return `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`; }
