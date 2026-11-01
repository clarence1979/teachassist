'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Teach Assist — standalone single-file edition
   Bring-your-own-key chat client for Claude (Anthropic) and OpenAI that uses
   the same server-side machinery the web interfaces use:
     • native PDF / image inputs; Files API uploads for everything else
     • web search (+ web fetch) server tools
     • code execution sandboxes that produce REAL downloadable files
       (Anthropic: code execution + docx/pptx/xlsx/pdf Skills;
        OpenAI: Responses API code interpreter containers)
     • full reasoning ("thinking") preserved across tool rounds
   Everything is stored locally in IndexedDB. Keys live in localStorage.
   API details verified against platform.claude.com and developers.openai.com
   docs on 2026-10-31.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ───────────────────────────── API spec ───────────────────────────── */
const SPEC = {
  anthropic: {
    base: 'https://api.anthropic.com',
    version: '2023-06-01',
    // Code execution, Skills, Files, web search and web fetch are GA — no beta headers.
    tools: {
      webSearch: { type: 'web_search_20260318', name: 'web_search', max_uses: 12 },
      webFetch: { type: 'web_fetch_20260318', name: 'web_fetch', max_uses: 12, citations: { enabled: true }, max_content_tokens: 100000 },
      codeExec: { type: 'code_execution_20260521', name: 'code_execution' },
    },
    // Fallback (older) tool versions if the account/model rejects the newer ones.
    legacyTools: {
      webSearch: { type: 'web_search_20250305', name: 'web_search', max_uses: 12 },
      webFetch: { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 12, citations: { enabled: true }, max_content_tokens: 100000 },
      codeExec: { type: 'code_execution_20250825', name: 'code_execution' },
    },
    skills: ['docx', 'pptx', 'xlsx', 'pdf'].map((id) => ({ type: 'anthropic', skill_id: id, version: 'latest' })),
    maxTokensDefault: 64000,
    pdfMaxBytes: 32 * 1024 * 1024,
    inlineFileMaxKB: 160, // no-relay fallback: files are base64'd through stdout (costs tokens once)
    preferredModels: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5'],
    fallbackModels: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  openai: {
    base: 'https://api.openai.com',
    maxTokensDefault: 64000,
    dataDir: '/mnt/data',
    preferredModels: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-6-sol', 'gpt-5.4'],
    fallbackModels: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
    imageModels: ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'],
    inputFileMaxBytes: 50 * 1024 * 1024, // per file and combined per request
    // File types the Responses API parses natively as input_file; anything else goes to the container only.
    inputFileExt: new Set(['pdf', 'xlsx', 'xls', 'csv', 'tsv', 'iif', 'doc', 'docx', 'dot', 'odt', 'rtf', 'ppt', 'pptx', 'txt', 'md', 'json', 'html', 'htm', 'xml', 'py', 'js', 'ts', 'sql', 'css', 'java', 'c', 'cpp', 'cs', 'go', 'rb', 'php', 'sh', 'yaml', 'yml']),
  },
  imageTypes: new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  imageMaxBytes: 4.5 * 1024 * 1024,
  imageMaxDim: 2000,
  textExtractCap: 90000,
  attachmentMaxBytes: 100 * 1024 * 1024,
};
const EFFORTS = [['low', 'Effort: Low'], ['medium', 'Effort: Medium'], ['high', 'Effort: High'], ['xhigh', 'Effort: Extra high'], ['max', 'Effort: Max']];
const FILE_MARK_BEGIN = /-----BEGIN FILE (.+?) (\d+)-----\s*([A-Za-z0-9+/=\s]*?)\s*-----END FILE-----/g;

/* ───────────────────────────── Utilities ───────────────────────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
/** Strictly increasing millisecond stamp, so two messages created in the same ms keep their order. */
let LAST_STAMP = 0;
function nowStamp() { const t = Date.now(); LAST_STAMP = t > LAST_STAMP ? t : LAST_STAMP + 1; return LAST_STAMP; }
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtTokens(n) { return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n); }
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv === undefined || sv === null) continue; if (sk.startsWith('--')) node.style.setProperty(sk, sv); else node.style[sk] = sv; } }
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
function svgIcon(name) {
  const paths = {
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/>',
    brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    chat: '<path d="M21 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-5 4V5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
    paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    up: '<path d="M7 10v11"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7A2 2 0 0 1 17.5 21H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.8a2 2 0 0 0 1.8-1.1L12 2a3 3 0 0 1 3 3.9z"/>',
    down: '<path d="M17 14V3"/><path d="M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-7A2 2 0 0 1 6.5 3H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2.8a2 2 0 0 0-1.8 1.1L12 22a3 3 0 0 1-3-3.9z"/>',
    user: '<circle cx="12" cy="8" r="4.2" fill="currentColor"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5z" fill="currentColor"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
}
function iconClassFor(name = '', mime = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/')) return ['img', 'IMG'];
  if (ext === 'pdf' || mime === 'application/pdf') return ['pdf', 'PDF'];
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return ['doc', 'DOC'];
  if (['xls', 'xlsx', 'xlsm', 'ods'].includes(ext)) return ['xls', 'XLS'];
  if (ext === 'csv' || ext === 'tsv') return ['csv', 'CSV'];
  if (['ppt', 'pptx', 'odp'].includes(ext)) return ['ppt', 'PPT'];
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return ['zip', 'ZIP'];
  if (['md', 'markdown'].includes(ext)) return ['md', 'MD'];
  if (['html', 'htm'].includes(ext)) return ['html', 'HTML'];
  if (ext === 'json') return ['json', 'JSON'];
  if (['py', 'js', 'ts', 'tsx', 'jsx', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'sql', 'kt', 'swift', 'css', 'xml', 'yaml', 'yml', 'ipynb'].includes(ext)) return ['code', ext.toUpperCase().slice(0, 4)];
  return ['txt', ext ? ext.toUpperCase().slice(0, 4) : 'FILE'];
}
function guessMime(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
    csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain', md: 'text/markdown', json: 'application/json',
    html: 'text/html', htm: 'text/html', xml: 'application/xml', zip: 'application/zip',
    py: 'text/x-python', js: 'text/javascript', ts: 'text/typescript', css: 'text/css', java: 'text/x-java', c: 'text/x-c', cpp: 'text/x-c++', sh: 'text/x-sh', sql: 'text/x-sql', yaml: 'text/yaml', yml: 'text/yaml', ipynb: 'application/x-ipynb+json',
  };
  return map[ext] || 'application/octet-stream';
}
const TEXTLIKE_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bat', 'sql', 'kt', 'swift', 'yaml', 'yml', 'ini', 'toml', 'log', 'tex', 'r', 'ipynb', 'svg']);

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
function base64ToBlob(b64, mime) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name || 'download' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function localDateStamp(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseJsonLoose(s) { try { return JSON.parse(s); } catch { return null; } }
function todayContext(tz) {
  // Date only (no clock time) so the system prompt stays byte-identical within a day —
  // current Claude models bind thinking blocks to an unchanged prefix.
  try { return new Intl.DateTimeFormat('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz || undefined }).format(new Date()); }
  catch { return new Date().toDateString(); }
}
function locationFromTimezone(tz = '') {
  const AU = { Melbourne: 'Victoria', Sydney: 'New South Wales', Brisbane: 'Queensland', Perth: 'Western Australia', Adelaide: 'South Australia', Hobart: 'Tasmania', Darwin: 'Northern Territory', Canberra: 'Australian Capital Territory' };
  const city = tz.split('/')[1]?.replace(/_/g, ' ');
  if (tz.startsWith('Australia/')) return { country: 'AU', city: city in AU ? city : undefined, region: AU[city], timezone: tz };
  const countryByPrefix = { 'Europe/London': 'GB', 'Pacific/Auckland': 'NZ', 'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Tokyo': 'JP', 'Asia/Hong_Kong': 'HK', 'Europe/Dublin': 'IE', 'Asia/Kolkata': 'IN' };
  if (countryByPrefix[tz]) return { country: countryByPrefix[tz], city, timezone: tz };
  if (tz.startsWith('America/')) return { timezone: tz }; // ambiguous country; let the provider infer
  return { timezone: tz };
}

/* ───────────────────────────── Settings ───────────────────────────── */
const SETTINGS_KEY = 'teachassist.settings.v1';
const DEFAULT_SETTINGS = {
  anthropicKey: '',
  openaiKey: '',
  anthropicRelay: '',
  provider: 'anthropic',
  anthropicModel: '',
  openaiModel: '',
  effort: 'high',
  maxTokens: 64000,
  webSearch: true,
  codeTools: true,
  imageGen: true,
  imageModel: 'gpt-image-2',
  showThinking: true,
  userName: '',
  profile: 'I teach Digital Technologies (Years 8–12, including VCE Software Development and Applied Computing) at a Melbourne secondary school. Use Australian English spelling, Australian Curriculum v9 / VCAA terminology by default, and the Australia/Melbourne timezone.',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Melbourne',
  sidebarCollapsed: false,
  saveHistory: true,          // keep chats after the tab closes + mirror everything into the JSON history file
  memoryEnabled: false,       // give the model summaries of earlier chats (per-conversation toggle default)
  activeView: 'chat',
  ttView: 'week',             // timetable: week | day | month | agenda
  ttWeekend: false,
  keySource: { anthropic: '', openai: '' }, // 'main' = supplied by the main program, 'user' = typed in Settings
  trustedParentOrigin: '',    // optional: only accept keys posted from this origin
  rememberKeys: true,         // keep API keys in this browser for 30 days (off: only until the tab is closed)
  appearance: 'light',        // light | dark | system
  textScale: 1,               // A− / A / A+ (0.85 – 1.45)
  a11y: { contrast: false, motion: false, font: false, spacing: false, links: false },
  localModel: '',             // on-device model key (see LOCAL_MODELS in local-ai.js)
  localWhenOffline: true,     // offline + a downloaded model → it answers instead of Claude/OpenAI
};

/* ───────────────────────────── API key storage ─────────────────────────────
   Keys are kept apart from the other settings:
     • "Remember me" on  → localStorage `teachassist.keys.v1` with an expiry 30 days after the keys
                           were last entered; on the first launch after that date they are erased.
     • "Remember me" off → sessionStorage only, so they are gone when the tab/browser is closed.
   Older versions kept the keys inside the settings blob; they are moved on first load. */
const KEYS_LS = 'teachassist.keys.v1';
const KEYS_SS = 'teachassist.keys.session';
const KEY_TTL_DAYS = 30;
const KEY_TTL_MS = KEY_TTL_DAYS * 24 * 60 * 60 * 1000;
const KEYS_STATE = { expired: false };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
function readStoredKeys() {
  const rec = parseJsonLoose(lsGet(KEYS_LS));
  if (rec && (rec.anthropicKey || rec.openaiKey)) {
    if (rec.expiresAt && Date.now() > rec.expiresAt) { try { localStorage.removeItem(KEYS_LS); } catch { /* ignore */ } KEYS_STATE.expired = true; }
    else return { anthropicKey: rec.anthropicKey || '', openaiKey: rec.openaiKey || '', expiresAt: rec.expiresAt || null, remembered: true };
  }
  const ses = parseJsonLoose(ssGet(KEYS_SS));
  if (ses && (ses.anthropicKey || ses.openaiKey)) return { anthropicKey: ses.anthropicKey || '', openaiKey: ses.openaiKey || '', expiresAt: null, remembered: false };
  return null;
}
function persistKeys(resetClock = false) {
  const anthropicKey = settings.anthropicKey || '', openaiKey = settings.openaiKey || '';
  const has = !!(anthropicKey || openaiKey);
  try {
    if (settings.rememberKeys && has) {
      if (resetClock || !settings.keysExpireAt || settings.keysExpireAt < Date.now()) settings.keysExpireAt = Date.now() + KEY_TTL_MS;
      localStorage.setItem(KEYS_LS, JSON.stringify({ anthropicKey, openaiKey, savedAt: Date.now(), expiresAt: settings.keysExpireAt }));
      sessionStorage.removeItem(KEYS_SS);
    } else {
      localStorage.removeItem(KEYS_LS);
      settings.keysExpireAt = null;
      if (has) sessionStorage.setItem(KEYS_SS, JSON.stringify({ anthropicKey, openaiKey })); else sessionStorage.removeItem(KEYS_SS);
    }
  } catch (e) { console.warn('[keys] could not store keys', e); }
}
function forgetKeys() {
  try { localStorage.removeItem(KEYS_LS); sessionStorage.removeItem(KEYS_SS); } catch { /* ignore */ }
  settings.anthropicKey = ''; settings.openaiKey = ''; settings.keysExpireAt = null;
  settings.keySource = { anthropic: '', openai: '' };
  saveSettings({});
}

let settings = { ...DEFAULT_SETTINGS, ...(parseJsonLoose(lsGet(SETTINGS_KEY)) || {}) };
settings.keySource = { anthropic: '', openai: '', ...(settings.keySource || {}) };
(function loadKeys() {
  const legacy = { anthropicKey: settings.anthropicKey || '', openaiKey: settings.openaiKey || '' };
  const stored = readStoredKeys();
  if (stored) {
    Object.assign(settings, { anthropicKey: stored.anthropicKey, openaiKey: stored.openaiKey, keysExpireAt: stored.expiresAt, rememberKeys: stored.remembered });
  } else if ((legacy.anthropicKey || legacy.openaiKey) && !KEYS_STATE.expired) {
    Object.assign(settings, legacy, { keysExpireAt: null }); // moved out of the settings blob below
    persistKeys(true);
  } else {
    Object.assign(settings, { anthropicKey: '', openaiKey: '', keysExpireAt: null });
    if (KEYS_STATE.expired) settings.keySource = { anthropic: '', openai: '' };
  }
  writeSettingsBlob();
})();
function writeSettingsBlob() {
  const { anthropicKey, openaiKey, keysExpireAt, ...rest } = settings; // keys never go in the settings blob
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest)); } catch { /* ignore */ }
}
function saveSettings(patch = {}) {
  const keyChanged = ['anthropicKey', 'openaiKey'].some((k) => k in patch && (patch[k] || '') !== (settings[k] || ''));
  const rememberChanged = 'rememberKeys' in patch && !!patch.rememberKeys !== !!settings.rememberKeys;
  settings = { ...settings, ...patch };
  writeSettingsBlob();
  if (keyChanged || rememberChanged || 'anthropicKey' in patch || 'openaiKey' in patch) persistKeys(keyChanged || rememberChanged);
  applyTheme();
}
/** Claude/OpenAI need a key; on-device AI needs a chosen model. */
function providerReady(p) { return p === 'local' ? !!settings.localModel : !!keyFor(p); }
/** If the selected provider can't be used but another can, switch to it. Returns the provider now in use (or null). */
function ensureUsableProvider() {
  if (providerReady(settings.provider)) return settings.provider;
  const other = ['anthropic', 'openai'].find((p) => p !== settings.provider && keyFor(p));
  if (other) { saveSettings({ provider: other }); return other; }
  if (settings.localModel && isLocalDownloaded(settings.localModel)) { saveSettings({ provider: 'local' }); return 'local'; }
  return null;
}
const providerName = (p) => (p === 'anthropic' ? 'Claude' : p === 'local' ? 'On-device' : 'OpenAI');
const TEXT_SCALES = [0.85, 0.92, 1, 1.1, 1.2, 1.32, 1.45];
const DARK_MQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false, addEventListener() {} };
function resolvedTheme() { const a = settings.appearance || 'light'; return a === 'system' ? (DARK_MQ.matches ? 'dark' : 'light') : a; }
/** Appearance (light/dark/system), text size and accessibility modes → classes and variables on <html>. */
function applyTheme() {
  const root = document.documentElement;
  const theme = resolvedTheme();
  root.setAttribute('data-theme', theme);
  const d = $('#hljsDark'), l = $('#hljsLight');
  if (d && l) { d.disabled = theme !== 'dark'; l.disabled = theme === 'dark'; }
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = theme === 'dark' ? '#120d2f' : '#efe8ff';
  const tt = $('#themeToggle'); if (tt) { tt.setAttribute('aria-checked', String(theme === 'dark')); tt.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'; }
  const ts = TEXT_SCALES.includes(+settings.textScale) ? +settings.textScale : 1;
  root.style.setProperty('--ts', String(ts));
  const dn = $('#tsDown'), rs = $('#tsReset'), up = $('#tsUp');
  if (dn) { dn.disabled = ts <= TEXT_SCALES[0]; up.disabled = ts >= TEXT_SCALES[TEXT_SCALES.length - 1]; rs.classList.toggle('on', ts === 1); dn.classList.toggle('on', ts < 1); up.classList.toggle('on', ts > 1); rs.title = `Normal text size (now ${Math.round(ts * 100)}%)`; }
  const a = settings.a11y || {};
  root.classList.toggle('a11y-contrast', !!a.contrast);
  root.classList.toggle('a11y-motion', !!a.motion);
  root.classList.toggle('a11y-font', !!a.font);
  root.classList.toggle('a11y-spacing', !!a.spacing);
  root.classList.toggle('a11y-links', !!a.links);
}
function stepTextScale(dir) {
  const cur = TEXT_SCALES.indexOf(TEXT_SCALES.includes(+settings.textScale) ? +settings.textScale : 1);
  const next = dir === 0 ? 1 : TEXT_SCALES[clamp(cur + dir, 0, TEXT_SCALES.length - 1)];
  saveSettings({ textScale: next });
}
DARK_MQ.addEventListener?.('change', () => { if (settings.appearance === 'system') applyTheme(); });
function keyFor(provider) { return provider === 'local' ? '' : String((provider === 'anthropic' ? settings.anthropicKey : settings.openaiKey) || '').trim(); }
function currentModel() { return settings.provider === 'anthropic' ? settings.anthropicModel : settings.provider === 'local' ? settings.localModel : settings.openaiModel; }
function relayBase() { return (settings.anthropicRelay || '').trim().replace(/\/+$/, ''); }

/* ───────────────────────────── Keys from the main program ─────────────────────────────
   When Teach Assist is launched from the main program it picks up the keys the main
   program already holds, so the user never retypes them:
     1. localStorage `api_cache` (JSON: OPENAI_API_KEY, CLAUDE_API_KEY, username, …) —
        shared when the app is served from the same origin as the main program;
     2. the individual localStorage keys OPENAI_API_KEY / CLAUDE_API_KEY / openai_api_key
        (and the older VITE_* names);
     3. a same-origin parent's `apiCache.get(...)`;
     4. when embedded in a frame: the postMessage handshake
        {type:'REQUEST_API_VALUES'} → {type:'API_VALUES_RESPONSE', data:{…}}.
   A key the user typed in Settings is never overwritten; a key that came from the main
   program is refreshed whenever the main program supplies a new one. */
const MAIN = { connected: false, via: '', origin: '', username: '' };
function inFrame() { try { return window.self !== window.top; } catch { return true; } }
function readLocalApiCache() {
  const out = {};
  const ls = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const cache = parseJsonLoose(ls('api_cache')) || {};
  out.OPENAI_API_KEY = cache.OPENAI_API_KEY || ls('OPENAI_API_KEY') || ls('openai_api_key') || ls('VITE_OPENAI_API_KEY');
  out.CLAUDE_API_KEY = cache.CLAUDE_API_KEY || ls('CLAUDE_API_KEY') || ls('VITE_CLAUDE_API_KEY');
  out.username = cache.username || '';
  // Same-origin parent exposing the apiCache helper.
  try {
    const pc = window.parent !== window && window.parent.apiCache;
    if (pc && typeof pc.get === 'function') {
      out.OPENAI_API_KEY = out.OPENAI_API_KEY || pc.get('OPENAI_API_KEY') || '';
      out.CLAUDE_API_KEY = out.CLAUDE_API_KEY || pc.get('CLAUDE_API_KEY') || '';
      out.username = out.username || pc.get('username') || '';
    }
  } catch { /* cross-origin parent: use postMessage instead */ }
  return out;
}
/** Merge main-program keys into settings. Returns true if anything changed. */
function applyMainKeys(data, via, origin = '') {
  if (!data || typeof data !== 'object') return false;
  const patch = {}; const src = { ...settings.keySource };
  const take = (provider, field, value) => {
    value = typeof value === 'string' ? value.trim() : '';
    if (!value) return;
    const mine = settings[field] && src[provider] !== 'main'; // user-typed key wins
    if (mine) return;
    if (settings[field] !== value) patch[field] = value;
    src[provider] = 'main';
  };
  take('anthropic', 'anthropicKey', data.CLAUDE_API_KEY || data.ANTHROPIC_API_KEY);
  take('openai', 'openaiKey', data.OPENAI_API_KEY);
  if (data.OPENAI_API_KEY || data.CLAUDE_API_KEY) { MAIN.connected = true; MAIN.via = via; MAIN.origin = origin; }
  if (data.username) { MAIN.username = data.username; if (!settings.userName) patch.userName = String(data.username); }
  const changed = Object.keys(patch).length > 0 || JSON.stringify(src) !== JSON.stringify(settings.keySource);
  if (changed) saveSettings({ ...patch, keySource: src });
  return Object.keys(patch).some((k) => k.endsWith('Key'));
}
/** Ask the embedding main program for keys; resolves after a reply or a short timeout. */
function requestParentKeys(timeoutMs = 2500) {
  if (!inFrame()) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    window.addEventListener('message', function once(ev) {
      if (ev.data?.type !== 'API_VALUES_RESPONSE') return;
      window.removeEventListener('message', once);
      finish(true);
    });
    // The request carries no secrets, so '*' is safe here; we validate the REPLY's sender.
    let target = '*';
    try { if (settings.trustedParentOrigin) target = settings.trustedParentOrigin; } catch { /* ignore */ }
    try { window.parent.postMessage({ type: 'REQUEST_API_VALUES' }, target); } catch { finish(false); }
    setTimeout(() => finish(false), timeoutMs);
  });
}
function referrerOrigin() { try { return document.referrer ? new URL(document.referrer).origin : ''; } catch { return ''; } }
/** Accept key messages only from our own parent frame (and, if set, only from the trusted origin). */
function onParentMessage(ev) {
  const d = ev.data;
  if (!d || typeof d !== 'object' || ev.source !== window.parent || window.parent === window) return;
  const trusted = settings.trustedParentOrigin || '';
  if (trusted && ev.origin !== trusted) { console.warn('[keys] ignored message from untrusted origin', ev.origin); return; }
  let payload = null;
  if (d.type === 'API_VALUES_RESPONSE') payload = d.data;
  else if (d.type === 'PEDAGOGY_CREDENTIALS' || d.type === 'PEDAGOGY_CREDENTIALS_UPDATE') {
    const ps = d.payload?.providers || [];
    payload = { CLAUDE_API_KEY: ps.find((p) => p.id === 'anthropic')?.apiKey, OPENAI_API_KEY: ps.find((p) => p.id === 'openai')?.apiKey, username: d.payload?.user?.name };
  }
  if (!payload) return;
  if (applyMainKeys(payload, 'postMessage', ev.origin)) onKeysChanged();
  else if (MAIN.connected) renderModelSelect();
}
let onKeysChanged = () => {};

/* ───────────────────────────── History JSON file (per session) ─────────────────────────────
   Everything the app stores locally (chats, tasks, timetable blocks, library files) is
   mirrored into ONE JSON file, grouped by session, kept in the browser's Cache Storage
   (IndexedDB where Cache Storage isn't available, e.g. when the HTML is opened from disk).
   The current session's entry is refreshed shortly after every change and finalised when
   the app closes, so the file is always complete. It can be exported, imported or cleared
   — whole, per session, or for selected sessions. */
const HISTORY = { cache: 'teach-assist-history', url: new URL('teach-assist-history.json', location.href.startsWith('http') ? location.href : 'https://teach-assist.local/').href, idbKey: 'history:chat-history.json' };
function cacheStorageOk() { try { return !!window.caches && window.isSecureContext; } catch { return false; } }
function emptyHistoryDoc() { return { app: 'Teach Assist', format: 'teach-assist-history', version: 2, created: new Date().toISOString(), sessions: [] }; }
/** v1 files held a flat `entries` list of chat exchanges; fold them into one imported session. */
function upgradeHistoryDoc(doc) {
  if (!doc) return null;
  if (doc.version >= 2 && Array.isArray(doc.sessions)) return doc;
  const out = emptyHistoryDoc();
  out.created = doc.created || out.created;
  if (Array.isArray(doc.entries) && doc.entries.length) {
    out.sessions.push({ id: 'ses_imported_v1', startedAt: doc.created || doc.entries[0].timestamp, endedAt: doc.updated || null, exchanges: doc.entries, tasks: [], blocks: [], artifacts: [] });
  }
  return out;
}
async function readHistory() {
  try {
    if (cacheStorageOk()) {
      const c = await caches.open(HISTORY.cache);
      const r = await c.match(HISTORY.url);
      if (r) return upgradeHistoryDoc(await r.json());
    } else {
      const rec = await getCachedFile(HISTORY.idbKey);
      if (rec) return upgradeHistoryDoc(JSON.parse(await rec.blob.text()));
    }
  } catch (e) { console.warn('[history] read failed', e); }
  return null;
}
async function writeHistory(doc) {
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  if (cacheStorageOk()) {
    const c = await caches.open(HISTORY.cache);
    await c.put(HISTORY.url, new Response(blob, { headers: { 'Content-Type': 'application/json', 'Last-Modified': new Date().toUTCString() } }));
  } else {
    await cacheFileBlob(HISTORY.idbKey, blob, 'teach-assist-history.json', 'application/json');
  }
  return blob.size;
}
let historyQueue = Promise.resolve();
function queueHistory(fn) { historyQueue = historyQueue.then(fn).catch((e) => console.warn('[history]', e)); return historyQueue; }
function exchangeEntry(conv, userMsg, assistant) {
  return {
    id: assistant.id, conversationId: conv.id, conversationTitle: conv.title || 'New chat',
    timestamp: new Date(assistant.createdAt).toISOString(), provider: assistant.provider, model: assistant.model,
    user: { text: userMsg.text || '', attachments: (userMsg.attachments || []).map((a) => ({ name: a.name, type: a.mediaType, size: a.size })) },
    assistant: {
      text: assistant.text || '',
      files: (assistant.files || []).filter((f) => f.status === 'ready').map((f) => ({ name: f.name, type: f.mediaType, size: f.size })),
      sources: (assistant.sources || []).map((s) => ({ title: s.title, url: s.url })),
      status: assistant.error ? 'error' : (assistant.stopReason === 'stopped' ? 'stopped' : 'complete'),
      ...(assistant.error ? { error: assistant.error } : {}),
    },
    usage: assistant.usage || null,
    ...(assistant.feedback ? { feedback: assistant.feedback } : {}),
  };
}
/** Append one completed exchange to the current session's entry. */
function appendHistory(conv, userMsg, assistant) {
  if (!settings.saveHistory || !userMsg || !assistant) return;
  return queueHistory(async () => {
    const doc = (await readHistory()) || emptyHistoryDoc();
    const ses = sessionEntry(doc, SESSION.id);
    const entry = exchangeEntry(conv, userMsg, assistant);
    const i = ses.exchanges.findIndex((e) => e.id === entry.id);
    if (i >= 0) ses.exchanges[i] = entry; else ses.exchanges.push(entry);
    ses.lastActiveAt = new Date().toISOString();
    doc.updated = ses.lastActiveAt;
    await writeHistory(doc);
  });
}
function sessionEntry(doc, id) {
  let ses = doc.sessions.find((x) => x.id === id);
  if (!ses) { ses = { id, startedAt: new Date(id === SESSION.id ? SESSION.startedAt : Date.now()).toISOString(), endedAt: null, exchanges: [], tasks: [], blocks: [], artifacts: [] }; doc.sessions.push(ses); }
  for (const k of ['exchanges', 'tasks', 'blocks', 'artifacts']) if (!Array.isArray(ses[k])) ses[k] = [];
  return ses;
}
/** Mirror this session's planner records (tasks, timetable, library) into its entry. */
let sessionSyncTimer = null;
function scheduleSessionSync(delay = 2500) {
  if (!settings.saveHistory) return;
  clearTimeout(sessionSyncTimer);
  sessionSyncTimer = setTimeout(() => { if (state.busy.size) { scheduleSessionSync(4000); return; } syncSessionToHistory(); }, delay);
}
function syncSessionToHistory(final = false) {
  if (!settings.saveHistory) return Promise.resolve();
  return queueHistory(async () => {
    const [tasks, blocks, arts] = await Promise.all([store.all('tasks'), store.all('blocks'), store.all('artifacts')]);
    const existing = await readHistory();
    const doc = existing || emptyHistoryDoc();
    const known = doc.sessions.some((x) => x.id === SESSION.id);
    const ses = sessionEntry(doc, SESSION.id);
    const mine = (r) => r.sessionId === SESSION.id || r.lastSessionId === SESSION.id;
    ses.tasks = tasks.filter(mine).map((t) => ({ id: t.id, title: t.title, description: t.description || '', deadline: t.deadline ? new Date(t.deadline).toISOString() : null, estimatedDurationMin: t.estimatedDurationMin, priority: t.priority, status: t.status, tags: t.tags || [], createdAt: new Date(t.createdAt).toISOString(), updatedAt: new Date(t.updatedAt || t.createdAt).toISOString() }));
    ses.blocks = blocks.filter(mine).map((b) => ({ id: b.id, title: b.title, type: b.type, startISO: b.startISO, endISO: b.endISO, location: b.location || '', notes: b.notes || '', recurrence: b.recurrence || null, exdates: b.exdates || [], status: b.status || 'scheduled', taskId: b.taskId || null, artifactIds: b.artifactIds || [] }));
    ses.artifacts = arts.filter(mine).map((a) => ({ id: a.id, title: a.title, kind: a.kind, mediaType: a.mediaType, size: a.size, conversationId: a.conversationId || null, createdAt: new Date(a.createdAt).toISOString() }));
    ses.lastActiveAt = new Date().toISOString();
    ses.endedAt = (final || (typeof sessionEnded !== 'undefined' && sessionEnded)) ? ses.lastActiveAt : null;
    doc.updated = ses.lastActiveAt;
    // A session with nothing in it yet is not written (keeps the file empty after a clear).
    if (!known && !ses.exchanges.length && !ses.tasks.length && !ses.blocks.length && !ses.artifacts.length) {
      doc.sessions = doc.sessions.filter((x) => x.id !== SESSION.id);
      if (!existing) { DIRTY.session = false; return; }
    }
    await writeHistory(doc);
    DIRTY.session = false;
  });
}
async function exportHistory() {
  await historyQueue;
  const doc = await readHistory();
  if (!doc || !doc.sessions.some((s) => s.exchanges.length || s.tasks.length || s.blocks.length || s.artifacts.length)) { alert('The history file is empty.'); return; }
  downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `teach-assist-history-${localDateStamp()}.json`);
}
async function clearHistory() {
  await historyQueue;
  try {
    if (cacheStorageOk()) await caches.delete(HISTORY.cache);
    await store.del('files', HISTORY.idbKey).catch(() => {});
  } catch (e) { console.warn('[history] clear failed', e); }
}
async function historyStats() {
  const doc = await readHistory();
  if (!doc) return { entries: 0, bytes: 0, convs: 0, sessions: 0 };
  const ex = doc.sessions.flatMap((s) => s.exchanges || []);
  return { entries: ex.length, bytes: JSON.stringify(doc).length, convs: new Set(ex.map((e) => e.conversationId)).size, sessions: doc.sessions.length, updated: doc.updated };
}

/* ───────────────────────────── Memory of earlier chats ───────────────────────────── */
async function buildMemorySnapshot(excludeConvId) {
  const convs = (await store.all('conversations')).filter((c) => c.id !== excludeConvId && !c.ephemeral).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
  const lines = [];
  const trunc = (s, n) => { const one = String(s || '').replace(/\s+/g, ' ').trim(); return one.length > n ? one.slice(0, n - 1) + '…' : one; };
  for (const c of convs) {
    const msgs = (await store.byIndex('messages', 'conversationId', c.id)).sort((a, b) => a.createdAt - b.createdAt);
    const asks = msgs.filter((m) => m.role === 'user' && (m.text || '').trim()).slice(0, 2);
    if (!asks.length) continue;
    const last = [...msgs].reverse().find((m) => m.role === 'assistant' && (m.text || '').trim());
    const files = msgs.flatMap((m) => (m.files || []).filter((f) => f.status === 'ready').map((f) => f.name));
    lines.push(`• [${localDateStamp(new Date(c.updatedAt))}] "${trunc(c.title, 70)}"\n  Asked: ${asks.map((m) => trunc(m.text, 200)).join(' | ')}${last ? `\n  Last reply: ${trunc(last.text, 240)}` : ''}${files.length ? `\n  Files made: ${[...new Set(files)].slice(0, 6).join(', ')}` : ''}`);
  }
  return lines.join('\n');
}

/* ───────────────────────────── IndexedDB ───────────────────────────── */
const DB_NAME = 'teachassist-standalone';
let dbp = null;
function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('conversations')) db.createObjectStore('conversations', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'id' }).createIndex('conversationId', 'conversationId');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
      // v2: everything the Bolt app kept in Supabase now lives here, tagged with the session that created it.
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blocks')) db.createObjectStore('blocks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('artifacts')) db.createObjectStore('artifacts', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function idb(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let req;
    try { req = fn(tx.objectStore(storeName)); } catch (e) { reject(e); return; }
    tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
/* ───────────────────────────── Session ─────────────────────────────
   One "session" = one time the app is open in a tab (a reload within the tab keeps the
   same session). Every record carries the session that created it, so memory can be
   cleared per session, and each session is mirrored into the JSON history file. */
const SESSION = (() => {
  let id = null;
  try { id = sessionStorage.getItem('teachassist.session'); } catch { /* ignore */ }
  if (!id) { id = `ses_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; try { sessionStorage.setItem('teachassist.session', id); } catch { /* ignore */ } }
  return { id, startedAt: Date.now() };
})();
const DIRTY = { session: false }; // set when something in the local store changed this session
function markDirty() { DIRTY.session = true; if (typeof scheduleSessionSync === 'function') scheduleSessionSync(); }

const store = {
  put: (s, obj) => { if (obj && typeof obj === 'object' && s !== 'files' && s !== 'sessions') { if (!obj.sessionId) obj.sessionId = SESSION.id; obj.lastSessionId = SESSION.id; } const p = idb(s, 'readwrite', (os) => os.put(obj)); if (s !== 'files' && s !== 'sessions') p.then(markDirty, () => {}); return p; },
  get: (s, key) => idb(s, 'readonly', (os) => os.get(key)),
  del: (s, key) => { const p = idb(s, 'readwrite', (os) => os.delete(key)); if (s !== 'files' && s !== 'sessions') p.then(markDirty, () => {}); return p; },
  all: (s) => idb(s, 'readonly', (os) => os.getAll()),
  byIndex: (s, idx, val) => idb(s, 'readonly', (os) => os.index(idx).getAll(val)),
  clear: (s) => idb(s, 'readwrite', (os) => os.clear()),
};

/* ───────────────────────────── State ───────────────────────────── */
const state = {
  convs: [],
  activeConvId: null,
  messages: [],
  busy: new Map(),
  pending: [],
  models: { anthropic: null, openai: null },
  renderTimers: new Map(),
  fileBlobUrls: new Map(),
  purged: new Set(),   // conversation ids deleted while a reply may still be streaming
  turns: new Map(),    // conversation id -> promise of the running assistant turn
};

/* ───────────────────────────── Model catalogs ───────────────────────────── */
async function fetchModels(provider, force = false) {
  if (provider === 'local') return LOCAL_MODELS.map((m) => m.key);
  const key = keyFor(provider);
  if (!key) { state.models[provider] = null; return []; }
  if (state.models[provider]?.live && !force) return state.models[provider].ids;
  let ids = [];
  try {
    if (provider === 'anthropic') {
      const res = await fetch(`${SPEC.anthropic.base}/v1/models?limit=100`, { headers: anthropicHeaders(key, { json: false }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      ids = (data.data || []).filter((m) => typeof m.id === 'string' && m.id.startsWith('claude'))
        .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)).map((m) => m.id);
    } else {
      const res = await fetch(`${SPEC.openai.base}/v1/models`, { headers: openaiHeaders(key, false) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const EXCL = ['audio', 'realtime', 'transcribe', 'tts', 'search', 'image', 'embedding', 'moderation', 'instruct', 'codex', 'deep-research', 'computer-use', 'oss', 'chat-latest', 'whisper', 'dall-e', 'babbage', 'davinci', 'omni', '-pro'];
      const DATED = /-\d{4}-\d{2}-\d{2}$|-\d{4}$/;
      const all = (data.data || []).filter((m) => typeof m.id === 'string');
      const idset = new Set(all.map((m) => m.id));
      ids = all.filter((m) => (m.id.startsWith('gpt-') || /^o\d/.test(m.id)) && !EXCL.some((f) => m.id.includes(f)))
        .filter((m) => !(DATED.test(m.id) && idset.has(m.id.replace(DATED, ''))))
        .filter((m) => !/^gpt-(3|4-turbo|4o)/.test(m.id))
        .sort((a, b) => (b.created || 0) - (a.created || 0) || b.id.localeCompare(a.id)).map((m) => m.id);
    }
  } catch (e) { console.warn('[models]', provider, e); }
  const live = ids.length > 0;
  if (!live) ids = SPEC[provider].fallbackModels;
  state.models[provider] = { ids, live };
  const cur = provider === 'anthropic' ? settings.anthropicModel : settings.openaiModel;
  if (!cur || (live && !ids.includes(cur))) {
    const pref = SPEC[provider].preferredModels.find((m) => ids.includes(m));
    const isSmall = provider === 'anthropic' ? (m) => /haiku/.test(m) : (m) => /-(mini|nano|luna)\b/.test(m) || /^o\d/.test(m) || /^gpt-4/.test(m);
    const pick = pref || ids.find((m) => !isSmall(m)) || ids[0];
    saveSettings(provider === 'anthropic' ? { anthropicModel: pick } : { openaiModel: pick });
  }
  return ids;
}

/* ───────────────────────────── Anthropic adapter ───────────────────────────── */
function anthropicHeaders(key, { json = true, betas = [] } = {}) {
  const h = { 'x-api-key': key, 'anthropic-version': SPEC.anthropic.version, 'anthropic-dangerous-direct-browser-access': 'true' };
  if (betas.length) h['anthropic-beta'] = betas.join(',');
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
/** Which thinking/effort surface a model accepts (verified against the Oct-2026 docs). */
function anthropicCaps(model) {
  const m = model.toLowerCase();
  const ver = (fam) => {
    // "claude-opus-4-7", "claude-sonnet-5-5"; legacy "claude-3-7-sonnet-2025…" puts the version first.
    let r = m.match(new RegExp(`${fam}-(\\d{1,2})(?:-(\\d{1,2}))?(?!\\d)`));
    if (!r) r = m.match(new RegExp(`claude-(\\d)(?:-(\\d))?-${fam}`));
    return r ? parseFloat(`${r[1]}.${r[2] || 0}`) : null;
  };
  const opus = ver('opus'), sonnet = ver('sonnet'), haiku = ver('haiku');
  const fable = m.includes('fable') || m.includes('mythos');
  const adaptive = fable || (opus !== null && opus >= 4.6) || (sonnet !== null && sonnet >= 4.6) || (haiku !== null && haiku >= 5);
  const legacyThinking = !adaptive && ((opus !== null && opus >= 4) || (sonnet !== null && sonnet >= 3.7) || (haiku !== null && haiku >= 4.5));
  const effort = adaptive || (opus !== null && opus >= 4.5);
  // Mid-conversation role:"system" messages: Fable/Mythos, Opus 5.x/4.8, Sonnet 5.5, Haiku 5.5 (not Sonnet 5, not 4.7 and older).
  const midSystem = fable || (opus !== null && (opus >= 5 || opus === 4.8)) || (sonnet !== null && sonnet >= 5.5) || (haiku !== null && haiku >= 5.5);
  // 1M-context models accept up to 600 PDF pages per request; older ones 100.
  const pdfPages = (fable || (opus !== null && opus >= 5) || (sonnet !== null && sonnet >= 5) || (haiku !== null && haiku >= 5)) ? 600 : 100;
  return { adaptive, legacyThinking, effort, midSystem, pdfPages };
}
function toolsKey(tools) { return JSON.stringify((tools || []).map((t) => t.type ? `${t.type}:${t.name}:${JSON.stringify(t.allowed_callers || '')}` : `fn:${t.name}`)); }
async function anthropicError(res) {
  let detail = '';
  try { const b = await res.json(); detail = b?.error?.message || JSON.stringify(b); } catch { try { detail = await res.text(); } catch { /* ignore */ } }
  const base = res.status === 401 ? 'Invalid Anthropic API key.' : res.status === 429 ? 'Anthropic rate limit reached — wait a moment and retry.' : res.status >= 500 ? `Anthropic server error (${res.status}).` : `Anthropic error ${res.status}.`;
  const e = new Error(detail ? `${base} ${detail}` : base);
  e.status = res.status; e.detail = detail || ''; e.provider = 'anthropic';
  return e;
}
function requireRelay() {
  const r = relayBase();
  if (!r) { const e = new Error('Claude files relay not configured'); e.code = 'NO_RELAY'; throw e; }
  return r;
}
async function anthropicUploadFile(key, blob, filename) {
  const base = requireRelay();
  const fd = new FormData();
  fd.append('file', blob, filename);
  const res = await fetch(`${base}/v1/files`, { method: 'POST', headers: anthropicHeaders(key, { json: false }), body: fd });
  if (!res.ok) throw await anthropicError(res);
  return res.json();
}
async function anthropicFileMeta(key, fileId) {
  const base = requireRelay();
  const res = await fetch(`${base}/v1/files/${fileId}`, { headers: anthropicHeaders(key, { json: false }) });
  if (!res.ok) throw await anthropicError(res);
  return res.json();
}
async function anthropicFileContent(key, fileId) {
  const base = requireRelay();
  const res = await fetch(`${base}/v1/files/${fileId}/content`, { headers: anthropicHeaders(key, { json: false }) });
  if (!res.ok) throw await anthropicError(res);
  return res.blob();
}

function describeAttachment(a, provider, codeTools, opts = {}) {
  const size = fmtBytes(a.size);
  const inSandbox = codeTools && (provider === 'anthropic' ? !!a.anthropicFileId : !!a.openaiFileId);
  const where = provider === 'anthropic' ? 'the sandbox input directory (run `ls` / `find` to locate it)' : `${SPEC.openai.dataDir}/ (run \`ls /mnt/data\` first — the stored name may carry a prefix)`;
  if (a.kind === 'image') return `[Attached image: ${a.name} (${size})]`;
  if (a.kind === 'pdf') {
    const native = opts.pdfNative === false ? `too long to attach natively (${a.pages} pages)` : 'provided natively above';
    return `[Attached PDF: ${a.name} (${size}${a.pages ? `, ${a.pages} pages` : ''}) — ${native}${inSandbox ? `; the original is in ${where}` : ''}]`;
  }
  const nativeFile = provider === 'openai' && !!a.openaiFileId && opts.openaiInputFile !== false;
  const preview = nativeFile ? '; provided as a file input' : a.text ? (a.textTruncated ? '; a truncated text extract is attached' : '; a text extract is attached') : '';
  const sandbox = inSandbox ? `; the original file is in ${where} — open it with code for full fidelity (tables, formulas, formatting)` : (codeTools ? '; the original binary is NOT in the sandbox (only the extract)' : '');
  return `[Attached file: ${a.name} (${size})${preview}${sandbox}]`;
}

/**
 * Build the content blocks for a user message ONCE and store them on the message
 * (large base64 payloads are stored as references and rehydrated). Current Claude
 * models bind thinking blocks to an unchanged prefix, so a user turn must be replayed
 * byte-identically forever after it was first sent.
 */
function freezeAnthropicUserBlocks(m, { codeTools, pdfPages }) {
  if (m.anthropicContent) return;
  const blocks = [];
  for (const a of m.attachments || []) {
    if (a.kind === 'image' && a.base64) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: `@att:${a.id}` } });
    } else if (a.kind === 'pdf') {
      a.pdfNative = !(a.pages && a.pages > pdfPages);
      if (a.pdfNative && a.anthropicFileId) blocks.push({ type: 'document', source: { type: 'file', file_id: a.anthropicFileId }, title: a.name, citations: { enabled: true } });
      else if (a.pdfNative && a.base64) blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: `@att:${a.id}` }, title: a.name, citations: { enabled: true } });
    } else if (a.text) {
      blocks.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: `@text:${a.id}` }, title: a.kind === 'text' ? a.name : `${a.name} (extracted text)` });
    }
    if (codeTools && a.anthropicFileId && a.kind !== 'image') blocks.push({ type: 'container_upload', file_id: a.anthropicFileId });
  }
  const notes = (m.attachments || []).map((a) => describeAttachment(a, 'anthropic', codeTools, { pdfNative: a.pdfNative })).filter(Boolean);
  let text = m.text || '';
  if (notes.length) text = `${notes.join('\n')}\n\n${text}`.trim();
  blocks.push({ type: 'text', text: text || '(see attachments)' });
  m.anthropicContent = blocks;
}
function rehydrateBlocks(m, blocks) {
  const byId = new Map((m.attachments || []).map((a) => [a.id, a]));
  return blocks.map((b) => {
    if (b.source?.data && typeof b.source.data === 'string' && b.source.data.startsWith('@')) {
      const [kind, id] = b.source.data.slice(1).split(':');
      const a = byId.get(id);
      const data = kind === 'att' ? (a?.base64 || '') : (a?.text || '');
      return { ...b, source: { ...b.source, data } };
    }
    return b;
  }).filter((b) => !(b.source && b.source.type !== 'file' && b.source.data === ''));
}
/** Drop private bookkeeping keys and blocks the API would reject (defensive; the live path prunes already). */
function sanitizeAssistantBlocks(blocks) {
  return blocks.filter((b) => b && b.type && !(b.type === 'text' && !b.text) && !(b.type === 'thinking' && !b.signature))
    .map((b) => Object.fromEntries(Object.entries(b).filter(([k]) => !k.startsWith('_'))));
}

/** Build Anthropic `messages` from the chain, replaying stored turns verbatim. */
function buildAnthropicMessages(chain, { codeTools, pdfPages, midSystem, dropThinkingBefore }) {
  const out = [];
  for (const m of chain) {
    if (m.role === 'user') {
      freezeAnthropicUserBlocks(m, { codeTools, pdfPages });
      out.push({ role: 'user', content: rehydrateBlocks(m, m.anthropicContent) });
      if (midSystem && m.anthropicSystemNote) out.push({ role: 'system', content: m.anthropicSystemNote });
    } else if (m.role === 'assistant') {
      const dropThinking = dropThinkingBefore && m.createdAt < dropThinkingBefore;
      if (m.native?.provider === 'anthropic' && Array.isArray(m.native.turns) && m.native.turns.length) {
        for (const t of m.native.turns) {
          let content = t.role === 'assistant' ? sanitizeAssistantBlocks(t.content || []) : (t.content || []).filter((b) => b && b.type);
          if (dropThinking) content = content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
          if (content.length) out.push({ role: t.role, content });
        }
      } else {
        const t = (m.text || '').trim();
        if (t) out.push({ role: 'assistant', content: [{ type: 'text', text: t }] });
      }
    }
  }
  // Merge consecutive same-role user/assistant turns (system notes stay separate).
  const merged = [];
  for (const msg of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role && msg.role !== 'system') last.content = [...last.content, ...msg.content];
    else merged.push({ role: msg.role, content: Array.isArray(msg.content) ? [...msg.content] : msg.content });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  // A trailing assistant turn would make the model continue its own message.
  while (merged.length && merged[merged.length - 1].role === 'assistant') merged.pop();
  return merged;
}

const PART_ORDER = ['identity', 'profile', 'date', 'style', 'files', 'images', 'tools', 'memory', 'web'];
function buildSystemPrompt(provider, opts) {
  const p = systemPromptParts(provider, opts);
  return PART_ORDER.map((k) => p[k]).filter(Boolean).join('\n');
}
/** Dates for the next two weeks so the model never has to compute weekdays itself. */
function dateLookup(tz) {
  const rows = [];
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i);
    let label; try { label = new Intl.DateTimeFormat('en-AU', { weekday: 'short', timeZone: tz || undefined }).format(d); } catch { label = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]; }
    rows.push(`${localDateStamp(d)} ${label}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`);
  }
  return rows.join(', ');
}
/** The prompt in sections; sections that can change mid-conversation are compared individually. */
function systemPromptParts(provider, { codeTools, webSearch, imageTool, conv }) {
  const name = settings.userName?.trim();
  const P = {};
  P.identity = `You are Teach Assist, a capable, careful AI assistant working with ${name ? name + ', ' : ''}a teacher. You help with anything they bring you: lesson planning and resources, marking and feedback, admin and emails, coding and IT, curriculum questions, general knowledge and personal productivity. Treat every request as a real task from a busy professional.`;
  P.profile = settings.profile?.trim() ? `\nAbout the teacher: ${settings.profile.trim()}` : '';
  P.date = `\nToday's date: ${todayContext(settings.timezone)} (${settings.timezone}). Calendar for the next two weeks: ${dateLookup(settings.timezone)}.`;
  P.tools = `
# The teacher's planner (tools)
You can read and change the teacher's own task list, timetable and resource library with the add_task / list_tasks / update_task / delete_task, schedule_block / list_timetable_blocks / update_timetable_block / delete_timetable_block / clear_timetable_range, search_library and attach_resource_to_block tools.
- Times are local (${settings.timezone}) and written as YYYY-MM-DDTHH:MM:SS with no timezone suffix. Use the calendar above to turn "next Tuesday" into a date; never guess a weekday.
- Before editing or deleting timetable blocks, call list_timetable_blocks so you have real IDs and times. To wipe a day or window before re-planning, use clear_timetable_range (not many single deletes).
- Recurring classes use an RRULE string, e.g. FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1 or FREQ=WEEKLY;INTERVAL=2 for fortnightly; use scope "single" with occurrenceDateISO to change or skip one occurrence of a series.
- After changing the planner, confirm briefly what you added, moved or removed, quoting the dates and days from the tool results.`;
  P.memory = conv?.memory && conv.memorySnapshot ? `\n# Memory of earlier chats\nSummaries of this teacher's recent conversations, newest first. Use them when they refer to earlier work ("the quiz we made", "last time"); don't raise them unprompted. If a detail isn't here, say you only have a summary.\n${conv.memorySnapshot}` : '';
  const L = [];
  L.push(`
# How to respond
- Lead with the answer or the deliverable. No preamble, no restating the request, no flattery.
- Match depth to the task: a quick question gets a short, direct answer; a request for a resource gets a complete, classroom-ready resource. Never pad, never truncate.
- Use Markdown. Use LaTeX ($...$ and $$...$$) for mathematics. Use fenced code blocks with language tags for code.
- Accuracy and spelling in teaching materials are non-negotiable: check terminology, names, dates and arithmetic before finishing.
- Small ambiguities: make a sensible assumption and note it in one line. Ask a clarifying question only when the answer would change the deliverable substantially.
- Read attached files fully before responding and use their actual content, structure and wording.`);
  P.style = L.join('\n');
  L.length = 0;

  if (codeTools && provider === 'anthropic') {
    const relay = !!relayBase();
    L.push(`
# Files and documents
You have a code execution sandbox (bash + file editor, Python 3.11 with python-docx, python-pptx, openpyxl, reportlab, matplotlib, pandas, pypdf and more) with the docx, pptx, xlsx and pdf Skills attached under /skills/.
- Whenever the user asks for a document, worksheet, handout, lesson plan, letter, rubric, quiz, slide deck, spreadsheet, markbook, PDF, chart or any other file, build a real file in the sandbox. Use Word (.docx) for prose documents, PowerPoint (.pptx) for slides, Excel (.xlsx) for tabular work, PDF only when a fixed print layout is explicitly wanted, PNG/SVG for charts and diagrams.
- Before building, read the relevant Skill's SKILL.md (e.g. /skills/docx/SKILL.md) and follow it — it holds the production workflow and quality checks.
- Write the complete content first, at the quality an expert teacher would hand to colleagues: full explanations, worked examples, every question with an answer key, consistent headings and numbering, correct terminology. Never deliver a thin outline or placeholder text.
- ${relay
    ? 'To deliver a file, copy it into "$OUTPUT_DIR" and list that directory in the same bash command, e.g. `cp /tmp/outputs/report.docx "$OUTPUT_DIR/" && ls -la "$OUTPUT_DIR"`. Only files in $OUTPUT_DIR at the end of a command reach the user.'
    : `FILE TRANSFER (important — this client cannot use the Files API): to deliver a file, run ONE bash command that prints it as base64 between markers, e.g. \`f=/tmp/outputs/report.docx; echo "-----BEGIN FILE $(basename "$f") $(stat -c%s "$f")-----"; base64 -w0 "$f"; echo; echo "-----END FILE-----"\`. The client decodes it into a download. Keep each file under ${SPEC.anthropic.inlineFileMaxKB} KB (check with \`stat\`; prefer text/vector over embedded photos; compress or drop images; split very long decks into parts). If a file is bigger, say so and offer a lighter version or parts.`}
- Files the user attached ${relay ? 'are in the sandbox input directory when noted in the message (look with `ls`/`find`)' : 'are available as text extracts in the message; the original binaries are not in the sandbox'}.
- After creating a file, reply with a short summary of what it contains and any assumptions — do not paste the whole content again.
- Only answer inline (no file) when the user asks for the content in the chat or it is short (a paragraph, a handful of questions).`);
  } else if (codeTools && provider === 'openai') {
    L.push(`
# Files and documents
You have the python tool (code interpreter) with python-docx, python-pptx, openpyxl, reportlab, matplotlib, pandas and similar libraries.
- Whenever the user asks for a document, worksheet, handout, lesson plan, letter, rubric, quiz, slide deck, spreadsheet, markbook, PDF, chart or any other file, write it with the python tool and save it under ${SPEC.openai.dataDir}/ — it is returned to the user as a download. Use Word (.docx) for prose documents, PowerPoint (.pptx) for slides, Excel (.xlsx) for tabular work, PDF only when a fixed print layout is explicitly wanted, PNG/SVG for charts.
- Write the complete content first, at the quality an expert teacher would hand to colleagues: full explanations, worked examples, every question with an answer key, consistent headings and numbering, correct terminology. Never deliver a thin outline or placeholder text. Use real document features (heading styles, tables, numbered lists, page breaks, slide layouts, sensible column widths) and verify the file opens by re-reading it.
- If a library is missing, use an available alternative rather than giving up.
- Files the user attached are in ${SPEC.openai.dataDir}/ — run \`ls /mnt/data\` first (stored names may carry a prefix) and open them with code when you need full fidelity.
- After creating a file, reply with a short summary of what it contains and any assumptions — do not paste the whole content again. Link files as sandbox:/mnt/data/<filename>.
- Only answer inline (no file) when the user asks for the content in the chat or it is short.`);
  } else {
    L.push(`\n# Files\nCode execution is switched off for this conversation, so you cannot create downloadable files. If the user asks for a document, give the complete content in well-formatted Markdown and mention that turning on "Code & files" would deliver it as a DOCX/PPTX/XLSX/PDF.`);
  }
  P.files = L.join('\n');
  P.images = imageTool ? `\n# Images\nWhen the user asks for a picture, illustration, poster, diagram artwork or any generated image, use the generate_image tool. Pass a detailed prompt (subject, composition, style, colours, mood, text to include if any). Never say you cannot create images.` : '';
  P.web = webSearch ? `\n# Web\nUse web search for anything time-sensitive or that you are not certain about (current curriculum documents, software versions, prices, news, research). Cite sources with links.` : `\n# Web\nWeb search is switched off for this conversation; answer from your own knowledge and say when something may have changed.`;
  return P;
}
/** Text for a mid-conversation system note: only the sections that changed since the frozen prompt. */
function systemUpdateNote(prevParts, nextParts) {
  const changed = [];
  const labels = { profile: 'About the teacher', date: 'Date', style: 'How to respond', files: 'Files and documents', images: 'Images', tools: 'The teacher\'s planner (tools)', memory: 'Memory of earlier chats', web: 'Web' };
  for (const k of Object.keys(labels)) if ((prevParts[k] || '') !== (nextParts[k] || '')) changed.push(nextParts[k] ? nextParts[k].trim() : `${labels[k]}: (section removed — no longer applies)`);
  if (!changed.length) return '';
  return `Context update — the following replaces the corresponding section(s) of your instructions from this point on:\n\n${changed.join('\n\n')}`;
}

const IMAGE_TOOL_DEF = {
  name: 'generate_image',
  description: 'Generate an image from a text prompt (photorealistic, illustration, diagram artwork, poster, etc.). Returns the image. Use for any request to create, draw, design or render a picture.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed description: subject, composition, style, colours, lighting, mood, any text to render.' },
      size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'], description: 'Square, landscape or portrait.' },
    },
    required: ['prompt'],
  },
};

/** One Anthropic assistant turn, including pause_turn continuation and client tool rounds. */
async function runAnthropic({ conv, chain, msg, signal, onProgress }) {
  const key = keyFor('anthropic');
  const model = settings.anthropicModel;
  const codeTools = !!conv.codeTools;
  const webSearch = !!conv.webSearch;
  const imageTool = !!(settings.imageGen && settings.openaiKey.trim());
  const caps = anthropicCaps(model);

  // Upload attachments of the NEW user message only — earlier turns must replay unchanged.
  const newest = [...chain].reverse().find((m) => m.role === 'user' && !m.anthropicContent);
  if (newest) await ensureAnthropicUploads(newest, key, codeTools, onProgress);

  const callers = codeTools ? ['direct', SPEC.anthropic.tools.codeExec.type] : ['direct'];
  const loc = locationFromTimezone(settings.timezone);
  const desiredTools = [];
  if (webSearch) {
    const ws = { ...SPEC.anthropic.tools.webSearch, allowed_callers: callers };
    if (loc.country) ws.user_location = { type: 'approximate', ...(loc.city ? { city: loc.city } : {}), ...(loc.region ? { region: loc.region } : {}), country: loc.country, timezone: loc.timezone };
    desiredTools.push(ws);
    desiredTools.push({ ...SPEC.anthropic.tools.webFetch, allowed_callers: callers });
  }
  if (codeTools) desiredTools.push({ ...SPEC.anthropic.tools.codeExec });
  for (const t of clientToolDefs({ imageTool })) desiredTools.push(t);
  const desiredParts = systemPromptParts('anthropic', { codeTools, webSearch, imageTool, conv });
  const desiredSystem = PART_ORDER.map((k) => desiredParts[k]).filter(Boolean).join('\n');

  // Freeze `system` and `tools` for the conversation so the request prefix stays byte-identical
  // (current Claude models bind thinking blocks to it). Changes arrive as mid-conversation
  // system notes on models that support them; a changed tool set unavoidably resets thinking.
  let fz = conv.anthropicFrozen;
  if (!fz) { fz = conv.anthropicFrozen = { system: desiredSystem, parts: desiredParts, tools: desiredTools, key: toolsKey(desiredTools) }; }
  if (fz.key !== toolsKey(desiredTools)) {
    // Toggle changed mid-chat: the tool set (part of the bound prefix) changes, so earlier thinking is void.
    fz.tools = desiredTools; fz.key = toolsKey(desiredTools);
    conv.anthropicDropThinkingBefore = Date.now();
  }
  if (caps.midSystem && newest) {
    const note = systemUpdateNote(fz.parts, desiredParts);
    if (note) { newest.anthropicSystemNote = note; fz.parts = desiredParts; }
  }
  const useFrozenSystem = caps.midSystem;
  await store.put('conversations', conv);

  const body = {
    model,
    max_tokens: settings.maxTokens || SPEC.anthropic.maxTokensDefault,
    system: useFrozenSystem ? fz.system : desiredSystem,
    messages: buildAnthropicMessages(chain, { codeTools, pdfPages: caps.pdfPages, midSystem: caps.midSystem, dropThinkingBefore: conv.anthropicDropThinkingBefore }),
    stream: true,
  };
  if (newest) await store.put('messages', newest);
  if (fz.tools.length) body.tools = structuredClone(fz.tools);
  if (codeTools) {
    body.container = { skills: SPEC.anthropic.skills };
    // Containers live 30 days (checkpointed when idle); expires_at is a short rolling value, so always resend the id.
    if (conv.anthropicContainerId) body.container.id = conv.anthropicContainerId;
  }
  if (caps.adaptive) body.thinking = { type: 'adaptive', display: settings.showThinking ? 'summarized' : 'omitted' };
  else if (caps.legacyThinking) {
    const budget = { low: 2000, medium: 8000, high: 16000, xhigh: 32000, max: 32000 }[settings.effort] || 8000;
    body.thinking = { type: 'enabled', budget_tokens: Math.min(budget, body.max_tokens - 1024) };
  }
  if (caps.effort) body.output_config = { effort: settings.effort };

  msg.native = { provider: 'anthropic', turns: [] };
  const inlineMode = codeTools && !relayBase();
  const ctx = { conv };

  try {
    for (let round = 0; round < 24; round++) {
      const result = await anthropicStreamOnce(key, body, msg, signal, onProgress, ctx);
      // Keep whatever tool definitions the API accepted (self-healed versions) so later turns resend them identically.
      if (body.tools && JSON.stringify(body.tools) !== JSON.stringify(fz.tools)) { fz.tools = structuredClone(body.tools); await store.put('conversations', conv); }
      if (result.container?.id) {
        conv.anthropicContainerId = result.container.id;
        conv.anthropicContainerExpiresAt = result.container.expires_at || null;
        await store.put('conversations', conv);
        if (body.container) body.container.id = conv.anthropicContainerId;
      }
      msg.usage = addUsage(msg.usage, result.usage);
      msg.stopReason = result.stopReason;
      if (signal.aborted) break;

      if (result.stopReason === 'pause_turn') {
        body.messages = [...body.messages, { role: 'assistant', content: result.blocks }];
        onProgress();
        continue;
      }
      if (result.stopReason === 'tool_use') {
        // Client tools (generate_image). Server tools never need a tool_result from us.
        const clientCalls = result.blocks.filter((b) => b.type === 'tool_use');
        if (!clientCalls.length) break;
        const results = [];
        for (const call of clientCalls) {
          const seg = (msg.segments || []).find((s) => s.toolId === call.id);
          try {
            const r = await runClientTool(call, msg);
            results.push({ type: 'tool_result', tool_use_id: call.id, content: r.content });
            if (seg) { seg.status = 'done'; seg.output = r.summary || ''; }
          } catch (e) {
            results.push({ type: 'tool_result', tool_use_id: call.id, content: `Error: ${e.message}`, is_error: true });
            if (seg) { seg.status = 'error'; seg.output = e.message; }
          }
          onProgress();
        }
        const userTurn = { role: 'user', content: results };
        msg.native.turns.push(userTurn);
        body.messages = [...body.messages, { role: 'assistant', content: result.blocks }, userTurn];
        continue;
      }
      break;
    }
  } finally {
    // Whatever happened (stop, error, max_tokens mid-tool-call), leave only replayable blocks behind.
    pruneAnthropicTurns(msg);
    if (inlineMode) extractInlineFiles(msg);
    syncAnthropicSegments(msg);
  }
  await collectAnthropicFiles(key, msg, onProgress);
}

/** Remove blocks the API would reject on replay: partial tool inputs, unsigned thinking, empty text, tool calls without results. */
function pruneAnthropicTurns(msg) {
  const turns = msg.native?.turns || [];
  const resultIds = new Set();
  for (const t of turns) for (const b of t.content || []) if (b && b.tool_use_id) resultIds.add(b.tool_use_id);
  for (const t of turns) {
    t.content = (t.content || []).filter((b) => {
      if (!b || !b.type) return false;
      if ('_json' in b) { b.input = parseJsonLoose(b._json) || {}; delete b._json; }
      if (t.role === 'assistant') {
        if (b.type === 'text') return !!b.text;
        if (b.type === 'thinking') return !!b.signature;
        if (b.type === 'tool_use' || b.type === 'server_tool_use') return resultIds.has(b.id);
      }
      return true;
    });
  }
  msg.native.turns = turns.filter((t) => t.content.length);
}

async function ensureAnthropicUploads(m, key, codeTools, onProgress) {
  if (!relayBase()) return; // Files API unreachable from the browser without the relay.
  let changed = false;
  for (const a of m.attachments || []) {
    if (a.kind === 'image' || a.anthropicFileId || a.anthropicUploadFailed) continue;
    if (!codeTools && a.kind !== 'pdf') continue;
    const blob = await getAttachmentBlob(a);
    if (!blob) continue;
    try {
      a.uploading = true; onProgress();
      const meta = await anthropicUploadFile(key, blob, safeFilename(a.name));
      a.anthropicFileId = meta.id; changed = true;
    } catch (e) {
      console.warn('[anthropic upload]', e);
      a.anthropicUploadFailed = true; a.uploadError = e.message;
    } finally { a.uploading = false; }
  }
  if (changed) await store.put('messages', m);
}
function safeFilename(name) { return String(name || 'file').replace(/[<>:"|?*\\/]/g, '-').trim() || 'file'; }

/** Stream one Anthropic request; append a new assistant turn to msg.native.turns. */
async function anthropicStreamOnce(key, body, msg, signal, onProgress, ctx = {}) {
  let res;
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(`${SPEC.anthropic.base}/v1/messages`, { method: 'POST', headers: anthropicHeaders(key), body: JSON.stringify(body), signal });
    if (res.ok) break;
    const err = await anthropicError(res);
    const d = err.detail || '';
    if (err.status !== 400 && err.status !== 404) throw err;
    // Self-heal common validation errors so the app keeps working across model generations.
    // Order matters: the most specific messages are tested first.
    const nums = (d.match(/\d{4,7}/g) || []).map(Number);
    if (/signature|bound to a different|prefix/i.test(d)) {
      // Thinking blocks no longer match the prefix: drop them (persistently, so later turns stay consistent).
      body.messages = stripThinking(body.messages);
      if (ctx.conv) { ctx.conv.anthropicDropThinkingBefore = Date.now(); store.put('conversations', ctx.conv).catch(() => {}); }
      continue;
    }
    if (/max_tokens/i.test(d) && nums.length) { const limit = Math.min(...nums.filter((n) => n >= 1024)); if (limit && limit < body.max_tokens) { body.max_tokens = limit; if (body.thinking?.budget_tokens) body.thinking.budget_tokens = Math.min(body.thinking.budget_tokens, limit - 1024); continue; } }
    if (/allowed_callers/i.test(d) && body.tools) { body.tools = body.tools.map((t) => (t.allowed_callers ? { ...t, allowed_callers: ['direct'] } : t)); continue; }
    if (/web_search_2026|web_fetch_2026|code_execution_2026|tool.*version|unsupported.*tool|does not support .*tool/i.test(d) && body.tools && !ctx.legacyTools) {
      ctx.legacyTools = true;
      body.tools = body.tools.map((t) => {
        if (t.name === 'web_search') return { ...SPEC.anthropic.legacyTools.webSearch };
        if (t.name === 'web_fetch') return { ...SPEC.anthropic.legacyTools.webFetch };
        if (t.name === 'code_execution') return { ...SPEC.anthropic.legacyTools.codeExec };
        return t;
      });
      continue;
    }
    if (/display/i.test(d) && body.thinking?.display) { delete body.thinking.display; continue; }
    if (/output_config|effort/i.test(d) && body.output_config) { if (['xhigh', 'max'].includes(body.output_config.effort)) body.output_config.effort = 'high'; else delete body.output_config; continue; }
    if (/thinking\.type|budget_tokens|thinking.*not supported|thinking.*enabled/i.test(d) && body.thinking) {
      if (body.thinking.type === 'adaptive') body.thinking = { type: 'enabled', budget_tokens: Math.min(10000, body.max_tokens - 1024) };
      else delete body.thinking;
      continue;
    }
    if (/container/i.test(d) && body.container?.id) { delete body.container.id; if (ctx.conv) { ctx.conv.anthropicContainerId = null; store.put('conversations', ctx.conv).catch(() => {}); } continue; }
    if (/skill/i.test(d) && body.container) { delete body.container; continue; }
    if (/user_location/i.test(d) && body.tools) { body.tools = body.tools.map((t) => { const { user_location, ...rest } = t; return rest; }); continue; }
    if (/citations/i.test(d)) { body.messages = JSON.parse(JSON.stringify(body.messages, (k, v) => (k === 'citations' && v && typeof v === 'object' && 'enabled' in v ? undefined : v))); continue; }
    if (/role.*system|system.*role|system message/i.test(d) && body.messages.some((m) => m.role === 'system')) { body.messages = body.messages.filter((m) => m.role !== 'system'); continue; }
    if (/thinking/i.test(d) && body.thinking) { delete body.thinking; continue; }
    throw err;
  }
  if (!res.ok) throw await anthropicError(res);

  const blocks = [];
  const turn = { role: 'assistant', content: blocks };
  msg.native.turns.push(turn);
  let stopReason = null, usage = {}, container = null;
  const finalize = () => {
    for (const b of blocks) if (b && '_json' in b) { b.input = parseJsonLoose(b._json) || {}; delete b._json; }
    turn.content = blocks.filter(Boolean);
  };
  try {
    await readSse(res, signal, (ev) => {
      const t = ev.type;
      if (t === 'message_start') {
        usage = ev.message?.usage || {};
        if (ev.message?.container) container = ev.message.container;
      } else if (t === 'content_block_start') {
        const b = structuredClone(ev.content_block);
        if (b.type === 'tool_use' || b.type === 'server_tool_use' || b.type === 'mcp_tool_use') { b._json = ''; b.input = b.input || {}; }
        if (b.type === 'text') { b.text = b.text || ''; }
        if (b.type === 'thinking') { b.thinking = b.thinking || ''; }
        blocks[ev.index] = b;
      } else if (t === 'content_block_delta') {
        const b = blocks[ev.index]; if (!b) return;
        const d = ev.delta;
        if (d.type === 'text_delta') b.text += d.text;
        else if (d.type === 'thinking_delta') b.thinking += d.thinking;
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        else if (d.type === 'input_json_delta') b._json += d.partial_json;
        else if (d.type === 'citations_delta' && d.citation) (b.citations = b.citations || []).push(d.citation);
      } else if (t === 'content_block_stop') {
        const b = blocks[ev.index]; if (!b) return;
        if ('_json' in b) { b.input = parseJsonLoose(b._json) || {}; delete b._json; }
      } else if (t === 'message_delta') {
        stopReason = ev.delta?.stop_reason || stopReason;
        if (ev.usage) for (const [k, v] of Object.entries(ev.usage)) if (v !== null && v !== undefined) usage[k] = v;
        if (ev.delta?.container) container = ev.delta.container;
      } else if (t === 'error') {
        throw new Error(ev.error?.message || 'Stream error');
      }
      syncAnthropicSegments(msg);
      onProgress();
    });
  } finally { finalize(); }
  syncAnthropicSegments(msg);
  return {
    blocks: turn.content, stopReason, container,
    usage: { input: usage.input_tokens || 0, output: usage.output_tokens || 0, cacheRead: usage.cache_read_input_tokens || 0, cacheWrite: usage.cache_creation_input_tokens || 0, searches: usage.server_tool_use?.web_search_requests || 0 },
  };
}
function stripThinking(messages) {
  return messages.map((m) => (m.role === 'assistant' && Array.isArray(m.content) ? { ...m, content: m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') } : m));
}

/** Project native Anthropic turns into display segments. */
function syncAnthropicSegments(msg) {
  const segs = [];
  const pending = new Map();
  for (const turn of msg.native.turns) {
    for (const b of turn.content) {
      if (!b) continue;
      if (turn.role === 'user') {
        if (b.type === 'tool_result') { const seg = pending.get(b.tool_use_id); if (seg) seg.status = b.is_error ? 'error' : 'done'; }
        continue;
      }
      switch (b.type) {
        case 'thinking': segs.push({ type: 'thinking', text: b.thinking || '' }); break;
        case 'redacted_thinking': break;
        case 'text': {
          const cites = (b.citations || []).filter((c) => c && c.url).map((c) => ({ url: c.url, title: c.title || c.url }));
          segs.push({ type: 'text', text: b.text || '', citations: cites }); break;
        }
        case 'server_tool_use': case 'tool_use': {
          const input = b.input || {};
          let seg;
          if (b.name === 'web_search') seg = { type: 'tool', kind: 'search', title: 'Searching the web', query: input.query || '', status: 'running', results: [] };
          else if (b.name === 'web_fetch') seg = { type: 'tool', kind: 'fetch', title: 'Reading a web page', query: input.url || '', status: 'running', results: [] };
          else if (b.name === 'code_execution') seg = { type: 'tool', kind: 'code', title: 'Running Python', code: input.code || '', lang: 'python', status: 'running', output: '' };
          else if (b.name === 'bash_code_execution') seg = { type: 'tool', kind: 'bash', title: 'Running a command', code: input.command || '', lang: 'bash', status: 'running', output: '' };
          else if (b.name === 'text_editor_code_execution') seg = { type: 'tool', kind: 'editor', title: editorTitle(input), code: input.file_text || input.new_str || '', lang: langFromPath(input.path), status: 'running', output: '', path: input.path };
          else if (b.name === 'generate_image') seg = { type: 'tool', kind: 'image', title: 'Generating an image', query: (input.prompt || '').slice(0, 120), status: 'running', output: '' };
          else if (b.type === 'tool_use') { const meta = clientToolMeta(b.name); seg = { type: 'tool', kind: meta.kind, title: meta.title, query: clientToolQuery(b.name, input), code: JSON.stringify(input, null, 2), lang: 'json', status: 'running', output: '', toolName: b.name }; }
          else seg = { type: 'tool', kind: 'other', title: b.name || 'Tool', code: JSON.stringify(input, null, 2), status: 'running', output: '' };
          seg.toolId = b.id; pending.set(b.id, seg); segs.push(seg); break;
        }
        case 'web_search_tool_result': {
          const seg = pending.get(b.tool_use_id); if (!seg) break;
          if (Array.isArray(b.content)) { seg.status = 'done'; seg.results = b.content.filter((r) => r.type === 'web_search_result').map((r) => ({ url: r.url, title: r.title || r.url })); }
          else if (b.content?.type === 'web_search_tool_result_error') { seg.status = 'error'; seg.output = b.content.error_code; }
          break;
        }
        case 'web_fetch_tool_result': {
          const seg = pending.get(b.tool_use_id); if (!seg) break;
          if (b.content?.type === 'web_fetch_tool_result_error') { seg.status = 'error'; seg.output = b.content.error_code; }
          else { seg.status = 'done'; const u = b.content?.url; if (u) seg.results = [{ url: u, title: b.content?.content?.title || u }]; }
          break;
        }
        case 'code_execution_tool_result': case 'bash_code_execution_tool_result': case 'text_editor_code_execution_tool_result': {
          const seg = pending.get(b.tool_use_id); if (!seg) break;
          const c = b.content || {};
          if (c.type && /error/.test(c.type)) { seg.status = 'error'; seg.output = c.error_code || 'error'; break; }
          seg.status = c.return_code ? 'error' : 'done';
          let out = [c.stdout, c.stderr].filter(Boolean).join('\n');
          if (c.type === 'text_editor_code_execution_view_result' && typeof c.content === 'string') out = c.content;
          if (c.type === 'text_editor_code_execution_create_result') out = c.is_file_update ? 'File updated.' : 'File created.';
          if (c.type === 'text_editor_code_execution_str_replace_result') out = 'Edit applied.';
          seg.output = out.replace(FILE_MARK_BEGIN, (m, name, size) => `[file transferred: ${name}, ${fmtBytes(+size)}]`);
          const files = Array.isArray(c.content) ? c.content.filter((x) => x && typeof x.file_id === 'string') : [];
          for (const f of files) registerFile(msg, { provider: 'anthropic', fileId: f.file_id });
          break;
        }
        default: break;
      }
    }
  }
  msg.segments = segs;
  const srcs = new Map();
  for (const s of segs) if (s.type === 'text') for (const c of s.citations || []) if (!srcs.has(c.url)) srcs.set(c.url, c.title);
  msg.sources = [...srcs].map(([url, title]) => ({ url, title }));
}
function editorTitle(input) {
  const cmd = input.command || 'edit';
  const p = input.path ? ` ${String(input.path).split('/').pop()}` : '';
  return { view: `Viewing${p}`, create: `Creating${p}`, str_replace: `Editing${p}` }[cmd] || `Editing${p}`;
}
function langFromPath(p = '') {
  const ext = (String(p).split('.').pop() || '').toLowerCase();
  return { py: 'python', js: 'javascript', ts: 'typescript', html: 'html', css: 'css', json: 'json', md: 'markdown', sh: 'bash', xml: 'xml', yaml: 'yaml', yml: 'yaml' }[ext] || '';
}
function registerFile(msg, f) {
  msg.files = msg.files || [];
  const key = f.key || (f.provider === 'anthropic' ? `anthropic:${f.fileId}` : f.provider === 'openai' ? `openai:${f.containerId}:${f.fileId}` : `inline:${msg.id}:${f.fileId || f.name}`);
  let rec = msg.files.find((x) => x.key === key);
  if (rec) return rec;
  rec = { key, status: 'pending', ...f };
  msg.files.push(rec);
  return rec;
}
/** Every file a reply produces becomes a Library artifact (keyed by its cached blob). */
function artifactKind(name = '', mime = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['pptx', 'ppt', 'key', 'odp'].includes(ext)) return 'slides';
  if (['xlsx', 'xls', 'csv', 'tsv', 'ods'].includes(ext)) return 'spreadsheet';
  if (ext === 'pdf') return 'pdf';
  if (['docx', 'doc', 'odt', 'rtf', 'md', 'txt'].includes(ext)) return 'document';
  if (['py', 'js', 'ts', 'html', 'css', 'json', 'ipynb', 'java', 'cpp', 'c', 'cs', 'sql', 'sh'].includes(ext)) return 'code';
  if (['zip', 'tar', 'gz'].includes(ext)) return 'archive';
  return 'other';
}
async function registerArtifact(msg, f) {
  if (!f || f.status !== 'ready' || !f.key) return null;
  try {
    const existing = (await store.all('artifacts')).find((a) => a.fileKey === f.key);
    if (existing) return existing;
    const conv = state.convs.find((c) => c.id === msg.conversationId);
    const art = { id: uid('art'), title: f.name || 'file', kind: artifactKind(f.name, f.mediaType), mediaType: f.mediaType || guessMime(f.name), size: f.size || 0, fileKey: f.key, conversationId: msg.conversationId, conversationTitle: conv?.title || '', messageId: msg.id, tags: [], createdAt: Date.now() };
    await store.put('artifacts', art);
    if (typeof onLibraryChanged === 'function') onLibraryChanged();
    return art;
  } catch (e) { console.warn('[library]', e); return null; }
}
let onLibraryChanged = null;

/** No-relay fallback: pull base64 files out of bash stdout, then scrub the payload from history. */
function extractInlineFiles(msg) {
  const turns = msg.native.turns;
  let scrubbedAt = null; // [turnIdx, blockIdx] of the first scrub
  turns.forEach((turn, ti) => {
    if (turn.role !== 'assistant') return;
    turn.content.forEach((b, bi) => {
      if (!/code_execution_tool_result$/.test(b.type || '')) return;
      const c = b.content; if (!c || typeof c.stdout !== 'string' || !/-----BEGIN FILE /.test(c.stdout)) return;
      let changed = false;
      c.stdout = c.stdout.replace(FILE_MARK_BEGIN, (m, name, size, b64) => {
        changed = true;
        try {
          const blob = base64ToBlob(b64, guessMime(name));
          if (blob.size !== +size) throw new Error(`size mismatch (${blob.size} vs ${size} bytes — output probably truncated)`);
          const rec = registerFile(msg, { provider: 'inline', fileId: `${name}:${size}`, name, mediaType: guessMime(name), size: blob.size });
          rec._blob = blob;
          return `[file transferred to the user: ${name}, ${size} bytes]`;
        } catch (e) {
          registerFile(msg, { provider: 'inline', fileId: `${name}:${size}`, name, mediaType: guessMime(name), size: +size, status: 'error', error: `inline transfer failed: ${e.message}` });
          return `[file transfer failed: ${name}]`;
        }
      });
      // A BEGIN marker with no END means the sandbox truncated the output.
      c.stdout = c.stdout.replace(/-----BEGIN FILE (.+?) (\d+)-----[\s\S]*$/, (m, name, size) => {
        changed = true;
        registerFile(msg, { provider: 'inline', fileId: `${name}:${size}`, name, mediaType: guessMime(name), size: +size, status: 'error', error: 'inline transfer truncated — file too large for this mode; set up the Claude files relay or ask for a smaller file' });
        return `[file transfer truncated: ${name} — too large for inline transfer]`;
      });
      if (changed && !scrubbedAt) scrubbedAt = [ti, bi];
    });
  });
  // The scrub edits the prefix of any thinking block that follows it in this turn; those blocks
  // would be invalid on replay, so drop them now (later messages are bound to the scrubbed text).
  if (scrubbedAt) {
    turns.forEach((turn, ti) => {
      if (turn.role !== 'assistant' || ti < scrubbedAt[0]) return;
      turn.content = turn.content.filter((b, bi) => !((ti > scrubbedAt[0] || bi > scrubbedAt[1]) && (b.type === 'thinking' || b.type === 'redacted_thinking')));
    });
  }
}
async function collectAnthropicFiles(key, msg, onProgress) {
  for (const f of msg.files || []) {
    if (f.status !== 'pending') continue;
    try {
      if (f.provider === 'inline') {
        if (f._blob) { await cacheFileBlob(f.key, f._blob, f.name, f.mediaType); delete f._blob; f.status = 'ready'; }
        else f.status = 'error';
      } else if (f.provider === 'anthropic') {
        if (!relayBase()) { f.status = 'error'; f.error = 'needs the Claude files relay (Settings)'; f.needsRelay = true; continue; }
        const meta = await anthropicFileMeta(key, f.fileId);
        f.name = meta.filename || f.name || f.fileId; f.mediaType = meta.mime_type || guessMime(f.name); f.size = meta.size_bytes;
        const blob = await anthropicFileContent(key, f.fileId);
        await cacheFileBlob(f.key, blob, f.name, f.mediaType);
        f.size = f.size || blob.size; f.status = 'ready';
      }
    } catch (e) { console.warn('[anthropic file]', e); f.status = 'error'; f.error = e.message; }
    if (f.status === 'ready') await registerArtifact(msg, f);
    onProgress();
  }
  // Images produced by a client tool (generate_image) are already registered as inline files.
}

/** Client-side tool execution for Claude: app tools return text; generate_image returns an image block too. */
async function runClientTool(call, msg) {
  if (call.name !== 'generate_image') {
    const r = await executeClientTool(call.name, call.input || {}, { msg, conv: activeConv() });
    return { content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content), summary: r.summary || '' };
  }
  const okey = settings.openaiKey.trim();
  if (!okey) throw new Error('No OpenAI key for image generation');
  const input = call.input || {};
  const size = ['1024x1024', '1536x1024', '1024x1536'].includes(input.size) ? input.size : '1024x1024';
  const res = await fetch(`${SPEC.openai.base}/v1/images/generations`, { method: 'POST', headers: openaiHeaders(okey), body: JSON.stringify({ model: settings.imageModel || 'gpt-image-2', prompt: String(input.prompt || ''), size, n: 1, output_format: 'png' }) });
  if (!res.ok) throw await openaiError(res);
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image returned');
  const name = `image-${Date.now().toString(36)}.png`;
  const full = base64ToBlob(b64, 'image/png');
  const rec = registerFile(msg, { provider: 'inline', fileId: name, name, mediaType: 'image/png', size: full.size });
  await cacheFileBlob(rec.key, full, name, 'image/png'); rec.status = 'ready';
  await registerArtifact(msg, rec);
  // The model only needs a small preview; the full-size file is for the user. Keeps history light.
  let preview = { media_type: 'image/png', data: b64 };
  try {
    const bmp = await createImageBitmap(full);
    const out = await drawScaled(bmp, 512, 'image/jpeg', 0.8); bmp.close?.();
    preview = { media_type: 'image/jpeg', data: arrayBufferToBase64(await out.blob.arrayBuffer()) };
  } catch { /* fall back to the full image */ }
  return { content: [{ type: 'text', text: `Image generated (${size}) and shown to the user as ${name}. A reduced preview follows.` }, { type: 'image', source: { type: 'base64', ...preview } }], summary: `${size} image` };
}

/* ───────────────────────────── OpenAI adapter ───────────────────────────── */
function openaiHeaders(key, json = true) {
  const h = { Authorization: `Bearer ${key}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
async function openaiError(res) {
  let detail = '';
  try { const b = await res.json(); detail = b?.error?.message || JSON.stringify(b); } catch { try { detail = await res.text(); } catch { /* ignore */ } }
  const base = res.status === 401 ? 'Invalid OpenAI API key.' : res.status === 429 ? 'OpenAI rate limit / quota reached — check billing or retry shortly.' : res.status >= 500 ? `OpenAI server error (${res.status}).` : `OpenAI error ${res.status}.`;
  const e = new Error(detail ? `${base} ${detail}` : base);
  e.status = res.status; e.detail = detail || ''; e.provider = 'openai';
  return e;
}
async function openaiUploadFile(key, blob, filename, purpose = 'user_data') {
  const fd = new FormData();
  fd.append('purpose', purpose);
  fd.append('file', blob, filename);
  const res = await fetch(`${SPEC.openai.base}/v1/files`, { method: 'POST', headers: openaiHeaders(key, false), body: fd });
  if (!res.ok) throw await openaiError(res);
  return res.json();
}
async function openaiListContainerFiles(key, containerId) {
  const res = await fetch(`${SPEC.openai.base}/v1/containers/${containerId}/files?limit=100&order=desc`, { headers: openaiHeaders(key, false) });
  if (!res.ok) throw await openaiError(res);
  return (await res.json()).data || [];
}
async function openaiContainerFileContent(key, containerId, fileId) {
  const res = await fetch(`${SPEC.openai.base}/v1/containers/${containerId}/files/${fileId}/content`, { headers: openaiHeaders(key, false) });
  if (!res.ok) throw await openaiError(res);
  return res.blob();
}
function openaiCaps(model) {
  const m = model.toLowerCase();
  const reasoning = /^o\d/.test(m) || /^gpt-(5|[6-9]|\d{2})/.test(m);
  return { reasoning };
}

/** Build Responses `input`; chain with previous_response_id when the last assistant turn is an OpenAI one. */
function buildOpenAIInput(chain, { codeTools }) {
  let anchor = -1;
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    if (m.role === 'assistant') { if (m.native?.provider === 'openai' && m.native.responseId && !m.error) anchor = i; break; }
  }
  const items = [];
  let fileBudget = SPEC.openai.inputFileMaxBytes; // combined input_file limit per request
  for (const m of (anchor >= 0 ? chain.slice(anchor + 1) : chain)) {
    if (m.role === 'user') {
      const content = [];
      const asInput = new Map();
      for (const a of m.attachments || []) {
        if (a.kind === 'image' && a.base64) { content.push({ type: 'input_image', image_url: `data:${a.mediaType};base64,${a.base64}`, detail: 'high' }); continue; }
        const ext = (a.name.split('.').pop() || '').toLowerCase();
        const nativeOk = SPEC.openai.inputFileExt.has(ext) && a.size <= fileBudget;
        if (a.openaiFileId && nativeOk) { content.push({ type: 'input_file', file_id: a.openaiFileId }); fileBudget -= a.size; asInput.set(a.id, true); }
        else if (a.kind === 'pdf' && a.base64 && nativeOk) { content.push({ type: 'input_file', filename: a.name, file_data: `data:application/pdf;base64,${a.base64}` }); fileBudget -= a.size; asInput.set(a.id, true); }
        else if (a.text) content.push({ type: 'input_text', text: `<file name="${a.name}"${a.textTruncated ? ' truncated="true"' : ''}>\n${a.text}\n</file>` });
      }
      const notes = (m.attachments || []).map((a) => describeAttachment(a, 'openai', codeTools, { openaiInputFile: asInput.has(a.id) })).filter(Boolean);
      let text = m.text || '';
      if (notes.length) text = `${notes.join('\n')}\n\n${text}`.trim();
      content.push({ type: 'input_text', text: text || '(see attachments)' });
      items.push({ role: 'user', content });
    } else if (m.role === 'assistant') {
      const t = (m.text || '').trim();
      if (t) items.push({ role: 'assistant', content: [{ type: 'output_text', text: t }] });
    }
  }
  return { items, previousResponseId: anchor >= 0 ? chain[anchor].native.responseId : null };
}

async function runOpenAI({ conv, chain, msg, signal, onProgress }) {
  const key = keyFor('openai');
  const model = settings.openaiModel;
  const codeTools = !!conv.codeTools;
  const webSearch = !!conv.webSearch;
  const imageTool = !!settings.imageGen;
  const caps = openaiCaps(model);

  await ensureOpenAIUploads(chain, key, codeTools, onProgress);
  const fileIds = [...new Set(chain.flatMap((m) => (m.attachments || []).filter((a) => a.openaiFileId && a.kind !== 'image').map((a) => a.openaiFileId)))].slice(-50);

  const loc = locationFromTimezone(settings.timezone);
  const tools = [];
  if (webSearch) tools.push({ type: 'web_search', search_context_size: 'medium', user_location: { type: 'approximate', ...(loc.country ? { country: loc.country } : {}), ...(loc.city ? { city: loc.city } : {}), ...(loc.region ? { region: loc.region } : {}), timezone: loc.timezone } });
  if (codeTools) tools.push({ type: 'code_interpreter', container: { type: 'auto', ...(fileIds.length ? { file_ids: fileIds } : {}) } });
  if (imageTool) tools.push({ type: 'image_generation', output_format: 'png', ...(settings.imageModel && settings.imageModel !== 'gpt-image-2' ? { model: settings.imageModel } : {}) });
  // App tools (tasks, timetable, library) as function tools.
  for (const t of clientToolDefs({ imageTool: false })) tools.push({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema });

  const { items, previousResponseId } = buildOpenAIInput(chain, { codeTools });
  const body = {
    model,
    instructions: buildSystemPrompt('openai', { codeTools, webSearch, imageTool, conv }),
    input: items,
    stream: true,
    store: true,
    max_output_tokens: settings.maxTokens || SPEC.openai.maxTokensDefault,
    include: ['code_interpreter_call.outputs', 'web_search_call.action.sources'],
    truncation: 'auto',
  };
  if (tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  if (previousResponseId) body.previous_response_id = previousResponseId;
  if (caps.reasoning) body.reasoning = { effort: settings.effort, summary: 'auto' };

  msg.native = { provider: 'openai', items: [], responseId: null };
  msg.segments = [];
  const fullHistory = () => { delete body.previous_response_id; body.input = buildOpenAIInput(chain.map((m) => (m.role === 'assistant' ? { ...m, native: null } : m)), { codeTools }).items; };
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`${SPEC.openai.base}/v1/responses`, { method: 'POST', headers: openaiHeaders(key), body: JSON.stringify(body), signal });
    if (res.ok) {
      let round = await openaiReadStream(res, key, msg, conv, signal, onProgress);
      // Function-call loop: run the app tools, send their outputs back chained to this response.
      for (let hops = 0; hops < 10 && round.functionCalls.length && !signal.aborted; hops++) {
        const outputs = [];
        for (const fc of round.functionCalls) {
          const seg = fc.seg;
          try {
            const r = await executeClientTool(fc.name, parseJsonLoose(fc.arguments) || {}, { msg, conv });
            outputs.push({ type: 'function_call_output', call_id: fc.call_id, output: typeof r.content === 'string' ? r.content : JSON.stringify(r.content) });
            if (seg) { seg.status = 'done'; seg.output = r.summary || ''; }
          } catch (e) {
            outputs.push({ type: 'function_call_output', call_id: fc.call_id, output: JSON.stringify({ error: e.message }) });
            if (seg) { seg.status = 'error'; seg.output = e.message; }
          }
          onProgress();
        }
        const cont = { ...body, previous_response_id: msg.native.responseId, input: outputs };
        const res2 = await fetch(`${SPEC.openai.base}/v1/responses`, { method: 'POST', headers: openaiHeaders(key), body: JSON.stringify(cont), signal });
        if (!res2.ok) throw await openaiError(res2);
        round = await openaiReadStream(res2, key, msg, conv, signal, onProgress);
      }
      return;
    }
    const err = await openaiError(res);
    const d = err.detail || '';
    if (err.status !== 400 && err.status !== 404) throw err;
    if (/effort/i.test(d) && body.reasoning) {
      const chainE = ['max', 'xhigh', 'high', 'medium', 'low'];
      const i = chainE.indexOf(body.reasoning.effort);
      if (i >= 0 && i < chainE.length - 1) { body.reasoning.effort = chainE[i + 1]; continue; }
      delete body.reasoning; continue;
    }
    if (/summary/i.test(d) && body.reasoning?.summary) { delete body.reasoning.summary; continue; }
    if (/previous_response/i.test(d) && body.previous_response_id) { fullHistory(); continue; }
    if (/container/i.test(d) && /expired|not found|no longer/i.test(d)) {
      // The sandbox tied to the response chain is gone: restart from full history with a fresh container.
      conv.openaiContainerId = null;
      if (body.previous_response_id) { fullHistory(); continue; }
      throw err;
    }
    if (/include/i.test(d) && body.include) { delete body.include; continue; }
    if (/truncation/i.test(d) && body.truncation) { delete body.truncation; continue; }
    if (/user_location/i.test(d) && body.tools) { body.tools = body.tools.map((t) => { const { user_location, ...rest } = t; return rest; }); continue; }
    if (/image_generation/i.test(d) && body.tools?.some((t) => t.type === 'image_generation')) { body.tools = body.tools.filter((t) => t.type !== 'image_generation'); if (!body.tools.length) delete body.tools; continue; }
    if (/input_file|file_id|unsupported file/i.test(d) && body.input.some((it) => it.content?.some?.((c) => c.type === 'input_file'))) {
      // A file the API won't parse natively: keep it for the container only.
      body.input = body.input.map((it) => (it.content ? { ...it, content: it.content.filter((c) => c.type !== 'input_file') } : it));
      continue;
    }
    if (/max_output_tokens/i.test(d)) { const n = (d.match(/\d{4,7}/g) || []).map(Number); if (n.length) { body.max_output_tokens = Math.min(...n); continue; } }
    throw err;
  }
}

async function ensureOpenAIUploads(chain, key, codeTools, onProgress) {
  for (const m of chain) {
    if (m.role !== 'user') continue;
    let changed = false;
    for (const a of m.attachments || []) {
      if (a.kind === 'image' || a.openaiFileId || a.openaiUploadFailed) continue;
      const ext = (a.name.split('.').pop() || '').toLowerCase();
      const nativeOk = SPEC.openai.inputFileExt.has(ext) && a.size <= SPEC.openai.inputFileMaxBytes;
      if (!nativeOk && !codeTools) continue; // nothing could consume it
      const blob = await getAttachmentBlob(a);
      if (!blob) continue;
      try {
        a.uploading = true; onProgress();
        const meta = await openaiUploadFile(key, blob, safeFilename(a.name), 'user_data');
        a.openaiFileId = meta.id; changed = true;
      } catch (e) { console.warn('[openai upload]', e); a.openaiUploadFailed = true; a.uploadError = e.message; }
      finally { a.uploading = false; }
    }
    if (changed) await store.put('messages', m);
  }
}

/** Read a Responses API SSE stream into msg.segments / msg.files. */
async function openaiReadStream(res, key, msg, conv, signal, onProgress) {
  const items = [];                      // this round's output items, by output_index
  const byId = new Map();
  const segOf = new Map();
  const segs = msg.segments = msg.segments || [];
  const functionCalls = [];
  let usage = null;
  let turnStart = Math.floor(Date.now() / 1000) - 30; // replaced by the server's created_at below
  const itemFor = (ev) => {
    if (ev.item) { const it = structuredClone(ev.item); items[ev.output_index] = it; if (it.id) byId.set(it.id, it); return it; }
    return items[ev.output_index] || byId.get(ev.item_id) || null;
  };
  const segFor = (it) => {
    if (!it) return null;
    const k = it.id || `idx${items.indexOf(it)}`;
    if (segOf.has(k)) return segOf.get(k);
    let seg = null;
    switch (it.type) {
      case 'reasoning': seg = { type: 'thinking', text: '' }; break;
      case 'message': seg = { type: 'text', text: '', citations: [] }; break;
      case 'web_search_call': seg = { type: 'tool', kind: 'search', title: 'Searching the web', query: it.action?.query || it.action?.url || '', status: 'running', results: [] }; break;
      case 'code_interpreter_call': seg = { type: 'tool', kind: 'code', title: 'Running Python', code: it.code || '', lang: 'python', status: 'running', output: '' }; break;
      case 'image_generation_call': seg = { type: 'tool', kind: 'image', title: 'Generating an image', status: 'running', output: '' }; break;
      case 'file_search_call': seg = { type: 'tool', kind: 'search', title: 'Searching files', query: (it.queries || []).join(', '), status: 'running', results: [] }; break;
      case 'shell_call': seg = { type: 'tool', kind: 'bash', title: 'Running a command', code: (it.action?.commands || []).join('\n'), lang: 'bash', status: 'running', output: '' }; break;
      case 'function_call': { const meta = clientToolMeta(it.name); seg = { type: 'tool', kind: meta.kind, title: meta.title, code: it.arguments || '', lang: 'json', status: 'running', output: '', toolName: it.name }; break; }
      default: return null;
    }
    segOf.set(k, seg); segs.push(seg); return seg;
  };

  await readSse(res, signal, (ev) => {
    const t = ev.type;
    if (t === 'response.created') { msg.native.responseId = ev.response?.id || msg.native.responseId; if (ev.response?.created_at) turnStart = ev.response.created_at - 2; }
    else if (t === 'response.output_item.added') segFor(itemFor(ev));
    else if (t === 'response.output_item.done') {
      const it = itemFor(ev); const seg = segFor(it); if (!seg) return;
      if (it.type === 'message') {
        const part = (it.content || []).find((c) => c.type === 'output_text');
        if (part) { seg.text = part.text ?? seg.text; applyAnnotations(seg, part.annotations || [], msg); }
        const refusal = (it.content || []).find((c) => c.type === 'refusal');
        if (refusal) seg.text = (seg.text ? seg.text + '\n\n' : '') + refusal.refusal;
      } else if (it.type === 'reasoning') {
        const txt = (it.summary || []).map((s) => s.text).filter(Boolean).join('\n\n');
        if (txt) seg.text = txt;
      } else if (it.type === 'web_search_call') {
        seg.status = it.status === 'failed' ? 'error' : 'done';
        if (it.action?.query) seg.query = it.action.query;
        if (it.action?.type === 'open_page' && it.action.url) { seg.kind = 'fetch'; seg.title = 'Reading a web page'; seg.query = it.action.url; }
        if (Array.isArray(it.action?.sources)) seg.results = it.action.sources.map((s) => ({ url: s.url, title: s.title || s.url }));
      } else if (it.type === 'code_interpreter_call') {
        seg.status = it.status === 'failed' ? 'error' : 'done';
        if (it.code) seg.code = it.code;
        if (it.container_id) conv.openaiContainerId = it.container_id;
        const outs = Array.isArray(it.outputs) ? it.outputs : [];
        const logs = outs.filter((o) => o.type === 'logs').map((o) => o.logs).join('\n');
        if (logs) seg.output = logs;
        for (const o of outs) if (o.type === 'image' && o.url) seg.images = [...(seg.images || []), o.url];
      } else if (it.type === 'image_generation_call') {
        seg.status = it.status === 'failed' ? 'error' : 'done';
        if (it.revised_prompt) seg.query = it.revised_prompt.slice(0, 120);
        if (it.result) {
          const fmt = it.output_format || 'png';
          const name = `image-${(it.id || uid()).slice(-6)}.${fmt}`;
          const rec = registerFile(msg, { provider: 'inline', fileId: it.id || name, name, mediaType: `image/${fmt}` });
          rec._b64 = it.result;
          it.result = '[image stored locally]';
        }
      } else if (it.type === 'shell_call') { seg.status = 'done'; }
      else if (it.type === 'function_call') {
        seg.code = it.arguments || seg.code;
        seg.query = clientToolQuery(it.name, parseJsonLoose(it.arguments || '') || {});
        functionCalls.push({ call_id: it.call_id, name: it.name, arguments: it.arguments || '{}', seg });
      }
    } else if (t === 'response.function_call_arguments.delta') { const seg = segFor(itemFor(ev)); if (seg) seg.code += ev.delta || ''; }
    else if (t === 'response.function_call_arguments.done') { const seg = segFor(itemFor(ev)); if (seg) seg.code = ev.arguments || seg.code; }
    else if (t === 'response.output_text.delta') { const seg = segFor(itemFor(ev)); if (seg) seg.text += ev.delta || ''; }
    else if (t === 'response.output_text.annotation.added') { const seg = segFor(itemFor(ev)); if (seg) applyAnnotations(seg, [ev.annotation], msg); }
    else if (t === 'response.reasoning_summary_text.delta' || t === 'response.reasoning_text.delta') { const seg = segFor(itemFor(ev)); if (seg) seg.text += ev.delta || ''; }
    else if (t === 'response.reasoning_summary_part.added') { const seg = segFor(itemFor(ev)); if (seg && seg.text && !seg.text.endsWith('\n\n')) seg.text += '\n\n'; }
    else if (t === 'response.code_interpreter_call_code.delta') { const seg = segFor(itemFor(ev)); if (seg) seg.code += ev.delta || ''; }
    else if (t === 'response.code_interpreter_call_code.done') { const seg = segFor(itemFor(ev)); if (seg) seg.code = ev.code || seg.code; }
    else if (t === 'response.shell_call_output_content.delta') { const seg = segFor(itemFor(ev)); if (seg) seg.output += ev.delta || ''; }
    else if (t === 'response.completed' || t === 'response.incomplete' || t === 'response.failed') {
      const r = ev.response || {};
      msg.native.responseId = r.id || msg.native.responseId;
      usage = r.usage || usage;
      msg.stopReason = t === 'response.completed' ? 'end_turn' : (r.incomplete_details?.reason || r.status || t);
      if (t === 'response.failed') throw new Error(r.error?.message || 'The response failed.');
    } else if (t === 'error') throw new Error(ev.message || ev.error?.message || 'Stream error');
    onProgress();
  });

  if (usage) msg.usage = addUsage(msg.usage, { input: usage.input_tokens || 0, output: usage.output_tokens || 0, cacheRead: usage.input_tokens_details?.cached_tokens || 0, reasoning: usage.output_tokens_details?.reasoning_tokens || 0 });
  if (conv.openaiContainerId) await store.put('conversations', conv);

  // Discover files the code wrote even when the model forgot to cite them.
  const ranCode = items.some((it) => it && it.type === 'code_interpreter_call');
  if (ranCode && conv.openaiContainerId) {
    try {
      const list = await openaiListContainerFiles(key, conv.openaiContainerId);
      for (const cf of list) {
        if (cf.source !== 'assistant' || (cf.created_at && cf.created_at < turnStart)) continue;
        const name = (cf.path || cf.id).split('/').pop();
        if (/^\.|~$|\.(pyc|tmp|log)$/i.test(name)) continue;
        registerFile(msg, { provider: 'openai', fileId: cf.id, containerId: conv.openaiContainerId, name, size: cf.bytes, mediaType: guessMime(name) });
      }
    } catch (e) { console.warn('[openai list files]', e); }
  }
  for (const f of msg.files || []) {
    if (f.status !== 'pending') continue;
    try {
      if (f.provider === 'inline' && f._b64) {
        const blob = base64ToBlob(f._b64, f.mediaType); delete f._b64;
        await cacheFileBlob(f.key, blob, f.name, f.mediaType); f.size = blob.size; f.status = 'ready';
      } else if (f.provider === 'openai') {
        f.name = f.name || f.fileId; f.mediaType = f.mediaType || guessMime(f.name);
        const blob = await openaiContainerFileContent(key, f.containerId, f.fileId);
        await cacheFileBlob(f.key, blob, f.name, f.mediaType); f.size = f.size || blob.size; f.status = 'ready';
      }
    } catch (e) { console.warn('[openai file]', e); f.status = 'error'; f.error = e.message; }
    if (f.status === 'ready') await registerArtifact(msg, f);
    onProgress();
  }
  dedupeSources(msg);
  msg.native.items.push(...items.filter(Boolean));
  return { functionCalls };
}
function applyAnnotations(seg, annotations, msg) {
  for (const a of annotations) {
    if (!a) continue;
    if (a.type === 'url_citation' && a.url) { if (!seg.citations.some((c) => c.url === a.url)) seg.citations.push({ url: a.url, title: a.title || a.url }); }
    else if (a.type === 'container_file_citation' && a.file_id) {
      const name = a.filename ? a.filename.split('/').pop() : undefined;
      const f = registerFile(msg, { provider: 'openai', fileId: a.file_id, containerId: a.container_id, name, mediaType: name ? guessMime(name) : undefined });
      if (name && !f.name) f.name = name;
    }
  }
}
function dedupeSources(msg) {
  const srcs = new Map();
  for (const s of msg.segments || []) if (s.type === 'text') for (const c of s.citations || []) if (c.url && !srcs.has(c.url)) srcs.set(c.url, c.title);
  msg.sources = [...srcs].map(([url, title]) => ({ url, title }));
}

/* ───────────────────────────── Shared helpers ───────────────────────────── */
async function readSse(res, signal, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const dispatch = (chunk) => {
    const dataLines = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart());
    if (!dataLines.length) return;
    const data = dataLines.join('\n');
    if (data === '[DONE]') return;
    const ev = parseJsonLoose(data);
    if (ev) onEvent(ev);
  };
  let ok = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
        const sepLen = buf[idx] === '\r' ? (buf.slice(idx, idx + 4) === '\r\n\r\n' ? 4 : 3) : (buf.slice(idx, idx + 2) === '\n\n' ? 2 : 3);
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + sepLen);
        dispatch(chunk);
      }
      if (signal?.aborted) break;
    }
    buf += decoder.decode();
    if (buf.trim()) dispatch(buf); // final event without a trailing blank line
    ok = true;
  } finally {
    if (!ok || signal?.aborted) { try { await reader.cancel(); } catch { /* ignore */ } }
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}
function addUsage(a = null, b = null) {
  if (!b) return a;
  const out = { ...(a || {}) };
  for (const k of Object.keys(b)) out[k] = (out[k] || 0) + (b[k] || 0);
  return out;
}
async function cacheFileBlob(key, blob, name, mediaType) { await store.put('files', { key, blob, name, mediaType, size: blob.size, createdAt: Date.now() }); }
async function getCachedFile(key) { return store.get('files', key); }
async function fileUrl(key) {
  if (state.fileBlobUrls.has(key)) return state.fileBlobUrls.get(key);
  const rec = await getCachedFile(key);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  state.fileBlobUrls.set(key, url);
  return url;
}
async function getAttachmentBlob(a) {
  if (a.blobKey) { const rec = await getCachedFile(a.blobKey); if (rec) return rec.blob; }
  if (a.base64) return base64ToBlob(a.base64, a.mediaType);
  return null;
}
function findFileByName(name) {
  const base = String(name).split('/').pop();
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const f = (state.messages[i].files || []).find((x) => x.status === 'ready' && (x.name === base || x.name === name));
    if (f) return f;
  }
  return null;
}

/* ───────────────────────────── Attachment preparation ───────────────────────────── */
async function prepareAttachment(file) {
  const name = file.name || 'file';
  const mediaType = file.type || guessMime(name);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const att = { id: uid('att'), name, mediaType, size: file.size, kind: 'other' };
  if (file.size > SPEC.attachmentMaxBytes) throw new Error(`${name} is larger than ${fmtBytes(SPEC.attachmentMaxBytes)}.`);

  if (mediaType.startsWith('image/') && mediaType !== 'image/svg+xml') {
    const { blob, type } = await compressImage(file);
    if (!SPEC.imageTypes.has(type)) throw new Error(`${name} could not be converted to a supported image format (JPEG, PNG, GIF, WebP).`);
    att.kind = 'image'; att.mediaType = type; att.size = blob.size;
    att.base64 = arrayBufferToBase64(await blob.arrayBuffer());
    return att;
  }
  const buf = await file.arrayBuffer();
  att.blobKey = `att:${att.id}`;
  await cacheFileBlob(att.blobKey, new Blob([buf], { type: mediaType }), name, mediaType);
  if (mediaType === 'application/pdf' || ext === 'pdf') {
    att.kind = 'pdf'; att.mediaType = 'application/pdf';
    if (buf.byteLength <= SPEC.anthropic.pdfMaxBytes) att.base64 = arrayBufferToBase64(buf);
    att.pages = countPdfPages(buf);
    return att;
  }
  try {
    if (ext === 'docx' && window.mammoth) {
      let r; try { r = await mammoth.convertToMarkdown({ arrayBuffer: buf }); } catch { r = await mammoth.extractRawText({ arrayBuffer: buf }); }
      setText(att, r.value || ''); att.kind = 'docx';
    } else if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext) && window.XLSX) {
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
      const parts = wb.SheetNames.map((sn) => `### Sheet: ${sn}\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn], { blankrows: false })}`);
      setText(att, parts.join('\n\n')); att.kind = 'spreadsheet';
    } else if (ext === 'pptx') {
      att.kind = 'pptx';
    } else if (TEXTLIKE_EXT.has(ext) || mediaType.startsWith('text/') || mediaType === 'application/json') {
      setText(att, new TextDecoder().decode(buf)); att.kind = 'text';
    }
  } catch (e) { console.warn('[extract]', name, e); }
  return att;
}
function setText(att, text) {
  text = (text || '').replace(/\r\n/g, '\n').trim();
  if (text.length > SPEC.textExtractCap) { att.text = text.slice(0, SPEC.textExtractCap) + `\n\n…[truncated — ${(text.length - SPEC.textExtractCap).toLocaleString()} more characters]`; att.textTruncated = true; }
  else att.text = text;
}
function countPdfPages(buf) {
  try {
    const s = new TextDecoder('latin1').decode(new Uint8Array(buf.slice(0, Math.min(buf.byteLength, 4 * 1024 * 1024))));
    const m = s.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
    if (m) return parseInt(m[1], 10);
    const n = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
    return n || undefined;
  } catch { return undefined; }
}
async function compressImage(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return { blob: file, type: file.type }; // undecodable (e.g. HEIC) → caller rejects it
  const big = Math.max(bmp.width, bmp.height) > SPEC.imageMaxDim;
  const supported = SPEC.imageTypes.has(file.type);
  if (supported && file.size <= SPEC.imageMaxBytes && !big) { bmp.close?.(); return { blob: file, type: file.type }; }
  let maxDim = SPEC.imageMaxDim;
  const keepPng = (file.type === 'image/png' || !supported) && file.size <= SPEC.imageMaxBytes; // BMP/TIFF/AVIF → lossless PNG when small enough
  for (const q of [0.9, 0.82, 0.72, 0.6, 0.5]) {
    const out = await drawScaled(bmp, maxDim, keepPng ? 'image/png' : 'image/jpeg', q);
    if (out.blob.size <= SPEC.imageMaxBytes) { bmp.close?.(); return out; }
    maxDim = Math.round(maxDim * 0.85);
  }
  bmp.close?.();
  return { blob: file, type: file.type };
}
async function drawScaled(bmp, maxDim, type, quality) {
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, type, quality));
  return { blob, type };
}

/* ───────────────────────────── Conversations ───────────────────────────── */
async function loadConversations() {
  const all = await store.all('conversations');
  // Chats started while "Save chat history" was off last only for that session.
  const keep = [];
  for (const c of all) { if (c.ephemeral) await purgeConversation(c.id); else keep.push(c); }
  state.convs = keep.sort((a, b) => b.updatedAt - a.updatedAt);
}
async function purgeConversation(id) {
  state.purged.add(id);
  const msgs = await store.byIndex('messages', 'conversationId', id);
  for (const m of msgs) {
    for (const a of m.attachments || []) if (a.blobKey) await store.del('files', a.blobKey).catch(() => {});
    for (const f of m.files || []) if (f.key) await store.del('files', f.key).catch(() => {});
    await store.del('messages', m.id);
  }
  await store.del('conversations', id);
}
async function createConversation() {
  const conv = {
    id: uid('conv'), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(),
    provider: settings.provider, model: currentModel(),
    webSearch: settings.webSearch, codeTools: settings.codeTools,
    anthropicContainerId: null, anthropicContainerExpiresAt: null, openaiContainerId: null,
    ephemeral: !settings.saveHistory,
    memory: !!settings.memoryEnabled, memorySnapshot: null,
  };
  await store.put('conversations', conv);
  state.convs.unshift(conv);
  return conv;
}
function activeConv() { return state.convs.find((c) => c.id === state.activeConvId) || null; }
async function selectConversation(id) {
  state.activeConvId = id;
  const conv = activeConv();
  if (conv) {
    const msgs = await store.byIndex('messages', 'conversationId', id);
    state.messages = msgs.sort((a, b) => a.createdAt - b.createdAt);
    setToggle($('#tglWeb'), conv.webSearch);
    setToggle($('#tglCode'), conv.codeTools);
    setToggle($('#tglMemory'), conv.memory);
  } else {
    state.messages = [];
    setToggle($('#tglWeb'), settings.webSearch);
    setToggle($('#tglCode'), settings.codeTools);
    setToggle($('#tglMemory'), settings.memoryEnabled);
  }
  renderConvList();
  renderMessages();
  $('#convTitle').textContent = conv?.title || 'New chat';
  if (window.innerWidth < 1024) collapseSidebar(true);
}
async function deleteConversation(id) {
  state.busy.get(id)?.abort();
  state.purged.add(id);
  const msgs = await store.byIndex('messages', 'conversationId', id);
  for (const m of msgs) {
    for (const a of m.attachments || []) if (a.blobKey) await store.del('files', a.blobKey).catch(() => {});
    for (const f of m.files || []) if (f.key) await store.del('files', f.key).catch(() => {});
    await store.del('messages', m.id);
  }
  await store.del('conversations', id);
  state.convs = state.convs.filter((c) => c.id !== id);
  if (state.activeConvId === id) await selectConversation(state.convs[0]?.id || null);
  else renderConvList();
}
async function touchConversation(conv) {
  conv.updatedAt = Date.now();
  await store.put('conversations', conv);
  state.convs.sort((a, b) => b.updatedAt - a.updatedAt);
  renderConvList();
}
async function maybeAutoTitle(conv) {
  if (!conv || (conv.title && conv.title !== 'New chat')) return;
  const first = state.messages.find((m) => m.conversationId === conv.id && m.role === 'user');
  if (!first) return;
  let title = (first.text || first.attachments?.map((a) => a.name).join(', ') || 'New chat').replace(/\s+/g, ' ').trim();
  title = title.split(/(?<=[.?!])\s/)[0].slice(0, 60);
  if (title.length === 60) title = title.replace(/\s+\S*$/, '') + '…';
  conv.title = title || 'New chat';
  await store.put('conversations', conv);
  renderConvList();
  if (state.activeConvId === conv.id) $('#convTitle').textContent = conv.title;
}

/* ───────────────────────────── Sending ───────────────────────────── */
function activeChain() { return state.messages.filter((m) => m.conversationId === state.activeConvId); }

async function sendMessage(text, attachments) {
  const wanted = settings.provider;
  let provider = ensureUsableProvider();
  if (!provider) {
    showBanner('err', wanted === 'local' ? 'Choose an on-device model first.' : 'No AI set up yet. Add a Claude (Anthropic) or OpenAI key in <b>Settings</b> — or <a href="#" data-act="local">use free on-device AI</a>.');
    if (wanted === 'local') openLocalAISheet(); else openSettings();
    return;
  }
  if (provider !== wanted) {
    if (provider !== 'local' && !state.models[provider]?.live) await fetchModels(provider);
    renderModelSelect(); updateComposerState();
    showBanner('warn', wanted === 'local'
      ? `No on-device model is chosen, so this was sent with <b>${providerName(provider)}</b>. <a href="#" data-act="local">Choose an on-device model</a>.`
      : `There's no ${providerName(wanted)} key, so this was sent with <b>${providerName(provider)}${provider === 'local' ? ` (${escapeHtml(localModelName(settings.localModel))})` : ''}</b>. Add a ${providerName(wanted)} key in Settings to use ${providerName(wanted)}.`);
  }
  if (provider !== 'local' && !currentModel()) { await fetchModels(provider); renderModelSelect(); }
  const viaProvider = turnProvider();
  if (viaProvider === 'local' && provider !== 'local') showBanner('info', `You're offline, so this reply comes from <b>${escapeHtml(localModelName(settings.localModel))}</b> on this device. Claude and OpenAI need an internet connection.`);
  else if (provider !== 'local' && navigator.onLine === false) showBanner('warn', `You're offline — ${providerName(provider)} needs an internet connection. <a href="#" data-act="local">Set up on-device AI</a> while online to keep working offline.`);
  provider = viaProvider;
  let conv = activeConv();
  if (!conv) { conv = await createConversation(); state.activeConvId = conv.id; state.messages = []; renderConvList(); }
  if (state.busy.has(conv.id)) return;
  conv.provider = provider; conv.model = provider === 'local' ? settings.localModel : currentModel();
  conv.webSearch = $('#tglWeb').classList.contains('on');
  conv.codeTools = $('#tglCode').classList.contains('on');
  const wantMemory = $('#tglMemory').classList.contains('on');
  if (wantMemory !== !!conv.memory) { conv.memory = wantMemory; conv.memorySnapshot = null; }
  if (conv.memory && !conv.memorySnapshot) conv.memorySnapshot = await buildMemorySnapshot(conv.id);
  await store.put('conversations', conv);

  const userMsg = { id: uid('msg'), conversationId: conv.id, role: 'user', createdAt: nowStamp(), text, attachments: attachments.map((a) => ({ ...a })) };
  await store.put('messages', userMsg);
  state.messages.push(userMsg);
  await runAssistantTurn(conv, activeChain());
}

function runAssistantTurn(conv, chain) {
  const p = runAssistantTurnInner(conv, chain).finally(() => { if (state.turns.get(conv.id) === p) state.turns.delete(conv.id); });
  state.turns.set(conv.id, p);
  return p;
}
async function runAssistantTurnInner(conv, chain) {
  const provider = turnProvider();
  const assistant = { id: uid('msg'), conversationId: conv.id, role: 'assistant', createdAt: nowStamp(), text: '', segments: [], files: [], provider, model: provider === 'local' ? settings.localModel : currentModel(), status: 'streaming' };
  await store.put('messages', assistant);
  state.messages.push(assistant);
  renderMessages();
  scrollToBottom(true);

  const controller = new AbortController();
  state.busy.set(conv.id, controller);
  updateComposerState();
  renderConvList();
  await touchConversation(conv);

  let lastPersist = 0;
  const onProgress = () => {
    assistant.text = (assistant.segments || []).filter((s) => s.type === 'text').map((s) => s.text).join('\n\n');
    scheduleRender(assistant);
    const now = Date.now();
    if (now - lastPersist > 2000 && !state.purged.has(conv.id)) { lastPersist = now; store.put('messages', assistant).catch(() => {}); }
  };
  try {
    if (provider === 'anthropic') await runAnthropic({ conv, chain, msg: assistant, signal: controller.signal, onProgress });
    else if (provider === 'local') await runLocal({ conv, chain, msg: assistant, signal: controller.signal, onProgress });
    else await runOpenAI({ conv, chain, msg: assistant, signal: controller.signal, onProgress });
    if (controller.signal.aborted) assistant.stopReason = 'stopped';
  } catch (e) {
    if (controller.signal.aborted || e.name === 'AbortError') assistant.stopReason = 'stopped';
    else { assistant.error = e.message || String(e); console.error(e); }
  } finally {
    assistant.status = 'done';
    assistant.text = (assistant.segments || []).filter((s) => s.type === 'text').map((s) => s.text).join('\n\n');
    for (const s of assistant.segments || []) if (s.type === 'tool' && s.status === 'running') s.status = assistant.error ? 'error' : 'done';
    for (const f of assistant.files || []) { delete f._blob; delete f._b64; if (f.status === 'pending') { f.status = 'error'; f.error = f.error || 'not retrieved'; } }
    state.busy.delete(conv.id);
    const stillExists = !state.purged.has(conv.id) && state.convs.some((c) => c.id === conv.id);
    if (stillExists) await store.put('messages', assistant);
    updateComposerState();
    renderMessages();
    if (stillExists) {
      await maybeAutoTitle(conv); await touchConversation(conv);
      const userMsg = [...chain].reverse().find((m) => m.role === 'user');
      if (!conv.ephemeral) appendHistory(conv, userMsg, assistant);
    }
  }
}
async function removeFrom(idx) {
  const removed = state.messages.splice(idx);
  for (const m of removed) {
    await store.del('messages', m.id);
    for (const f of m.files || []) if (f.key) await store.del('files', f.key).catch(() => {});
    for (const a of m.attachments || []) if (a.blobKey) await store.del('files', a.blobKey).catch(() => {});
  }
}
async function regenerate(assistantMsg) {
  const conv = activeConv(); if (!conv || state.busy.has(conv.id)) return;
  const idx = state.messages.findIndex((m) => m.id === assistantMsg.id); if (idx < 0) return;
  await removeFrom(idx);
  renderMessages();
  await runAssistantTurn(conv, activeChain());
}
async function editAndResend(userMsg, newText) {
  const conv = activeConv(); if (!conv || state.busy.has(conv.id)) return;
  const idx = state.messages.findIndex((m) => m.id === userMsg.id); if (idx < 0) return;
  // Keep this message's attachments; drop everything after it.
  const removed = state.messages.splice(idx + 1);
  for (const m of removed) { await store.del('messages', m.id); for (const f of m.files || []) if (f.key) await store.del('files', f.key).catch(() => {}); for (const a of m.attachments || []) if (a.blobKey) await store.del('files', a.blobKey).catch(() => {}); }
  userMsg.text = newText; userMsg.editedAt = Date.now();
  delete userMsg.anthropicContent; delete userMsg.anthropicSystemNote; // re-freeze with the new text
  await store.put('messages', userMsg);
  renderMessages();
  await runAssistantTurn(conv, activeChain());
}
async function deleteMessage(msg) {
  const conv = activeConv(); if (!conv) return;
  state.busy.get(conv.id)?.abort();
  const idx = state.messages.findIndex((m) => m.id === msg.id); if (idx < 0) return;
  await removeFrom(idx);
  renderMessages();
}
function stopGeneration() { const conv = activeConv(); if (conv) state.busy.get(conv.id)?.abort(); }

/* ───────────────────────────── Markdown rendering ───────────────────────────── */
const mdRenderer = new marked.Renderer();
mdRenderer.code = function ({ text, lang }) {
  const language = (lang || '').trim().split(/\s+/)[0];
  let html;
  if (language && hljs.getLanguage(language)) { try { html = hljs.highlight(text, { language, ignoreIllegals: true }).value; } catch { html = escapeHtml(text); } }
  else { try { html = hljs.highlightAuto(text).value; } catch { html = escapeHtml(text); } }
  return `<div class="codeblock"><div class="cb-head"><span>${escapeHtml(language || '')}</span><button type="button" data-copy>Copy</button></div><pre><code class="hljs">${html}</code></pre></div>`;
};
marked.setOptions({ gfm: true, breaks: true, renderer: mdRenderer });

/** Stash code and math so marked doesn't touch them; KaTeX renders math after sanitising. */
function protectMath(src) {
  const stash = [];
  const put = (s) => { stash.push(s); return `\u0000M${stash.length - 1}\u0000`; };
  let out = src.replace(/```[\s\S]*?(```|$)|`[^`\n]*`/g, (m) => put(m));
  out = out.replace(/\$\$[\s\S]+?\$\$/g, (m) => put(m));
  out = out.replace(/\\\[[\s\S]+?\\\]/g, (m) => put(m));
  out = out.replace(/\\\([\s\S]+?\\\)/g, (m) => put(m));
  out = out.replace(/(^|[^\\$\w])\$(?!\s)([^$\n]{1,400}?)(?<![\s\\])\$(?![\w$])/g, (m, pre, body) => `${pre}${put(`$${body}$`)}`);
  // Code goes back before parsing (it must be parsed as code); math stays stashed.
  out = out.replace(/\u0000M(\d+)\u0000/g, (m, i) => (stash[+i].startsWith('`') ? stash[+i] : m));
  return { out, stash };
}
function rewriteFileLinks(src) {
  // sandbox:/mnt/data/x.docx, /mnt/user-data/outputs/x.docx, attachment:x → #file:x
  return src.replace(/\]\((?:sandbox:)?(?:\/mnt\/(?:data|user-data\/outputs)\/|attachment:)([^)\s]+)\)/g, (m, name) => {
    try { return `](#file:${encodeURIComponent(decodeURIComponent(name))})`; } catch { return `](#file:${encodeURIComponent(name)})`; }
  });
}
function renderMarkdown(src) {
  if (!src) return '';
  const { out, stash } = protectMath(rewriteFileLinks(src));
  let html;
  try { html = marked.parse(out); } catch { html = `<p>${escapeHtml(src)}</p>`; }
  html = html.replace(/\u0000M(\d+)\u0000/g, (m, i) => escapeHtml(stash[+i]));
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-copy'] });
}
function postProcessProse(node) {
  for (const a of $$('a[href]', node)) {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#file:')) {
      const name = decodeURIComponent(href.slice(6));
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        const f = findFileByName(name);
        if (!f) { alert(`"${name}" isn't available for download (it may not have been transferred).`); return; }
        const rec = await getCachedFile(f.key); if (rec) downloadBlob(rec.blob, f.name);
      });
      a.title = `Download ${name}`;
    } else { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  }
  // Each h2/h3 and what follows it (up to the next heading) becomes a card with a header band.
  if (!node.querySelector(':scope > .sec')) {
    const kids = Array.from(node.children);
    let sec = null;
    for (const k of kids) {
      if (/^H[1-3]$/.test(k.tagName)) {
        sec = el('div', { class: 'sec' }); const b = el('div', { class: 'sec-b' });
        node.insertBefore(sec, k); k.classList.add('sec-h'); sec.append(k, b); sec._b = b;
      } else if (sec && !k.classList.contains('cursor')) sec._b.append(k);
    }
    for (const sc of $$(':scope > .sec', node)) if (!sc._b.childNodes.length) sc._b.remove();
  }
  for (const btn of $$('button[data-copy]', node)) {
    btn.addEventListener('click', async () => {
      const code = btn.closest('.codeblock')?.querySelector('code')?.innerText || '';
      try { await navigator.clipboard.writeText(code); btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy'), 1500); } catch { /* ignore */ }
    });
  }
  if (window.renderMathInElement) {
    try {
      renderMathInElement(node, {
        delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'a'], throwOnError: false,
      });
    } catch { /* ignore */ }
  }
}

/* ───────────────────────────── Rendering ───────────────────────────── */
const CONV_UI = { expanded: false };
function renderConvList() {
  const host = $('#convList');
  host.innerHTML = '';
  if (!settings.saveHistory) host.append(el('div', { style: { fontSize: '12.5px', color: 'var(--amber)', padding: '4px 8px 6px', fontWeight: 600 }, text: 'History saving is off — new chats end with this session.' }));
  if (!state.convs.length) { host.append(el('div', { class: 'conv-group', text: 'No conversations yet' })); return; }
  const LIMIT = 6;
  const list = CONV_UI.expanded ? state.convs : state.convs.slice(0, LIMIT);
  for (const c of list) {
    host.append(el('div', { class: `conv-item${c.id === state.activeConvId ? ' active' : ''}`, role: 'button', tabindex: '0', onclick: () => selectConversation(c.id), onkeydown: (e) => { if (e.key === 'Enter') selectConversation(c.id); } },
      state.busy.has(c.id) ? el('span', { class: 'busy-dot' }) : el('span', { html: svgIcon('chat'), style: { display: 'inline-flex', width: '18px', color: 'var(--text-2)' } }),
      el('span', { class: 't', text: c.title || 'New chat', title: c.title }),
      el('button', { class: 'x', title: 'Delete chat', 'aria-label': `Delete ${c.title || 'chat'}`, html: '×', onclick: (e) => { e.stopPropagation(); if (confirm(`Delete "${c.title}"?`)) deleteConversation(c.id); } })));
  }
  if (state.convs.length > LIMIT) host.append(el('button', { class: 'conv-more', onclick: () => { CONV_UI.expanded = !CONV_UI.expanded; renderConvList(); } }, el('span', { html: svgIcon('more'), style: { display: 'inline-flex', width: '18px' } }), CONV_UI.expanded ? 'Show fewer' : `More… (${state.convs.length - LIMIT})`));
}
function renderModelSelect() {
  const sel = $('#modelSel');
  const provider = settings.provider;
  const current = currentModel();
  sel.innerHTML = '';
  if (provider === 'local') {
    // On-device: the models that fit this device (✓ = already downloaded), plus the manager.
    const dev = LOCAL.device;
    const list = dev ? localCatalog(dev).filter((m) => m.fit === 'good' || m.fit === 'tight' || m.downloaded || m.key === current) : LOCAL_MODELS;
    if (!current) sel.append(el('option', { value: '', text: 'Choose a model…', selected: true }));
    for (const m of list) sel.append(el('option', { value: m.key, text: `${m.name}${isLocalDownloaded(m.key) ? ' ✓' : m.recommended ? ' — suggested' : ''}`, selected: m.key === current || undefined }));
    sel.append(el('option', { value: '__manage', text: 'Manage on-device models…' }));
    sel.title = 'On-device models — ✓ means already downloaded to this device';
    if (!dev) detectLocalDevice().then(() => { if (settings.provider === 'local') renderModelSelect(); });
  } else {
    const cat = state.models[provider];
    const ids = cat?.ids || SPEC[provider].fallbackModels;
    for (const id of ids) sel.append(el('option', { value: id, text: id, selected: id === current || undefined }));
    if (current && !ids.includes(current)) sel.append(el('option', { value: current, text: current, selected: true }));
    sel.title = cat?.live ? 'Models available to your API key' : 'Built-in model list (add a key to fetch the live list)';
  }
  $('#providerSel').value = provider;
  for (const o of $('#providerSel').options) o.textContent = o.value === 'local' ? `On-device${settings.localModel ? '' : ' (free, offline)'}` : `${providerName(o.value)}${keyFor(o.value) ? '' : ' (no key)'}`;
  const eff = $('#effortSel'); eff.innerHTML = '';
  for (const [v, label] of EFFORTS) eff.append(el('option', { value: v, text: label, selected: v === settings.effort || undefined }));
  const effPill = $('#effortSel').closest('.pill-sel'); if (effPill) effPill.style.display = provider === 'local' ? 'none' : '';
  $('#whoLabel').textContent = `${providerName(provider)} · ${provider === 'local' ? (current ? localModelName(current) : '—') : current || '—'}`;
  syncPillLabels();
}
/** The pills show the current choice; the native selects sit invisibly on top of them. */
function syncPillLabels() {
  const lbl = (sel) => sel.options[sel.selectedIndex]?.textContent || '';
  const pv = $('#providerVal'); if (pv) pv.textContent = providerName($('#providerSel').value);
  // On phones the "claude-" / "Effort: " prefixes are hidden (CSS) so all three pills fit on one row.
  const split = (text, re) => { const m = text.match(re); return m ? `<span class="pfx">${escapeHtml(m[1])}</span>${escapeHtml(text.slice(m[1].length))}` : escapeHtml(text); };
  const mv = $('#modelVal');
  if (mv && settings.provider === 'local') mv.textContent = settings.localModel ? `${localModelName(settings.localModel)}${isLocalDownloaded(settings.localModel) ? ' ✓' : ''}` : 'Choose a model…';
  else if (mv) mv.innerHTML = split(lbl($('#modelSel')) || '—', /^(claude-)/);
  const ev = $('#effortVal'); if (ev) ev.innerHTML = split(lbl($('#effortSel')), /^(Effort: )/);
}
const HOME_CARDS = [
  { cls: 'c-purple', art: 'laptop', text: 'Make a 10-question Year 9 quiz on Python loops', prompt: 'Make a 10-question Year 9 quiz on Python loops with an answer key, as a Word document' },
  { cls: 'c-teal', art: 'pdf', text: 'Turn the attached PDF into a one-page student summary', prompt: 'Turn the attached PDF into a one-page student summary handout', attach: true },
  { cls: 'c-peach', art: 'easel', text: 'Create a lesson plan and slides on cybersecurity', prompt: 'Create a 60-minute lesson plan (Word) and a matching 12-slide deck (PowerPoint) introducing cybersecurity — passwords, phishing and staying safe online — for Year 9' },
];
const HOME_QUICK = [
  { cls: 'q-pink', icon: 'target', label: 'Create Quiz', studio: 'quiz' },
  { cls: 'q-blue', icon: 'book', label: 'Lesson Plan', studio: 'lesson' },
  { cls: 'q-green', icon: 'clipboard', label: 'Worksheets', studio: 'worksheet' },
  { cls: 'q-orange', icon: 'slides', label: 'Slides', studio: 'slides' },
  { cls: 'q-purple', icon: 'grid', label: 'More Tools', studio: null },
];
function useStarter(text, attach) {
  $('#input').value = text; autosize(); updateComposerState();
  if (attach) $('#fileInput').click(); else if (!(typeof isMobile === 'function' && isMobile())) $('#input').focus();
}
function renderMessages() {
  const host = $('#msgsInner');
  const chain = activeChain();
  host.innerHTML = '';
  document.documentElement.classList.toggle('has-chat', chain.length > 0);
  if (!chain.length) {
    const hero = el('div', { class: 'hero' },
      el('div', { class: 'hero-top' },
        el('div', { class: 'hero-mascot', html: ART.mascot() }),
        el('div', { class: 'hero-text' },
          el('h1', { html: `How can I help <span class="last">today?${ART.swoosh}</span>` }),
          el('p', { text: 'Ask anything, attach files, and request documents — real Word, PowerPoint, Excel and PDF files come back as downloads.' }))),
      el('div', { class: 'sugg-grid' }, ...HOME_CARDS.map((c) => el('button', { class: `sugg ${c.cls}`, title: c.prompt, onclick: () => useStarter(c.prompt, c.attach) },
        el('span', { class: 'art', html: ART[c.art] }), el('span', { class: 'txt', text: c.text }), el('span', { class: 'go', html: ART.arrow })))),
      el('div', { class: 'quick-row', role: 'group', 'aria-label': 'Quick tools' }, ...HOME_QUICK.map((q) => el('button', { class: `quick ${q.cls}`, onclick: () => {
        if (!q.studio || typeof openStudioForm !== 'function') { showView('studio'); return; }
        const g = STUDIO.find((x) => x.id === q.studio); if (g) openStudioForm(g); else showView('studio');
      } }, el('span', { html: icon(q.icon), style: { display: 'inline-flex' } }), q.label))));
    host.append(hero);
    return;
  }
  for (const m of chain) host.append(renderMessage(m));
  scrollToBottom(false);
}
function scheduleRender(msg) {
  if (state.renderTimers.has(msg.id)) return;
  state.renderTimers.set(msg.id, setTimeout(() => {
    state.renderTimers.delete(msg.id);
    const node = $(`[data-msg="${msg.id}"]`);
    if (node) { const atBottom = isNearBottom(); node.replaceWith(renderMessage(msg)); if (atBottom) scrollToBottom(false); }
  }, 90));
}
const fmtClock = (t) => new Date(t || Date.now()).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase();
function renderMessage(m) {
  const wrap = el('div', { class: `msg ${m.role}`, 'data-msg': m.id });
  if (m.role === 'user') {
    const col = el('div', { class: 'ucol' });
    if (m.attachments?.length) col.append(el('div', { class: 'attach-row' }, ...m.attachments.map((a) => attachmentPill(a))));
    col.append(el('div', { class: 'ububble' }, el('div', { class: 'bubble', text: m.text || '' }), el('span', { class: 'time', text: fmtClock(m.createdAt) })));
    col.append(el('div', { class: 'actions' },
      el('button', { class: 'btn icon ghost sm', title: 'Edit & resend', 'aria-label': 'Edit and resend', html: svgIcon('edit'), onclick: () => startEdit(m, wrap) }),
      el('button', { class: 'btn icon ghost sm', title: 'Copy', 'aria-label': 'Copy', html: svgIcon('copy'), onclick: () => navigator.clipboard.writeText(m.text || '') }),
      el('button', { class: 'btn icon ghost sm', title: 'Delete from here', 'aria-label': 'Delete from here', html: svgIcon('trash'), onclick: () => { if (confirm('Delete this message and everything after it?')) deleteMessage(m); } })));
    wrap.append(el('div', { class: 'avatar me', html: svgIcon('user'), 'aria-hidden': 'true' }), col);
    return wrap;
  }
  const card = el('div', { class: 'acard' });
  wrap.append(el('div', { class: 'avatar bot', html: ART.mascot('46 6 168 158'), title: m.model || 'Teach Assist' }), card);
  const body = el('div', { class: 'body' });
  const segs = m.segments || [];
  const streaming = m.status === 'streaming';
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const isLast = i === segs.length - 1;
    if (s.type === 'thinking') {
      if (!settings.showThinking && !streaming) continue;
      if (!s.text && !(streaming && isLast)) continue;
      body.append(el('details', { class: 'card thinking' },
        el('summary', {}, el('span', { class: 'ic-sm', html: svgIcon('brain') }), el('span', { text: streaming && isLast ? 'Thinking…' : 'Thought process' }), el('span', { class: 'chev', html: svgIcon('chev') })),
        el('div', { class: 'card-body', text: s.text || '' })));
    } else if (s.type === 'text') {
      if (!s.text && !streaming) continue;
      const prose = el('div', { class: 'prose', html: renderMarkdown(s.text) });
      if (streaming && isLast) prose.append(el('span', { class: 'cursor' }));
      postProcessProse(prose);
      body.append(prose);
    } else if (s.type === 'tool') body.append(toolCard(s));
  }
  if (streaming && (!segs.length || segs[segs.length - 1].type === 'tool')) body.append(el('div', { class: 'thinking-dots', style: { marginTop: '4px' } }, el('i'), el('i'), el('i'), !segs.length ? el('span', { text: ' Working…', style: { marginLeft: '4px' } }) : null));
  const files = m.files || [];
  const imgs = files.filter((f) => f.status === 'ready' && (f.mediaType || '').startsWith('image/'));
  const others = files.filter((f) => !imgs.includes(f));
  for (const f of imgs) body.append(imageCard(f));
  if (others.length) body.append(el('div', { class: 'files' }, ...others.map((f) => fileCard(f))));
  if (others.some((f) => f.needsRelay)) body.append(el('div', { class: 'warnbox', html: `Claude created file(s) but the browser cannot download them directly from Anthropic (their Files API blocks browser origins). Add the <b>Claude files relay</b> in Settings — a two-minute Cloudflare Worker — and regenerate, or switch off the relay-free mode by asking Claude to resend the file inline.` }));
  if (m.sources?.length) body.append(el('div', { class: 'sources' }, el('div', { text: 'Sources' }), el('ol', {}, ...m.sources.slice(0, 25).map((s) => el('li', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title || s.url }))))));
  if (m.error) body.append(el('div', { class: 'err' }, `Error: ${m.error}`, el('div', {}, el('button', { class: 'btn sm', text: 'Retry', onclick: () => regenerate(m) }))));
  else if (m.stopReason === 'max_tokens' || m.stopReason === 'max_output_tokens') body.append(el('div', { class: 'warnbox' }, 'The reply hit the output-token limit. Raise "Max output tokens" in Settings, or ask it to continue.'));
  else if (m.stopReason === 'model_context_window_exceeded') body.append(el('div', { class: 'warnbox' }, 'The conversation has filled the model\'s context window; this reply was cut short. Start a new chat (or delete older messages) to continue.'));
  else if (m.stopReason === 'refusal') body.append(el('div', { class: 'err' }, 'The model declined to continue this response.'));
  else if (m.stopReason === 'stopped') body.append(el('div', { style: { color: 'var(--text-dim)', fontSize: '12.5px' }, text: 'Stopped.' }));
  if (!streaming && !segs.some((s) => s.type === 'text' && s.text) && !files.length && !m.error && !segs.some((s) => s.type === 'tool')) body.append(el('div', { style: { color: 'var(--text-dim)' }, text: '(empty response)' }));
  card.append(body);
  if (!streaming) {
    const u = m.usage;
    const tb = (name, label, fn, extra = {}) => el('button', { class: 'tb', title: label, 'aria-label': label, onclick: fn, ...extra }, el('span', { html: svgIcon(name), style: { display: 'inline-flex' } }), el('span', { class: 'lbl', text: label }));
    const copyText = async () => { try { await navigator.clipboard.writeText(m.text || ''); toastMsg('Copied'); } catch { toastMsg('Copy failed'); } };
    card.prepend(el('div', { class: 'actions', role: 'toolbar', 'aria-label': 'Reply actions' },
      tb('copy', 'Copy', copyText),
      tb('cut', 'Cut', async () => { if (!confirm('Cut copies this reply and removes it (and anything after it) from the chat. Continue?')) return; try { await navigator.clipboard.writeText(m.text || ''); } catch { /* ignore */ } deleteMessage(m); }),
      tb('paste', 'Paste', async () => { try { const t = await navigator.clipboard.readText(); if (!t) return; const inp = $('#input'); inp.value = (inp.value ? inp.value + '\n' : '') + t; autosize(); updateComposerState(); inp.focus(); } catch { toastMsg('Clipboard access was blocked — press Ctrl+V / long-press in the message box instead.'); } }),
      tb('edit', 'Edit', () => { const idx = state.messages.indexOf(m); const prev = [...state.messages.slice(0, idx)].reverse().find((x) => x.role === 'user'); const node = prev && document.querySelector(`.msg[data-msg="${prev.id}"]`); if (prev && node) { startEdit(prev, node); node.scrollIntoView({ block: 'center' }); } }),
      tb('refresh', 'Regenerate', () => regenerate(m)),
      el('button', { class: 'tb', title: 'More', 'aria-label': 'More actions', html: svgIcon('more'), onclick: (e) => replyMenu(m, e.currentTarget) })));
    const fb = (dir) => el('button', { class: `fb${m.feedback === dir ? ' on' : ''}${dir === 'down' ? ' down' : ''}`, title: dir === 'up' ? 'Good response' : 'Bad response', 'aria-label': dir === 'up' ? 'Good response' : 'Bad response', 'aria-pressed': String(m.feedback === dir), html: svgIcon(dir), onclick: () => setFeedback(m, dir) });
    card.append(el('div', { class: 'msg-foot' }, fb('up'), fb('down'),
      el('span', { class: 'usage', title: m.model || '', text: u?.local ? `${m.model || 'On device'}${u.output ? ` · ${fmtTokens(u.output)} out` : ''}${u.tps ? ` · ${u.tps.toFixed(1)} tokens/s` : ''}` : `${m.model ? m.model + ' · ' : ''}${u ? `${fmtTokens(u.input || 0)} in · ${fmtTokens(u.output || 0)} out${u.reasoning ? ` (${fmtTokens(u.reasoning)} reasoning)` : ''}${u.cacheRead ? ` · ${fmtTokens(u.cacheRead)} cached` : ''}${u.searches ? ` · ${u.searches} search${u.searches === 1 ? '' : 'es'}` : ''}` : ''}` }),
      el('span', { class: 'time', text: fmtClock(m.createdAt) })));
  }
  return wrap;
}
function toolCard(s) {
  const icon = { search: 'globe', fetch: 'globe', code: 'code', bash: 'terminal', editor: 'file', image: 'image', task: 'check', timetable: 'file', library: 'file', other: 'code' }[s.kind] || 'code';
  const status = s.status === 'running' ? el('span', { class: 'status', text: '…' }) : s.status === 'error' ? el('span', { class: 'status err', text: 'failed' }) : el('span', { class: 'status ok', html: svgIcon('check'), style: { display: 'inline-flex', width: '12px' } });
  const title = s.query ? el('span', {}, `${s.title}: `, el('span', { class: 'q', text: s.query })) : el('span', { text: s.title });
  const parts = [];
  if (s.code) {
    const pre = el('pre');
    try { pre.innerHTML = s.lang && hljs.getLanguage(s.lang) ? hljs.highlight(s.code, { language: s.lang, ignoreIllegals: true }).value : escapeHtml(s.code); } catch { pre.textContent = s.code; }
    parts.push(el('div', { class: 'lbl', text: s.kind === 'editor' ? (s.path || 'content') : s.kind === 'other' ? 'input' : 'code' }), pre);
  }
  if (s.output) parts.push(el('div', { class: 'lbl', text: 'output' }), el('pre', { text: s.output.length > 6000 ? s.output.slice(0, 6000) + '\n…' : s.output }));
  if (s.results?.length) parts.push(el('div', { class: 'lbl', text: 'results' }), el('ol', { class: 'results' }, ...s.results.slice(0, 10).map((r) => el('li', {}, el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.title || r.url })))));
  if (s.images?.length) for (const u of s.images) parts.push(el('img', { class: 'gen-img', src: u, alt: 'chart', style: { borderRadius: '10px', borderBottom: '1px solid var(--border)', margin: '8px 0' }, onerror: (e) => e.target.remove() }));
  return el('details', { class: 'card' },
    el('summary', {}, el('span', { class: 'ic-sm', html: svgIcon(icon) }), title, status, el('span', { class: 'chev', html: svgIcon('chev') })),
    parts.length ? el('div', { class: 'card-body' }, ...parts) : null);
}
const KIND_NAMES = { doc: 'Word document', xls: 'Excel workbook', ppt: 'PowerPoint deck', pdf: 'PDF', img: 'Image', csv: 'CSV file', zip: 'Archive', md: 'Markdown', html: 'Web page', json: 'JSON', code: 'Code', txt: 'File' };
/** Illustrated file icon (Word/Excel/PowerPoint/PDF style) for file cards and the library. */
function fileArt(name = '', mime = '') {
  const [cls, label] = iconClassFor(name, mime);
  const C = { doc: ['#2b6cf6', 'W'], xls: ['#1f9d55', 'X'], csv: ['#1f9d55', 'X'], ppt: ['#f26b1d', 'P'], pdf: ['#e5383b', 'PDF'], img: ['#7c5cff', '▲'], zip: ['#b7791f', 'ZIP'], code: ['#0e7490', '</>'], json: ['#6d28d9', '{ }'], html: ['#c2410c', '</>'], md: ['#475569', 'MD'], txt: ['#64748b', label || 'TXT'] }[cls] || ['#64748b', label];
  const [c, t] = C;
  const fs = t.length >= 3 ? 9.5 : 16;
  return `<svg viewBox="0 0 52 52" aria-hidden="true"><path d="M17 5h20l10 10v29a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z" fill="#fff" stroke="${c}" stroke-opacity=".35" stroke-width="1.5"/><path d="M37 5v10h10" fill="none" stroke="${c}" stroke-opacity=".35" stroke-width="1.5"/><path d="M27 23h14M27 29h14M27 35h10" stroke="${c}" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/><rect x="3" y="15" width="24" height="24" rx="4" fill="${c}"/><text x="15" y="${fs > 12 ? 32.5 : 30.5}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="${fs}" fill="#fff">${escapeHtml(t)}</text></svg>`;
}
function fileCard(f) {
  const [cls, label] = iconClassFor(f.name || '', f.mediaType || '');
  const meta = f.status === 'pending' ? 'Preparing…' : f.status === 'error' ? `Unavailable — ${f.error || 'download failed'}` : `${KIND_NAMES[cls] || label || 'File'} · ${fmtBytes(f.size)}`;
  return el('div', { class: `file-card${f.status !== 'ready' ? ' pending' : ''}`, title: f.status === 'error' ? (f.error || '') : '' },
    el('div', { class: 'fart', html: fileArt(f.name || '', f.mediaType || '') }),
    el('div', { class: 'info' }, el('div', { class: 'nm', text: f.name || f.fileId, title: f.name || '' }), el('div', { class: 'meta', text: meta })),
    el('button', { class: 'dl', title: 'Download', html: svgIcon('download'), onclick: async () => { const rec = await getCachedFile(f.key); if (rec) downloadBlob(rec.blob, f.name || 'download'); else alert('This file is no longer cached locally.'); } }));
}
function imageCard(f) {
  const wrap = el('div', { class: 'gen-img-wrap' });
  const img = el('img', { class: 'gen-img', alt: f.name || 'image' });
  fileUrl(f.key).then((u) => { if (u) img.src = u; });
  const dl = async () => { const rec = await getCachedFile(f.key); if (rec) downloadBlob(rec.blob, f.name); };
  wrap.append(img, el('div', { class: 'cap' },
    el('span', { class: 'nm', text: f.name || 'image', title: f.name || '' }),
    el('span', { class: 'meta', text: fmtBytes(f.size) }),
    el('button', { class: 'dl', title: `Download ${f.name}`, html: svgIcon('download'), onclick: dl })));
  return wrap;
}
function attachmentPill(a, removable) {
  const [cls, label] = iconClassFor(a.name, a.mediaType);
  const pill = el('div', { class: `att-pill${removable ? ' pending-att' : ''}${a.parsing ? ' parsing' : ''}`, title: a.name });
  if (a.kind === 'image' && a.base64) pill.append(el('img', { class: 'thumb', src: `data:${a.mediaType};base64,${a.base64}`, alt: a.name }));
  else pill.append(el('div', { class: `ic ${cls}`, text: label }));
  const bits = [fmtBytes(a.size)];
  if (a.pages) bits.push(`${a.pages} pages`);
  if (a.parsing) bits.push('reading…');
  if (a.uploading) bits.push('uploading…');
  if (a.uploadError) bits.push('upload failed');
  pill.append(el('div', { style: { minWidth: 0 } }, el('div', { class: 'nm', text: a.name }), el('div', { class: 'meta', text: bits.join(' · ') })));
  if (removable) pill.append(el('button', { class: 'rm', html: '×', title: 'Remove', onclick: () => { state.pending = state.pending.filter((p) => p.id !== a.id); if (a.blobKey) store.del('files', a.blobKey).catch(() => {}); renderPending(); } }));
  return pill;
}
function startEdit(m, wrap) {
  const ta = el('textarea', { style: { width: 'min(720px, 100%)', minHeight: '80px', border: '1px solid var(--accent)', borderRadius: '12px', padding: '10px 12px', background: 'var(--bg-elev)', resize: 'vertical' } });
  ta.value = m.text || '';
  const bar = el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' } },
    el('button', { class: 'btn sm', text: 'Cancel', onclick: () => renderMessages() }),
    el('button', { class: 'btn sm primary', text: 'Save & resend', onclick: () => editAndResend(m, ta.value.trim()) }));
  wrap.innerHTML = '';
  wrap.append(ta, bar);
  ta.focus();
}

/* ───────────────────────────── Composer ───────────────────────────── */
function autosize() { const ta = $('#input'); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.4) + 'px'; }
function updateComposerState() {
  const busy = state.activeConvId ? state.busy.has(state.activeConvId) : false;
  const hasText = $('#input').value.trim().length > 0 || state.pending.some((p) => !p.parsing);
  $('#sendBtn').disabled = busy || !hasText || state.pending.some((p) => p.parsing);
  $('#stopBtn').classList.toggle('hidden', !busy);
  $('#sendBtn').classList.toggle('hidden', busy);
  const local = settings.provider === 'local';
  const prov = local ? localModelName(settings.localModel) : providerName(settings.provider);
  $('#hintLabel').textContent = busy ? `${prov} is working…` : `${providerName(settings.provider)} · ${local ? (settings.localModel ? prov : 'no model') : currentModel() || 'no model'}`;
  // Web search and code/files need the cloud models.
  for (const id of ['#tglWeb', '#tglCode']) {
    const b = $(id); if (!b) continue;
    if (!b.dataset.title) b.dataset.title = b.title || '';
    b.disabled = local; b.classList.toggle('na', local);
    b.title = local ? 'Not available with on-device AI — switch to Claude or OpenAI for this' : b.dataset.title;
  }
  $('#composerBox')?.classList.toggle('local', local);
}
function renderPending() {
  const bar = $('#attachBar');
  bar.innerHTML = '';
  for (const a of state.pending) bar.append(attachmentPill(a, true));
  updateComposerState();
}
async function addFiles(fileList) {
  for (const f of Array.from(fileList || [])) {
    const placeholder = { id: uid('att'), name: f.name, size: f.size, mediaType: f.type || guessMime(f.name), parsing: true, kind: 'other' };
    state.pending.push(placeholder); renderPending();
    try { Object.assign(placeholder, await prepareAttachment(f), { parsing: false }); }
    catch (e) { state.pending = state.pending.filter((p) => p !== placeholder); showBanner('err', `Couldn't attach ${escapeHtml(f.name)}: ${escapeHtml(e.message)}`); }
    renderPending();
  }
}
function setToggle(btn, on) { btn.classList.toggle('on', !!on); btn.setAttribute('aria-pressed', String(!!on)); }
function showBanner(kind, html) {
  const host = $('#bannerHost');
  host.innerHTML = '';
  host.append(el('div', { class: `banner ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, el('span', { class: 'bi', html: svgIcon(kind === 'info' ? 'alert' : 'warn') }), el('span', { html, style: { flex: 1 } }), el('button', { class: 'x', html: '×', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => (host.innerHTML = '') })));
}
function isNearBottom() { const m = $('#messages'); return m.scrollHeight - m.scrollTop - m.clientHeight < 160; }
function scrollToBottom(force) { const m = $('#messages'); if (force || isNearBottom()) m.scrollTop = m.scrollHeight; }
function collapseSidebar(v) { $('#sidebar').classList.toggle('collapsed', v); $('#scrim').classList.toggle('show', !v && window.innerWidth < 1024); }

/* ───────────────────────────── Settings modal ───────────────────────────── */
function openSettings() {
  const host = $('#modalHost');
  host.innerHTML = '';
  // On phones the chat-list drawer sits above the page; close it so the sheet is reachable.
  if (window.innerWidth < 1024 && !$('#sidebar').classList.contains('collapsed')) collapseSidebar(true);
  const s = settings;
  const f = (label, input, help) => el('div', { class: 'field' }, el('label', { text: label }), input, help ? el('div', { class: 'help', html: help }) : null);
  const anthropicKey = el('input', { type: 'password', value: s.anthropicKey, placeholder: 'sk-ant-…', autocomplete: 'off', spellcheck: 'false' });
  const openaiKey = el('input', { type: 'password', value: s.openaiKey, placeholder: 'sk-…', autocomplete: 'off', spellcheck: 'false' });
  const relay = el('input', { type: 'text', value: s.anthropicRelay, placeholder: 'https://your-worker.your-subdomain.workers.dev', spellcheck: 'false' });
  const aStatus = el('div', { class: 'key-status' }), oStatus = el('div', { class: 'key-status' }), rStatus = el('div', { class: 'key-status' });
  const testKey = async (provider, input, status) => {
    const key = input.value.trim();
    if (!key) { status.textContent = ''; status.className = 'key-status'; return; }
    status.textContent = 'Checking…'; status.className = 'key-status wait';
    commitKey(provider, key);
    const ids = await fetchModels(provider, true);
    const cat = state.models[provider];
    if (cat?.live) { status.textContent = `Key works — ${ids.length} models available.`; status.className = 'key-status ok'; }
    else { status.textContent = 'Could not list models with this key. Check the key; the built-in model list will be used meanwhile.'; status.className = 'key-status err'; }
    ensureUsableProvider(); renderModelSelect(); updateComposerState();
  };
  // A key is stored the moment it is entered (Test, leaving the field, or closing this sheet) —
  // closing without pressing Save never loses it.
  const commitKey = (provider, value) => {
    const field = provider === 'anthropic' ? 'anthropicKey' : 'openaiKey';
    value = (value || '').trim();
    if (value === (settings[field] || '')) return false;
    const src = { ...settings.keySource, [provider]: value ? 'user' : '' };
    saveSettings({ [field]: value, keySource: src });
    // Adding a key while on-device AI is in use means the teacher wants that provider now.
    if (value && settings.provider === 'local') saveSettings({ provider });
    return true;
  };
  const commitKeys = () => {
    const a = commitKey('anthropic', anthropicKey.value), o = commitKey('openai', openaiKey.value);
    if (a || o) { ensureUsableProvider(); renderModelSelect(); updateComposerState(); paintRemember(); if (keyFor('anthropic') || keyFor('openai')) $('#bannerHost').innerHTML = ''; onKeysChanged(); }
  };
  const testRelay = async () => {
    const base = relay.value.trim().replace(/\/+$/, '');
    if (!base) { rStatus.textContent = ''; return; }
    rStatus.textContent = 'Checking…'; rStatus.className = 'key-status wait';
    try {
      const res = await fetch(`${base}/v1/files?limit=1`, { headers: anthropicHeaders(anthropicKey.value.trim() || 'x', { json: false }) });
      if (res.ok) { rStatus.textContent = 'Relay works — Claude can now upload your files to its sandbox and return generated documents.'; rStatus.className = 'key-status ok'; }
      else { const t = await res.text(); rStatus.textContent = `Relay reachable but Anthropic replied ${res.status}: ${t.slice(0, 160)}`; rStatus.className = 'key-status err'; }
    } catch (e) { rStatus.textContent = `Relay not reachable: ${e.message}`; rStatus.className = 'key-status err'; }
  };
  const showBtn = (input) => el('button', { class: 'btn sm', text: 'Show', onclick: (e) => { input.type = input.type === 'password' ? 'text' : 'password'; e.target.textContent = input.type === 'password' ? 'Show' : 'Hide'; } });
  for (const [inp, prov] of [[anthropicKey, 'anthropic'], [openaiKey, 'openai']]) inp.addEventListener('change', () => { if (commitKey(prov, inp.value)) { ensureUsableProvider(); renderModelSelect(); updateComposerState(); paintRemember(); onKeysChanged(); } });
  const remember = el('input', { type: 'checkbox' }); remember.checked = s.rememberKeys !== false;
  const rememberStatus = el('div', { class: 'help', style: { fontSize: '12px', color: 'var(--text-dim)', margin: '2px 0 0 26px' } });
  const forgetBtn = el('button', { class: 'btn sm', style: { color: 'var(--red)' }, text: 'Forget keys on this device', onclick: () => {
    if (!confirm('Remove both API keys from this browser now?')) return;
    forgetKeys(); anthropicKey.value = ''; openaiKey.value = '';
    aStatus.textContent = ''; oStatus.textContent = '';
    renderModelSelect(); updateComposerState(); paintRemember();
    showBanner('warn', 'API keys removed from this device. Add a key in <b>Settings</b> to continue.');
  } });
  const paintRemember = () => {
    const has = !!(settings.anthropicKey || settings.openaiKey);
    forgetBtn.style.display = has ? '' : 'none';
    if (!has) { rememberStatus.textContent = remember.checked ? `Keys you enter will be kept on this device for ${KEY_TTL_DAYS} days.` : 'Keys you enter will be kept only until this tab is closed.'; return; }
    rememberStatus.textContent = settings.rememberKeys && settings.keysExpireAt
      ? `Remembered on this device until ${new Date(settings.keysExpireAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}. After that you'll be asked for them again.`
      : 'Not remembered: the keys are cleared when you close this tab or browser.';
  };
  remember.addEventListener('change', () => { commitKeys(); saveSettings({ rememberKeys: remember.checked }); paintRemember(); });
  paintRemember();
  const userName = el('input', { type: 'text', value: s.userName, placeholder: 'e.g. Clarence' });
  const profile = el('textarea', { placeholder: 'Who you are, what you teach, preferred spelling/curriculum/timezone…' }); profile.value = s.profile;
  const tz = el('input', { type: 'text', value: s.timezone, placeholder: 'Australia/Melbourne' });
  const maxTok = el('input', { type: 'number', min: 1024, max: 128000, step: 1024, value: s.maxTokens });
  const displayBtn = el('button', { class: 'btn sm', type: 'button', text: 'Display & accessibility…', onclick: () => { close(); openA11yPanel(); } });
  const imageModel = el('select', {}, ...SPEC.openai.imageModels.map((m) => el('option', { value: m, text: m }))); imageModel.value = SPEC.openai.imageModels.includes(s.imageModel) ? s.imageModel : 'gpt-image-2';
  const showThinking = el('input', { type: 'checkbox' }); showThinking.checked = s.showThinking;
  const defWeb = el('input', { type: 'checkbox' }); defWeb.checked = s.webSearch;
  const defCode = el('input', { type: 'checkbox' }); defCode.checked = s.codeTools;
  const imgGen = el('input', { type: 'checkbox' }); imgGen.checked = s.imageGen;
  const saveHist = el('input', { type: 'checkbox' }); saveHist.checked = s.saveHistory;
  const trustedOrigin = el('input', { type: 'text', value: s.trustedParentOrigin, placeholder: MAIN.origin || referrerOrigin() || 'https://your-main-program.example', spellcheck: 'false' });
  const memDefault = el('input', { type: 'checkbox' }); memDefault.checked = s.memoryEnabled;
  const histInfo = el('div', { class: 'help', style: { fontSize: '12.5px', color: 'var(--text-dim)', margin: '6px 0 8px' }, text: 'Reading history file…' });
  const refreshHistInfo = async () => {
    const st = await historyStats();
    const where = cacheStorageOk() ? 'browser cache (Cache Storage)' : 'browser storage (IndexedDB — Cache Storage is unavailable when the page is opened from disk)';
    histInfo.textContent = st.sessions
      ? `teach-assist-history.json — ${st.sessions} session${st.sessions === 1 ? '' : 's'}, ${st.entries} exchange${st.entries === 1 ? '' : 's'} from ${st.convs} chat${st.convs === 1 ? '' : 's'}, ${fmtBytes(st.bytes)}, last updated ${new Date(st.updated).toLocaleString()}. Stored in the ${where}.`
      : `teach-assist-history.json is empty. It will be kept in the ${where}.`;
    renderSessionsList(sessionsHost, refreshHistInfo);
  };
  const sessionsHost = el('div');
  refreshHistInfo();
  const keySourceNote = (provider) => {
    const src = settings.keySource[provider];
    if (src === 'main') return el('div', { class: 'key-status ok', text: `Supplied by the main program${MAIN.via ? ` (${MAIN.via === 'postMessage' ? 'frame message' : 'shared api_cache'})` : ''}. Typing a different key here replaces it with your own.` });
    return null;
  };
  const relayCode = el('details', { style: { marginTop: '8px' } }, el('summary', { style: { cursor: 'pointer', fontSize: '12.5px', color: 'var(--text-2)' }, text: 'Show the Cloudflare Worker code (copy → deploy → paste URL above)' }),
    el('pre', { style: { fontFamily: 'var(--mono)', fontSize: '11.5px', background: 'var(--code-bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', overflow: 'auto', maxHeight: '260px', whiteSpace: 'pre' }, text: RELAY_WORKER_SOURCE }),
    el('button', { class: 'btn sm', text: 'Copy worker code', onclick: (e) => { navigator.clipboard.writeText(RELAY_WORKER_SOURCE); e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy worker code'), 1500); } }));

  const close = () => { commitKeys(); host.innerHTML = ''; };
  const modal = el('div', { class: 'modal-bg', onclick: (e) => { if (e.target === modal) close(); } },
    el('div', { class: 'modal' },
      el('div', { class: 'm-head' }, el('h2', { text: 'Settings' }), el('button', { class: 'btn icon ghost', html: '×', title: 'Close', onclick: close })),
      el('div', { class: 'm-body' },
        el('div', { class: 'm-section', style: { marginTop: '8px' } }, el('h3', { text: 'API keys' }),
          el('div', { class: 'help', style: { fontSize: '12.5px', color: 'var(--text-dim)', margin: '6px 0 4px' }, html: 'Keys stay in this browser (localStorage) and go straight to the provider — there is no server in between. Create keys at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> and <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>.' }),
          f('Anthropic (Claude) API key', el('div', { class: 'key-row' }, anthropicKey, showBtn(anthropicKey), el('button', { class: 'btn sm', text: 'Test', onclick: () => testKey('anthropic', anthropicKey, aStatus) }))), keySourceNote('anthropic'), aStatus,
          f('OpenAI API key', el('div', { class: 'key-row' }, openaiKey, showBtn(openaiKey), el('button', { class: 'btn sm', text: 'Test', onclick: () => testKey('openai', openaiKey, oStatus) }))), keySourceNote('openai'), oStatus,
          el('div', { class: 'help', style: { fontSize: '12.5px', color: 'var(--text-dim)', margin: '4px 0 0' }, text: 'One key is enough — the app uses whichever provider you have a key for. No key? Use on-device AI below.' }),
          el('label', { class: 'check', style: { marginTop: '12px' } }, remember, el('span', {}, `Remember me — keep my API keys in this browser for ${KEY_TTL_DAYS} days`, el('span', { class: 'help', text: 'Untick on a shared or school computer: the keys are then cleared when this tab is closed.' }))),
          rememberStatus,
          el('div', { style: { marginTop: '8px' } }, forgetBtn),
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' } },
            el('button', { class: 'btn sm', text: 'Reload keys from main program', onclick: async (e) => {
              e.target.textContent = 'Checking…';
              // Clear the "typed by me" flag so main-program keys may replace them.
              saveSettings({ keySource: { anthropic: settings.anthropicKey ? 'main' : '', openai: settings.openaiKey ? 'main' : '' } });
              const local = readLocalApiCache();
              let got = !!(local.OPENAI_API_KEY || local.CLAUDE_API_KEY);
              if (got) applyMainKeys(local, 'api_cache');
              if (await requestParentKeys()) got = true;
              anthropicKey.value = settings.anthropicKey; openaiKey.value = settings.openaiKey;
              e.target.textContent = got ? 'Keys loaded from main program' : 'No main program keys found';
              onKeysChanged();
            } })),
          f('Trusted main-program origin (optional)', trustedOrigin, `When Teach Assist runs inside the main program's frame, keys sent by message are accepted only from the parent frame${MAIN.origin ? ` (currently <code>${escapeHtml(MAIN.origin)}</code>)` : ''}. Enter the main program's origin to also reject any other parent. Leave blank to accept your own parent frame.`)),
        el('div', { class: 'm-section', id: 'localSettings' }, el('h3', { text: 'On-device AI (free · private · offline)' }),
          el('div', { class: 'help', style: { fontSize: '12.5px', color: 'var(--text-dim)', margin: '6px 0 8px' }, text: 'Smaller AI models that run inside this browser — no API key, nothing leaves the device, and they keep working without internet. A model downloads once, then loads from this device every time.' }),
          el('div', { class: 'key-status ok', style: { display: settings.localModel && isLocalDownloaded(settings.localModel) ? '' : 'none' }, text: settings.localModel ? `${localModelName(settings.localModel)} is on this device${settings.provider === 'local' ? ' and in use' : ''}.` : '' }),
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' } },
            el('button', { class: 'btn sm', type: 'button', text: settings.localModel ? 'Manage on-device models…' : 'Choose an on-device model…', onclick: () => { close(); openLocalAISheet(); } }),
            settings.localModel && isLocalDownloaded(settings.localModel) && settings.provider !== 'local' ? el('button', { class: 'btn sm', type: 'button', text: `Use ${localModelName(settings.localModel)} now`, onclick: () => { close(); useLocalModel(settings.localModel); } }) : null)),
        el('div', { class: 'm-section' }, el('h3', { text: 'Claude files relay (recommended for Claude documents)' }),
          el('div', { class: 'help', style: { fontSize: '12.5px', color: 'var(--text-dim)', margin: '6px 0 4px' }, html: `Anthropic lets browsers call the chat API directly, but <b>blocks browser access to its Files API</b> — which is how Claude's generated DOCX/PPTX/XLSX/PDF files are downloaded and how your Word/Excel attachments reach its sandbox. A tiny Cloudflare Worker (free) forwards just those <code>/v1/files</code> calls with your own key. Without it, Claude still works and small files (under ${SPEC.anthropic.inlineFileMaxKB} KB) are transferred inline; larger ones can't be. OpenAI needs no relay.` }),
          f('Relay URL', el('div', { class: 'key-row' }, relay, el('button', { class: 'btn sm', text: 'Test', onclick: testRelay }))), rStatus, relayCode),
        el('div', { class: 'm-section' }, el('h3', { text: 'About you' }),
          el('div', { class: 'row' }, f('Your name', userName), f('Timezone (IANA)', tz)),
          f('Profile & standing instructions', profile, 'Sent with every request. Keep it to what changes the answers: subjects, year levels, spelling, curriculum, tone.')),
        el('div', { class: 'm-section' }, el('h3', { text: 'Generation' }),
          el('div', { class: 'row' }, f('Max output tokens', maxTok, 'Upper bound per reply (thinking included). The app lowers it automatically if a model allows less.'), f('Appearance, text size & accessibility', displayBtn, 'Light or dark mode, text size, high contrast, easy-read font, reduced motion.')),
          el('label', { class: 'check' }, showThinking, el('span', {}, 'Show the model\'s thought process ', el('span', { class: 'help', text: 'Collapsible "Thought process" cards (Claude: summarised thinking; OpenAI: reasoning summaries).' }))),
          el('label', { class: 'check' }, defWeb, el('span', {}, 'Web search on for new chats ', el('span', { class: 'help', text: 'Claude: web_search + web_fetch. OpenAI: web_search. Billed by the provider per search (~$10 per 1,000).' }))),
          el('label', { class: 'check' }, defCode, el('span', {}, 'Code & files on for new chats ', el('span', { class: 'help', text: 'Claude: code-execution sandbox with the docx/pptx/xlsx/pdf Skills. OpenAI: code interpreter container. This is what produces real downloadable documents.' }))),
          el('label', { class: 'check' }, imgGen, el('span', {}, 'Image generation ', el('span', { class: 'help', text: 'OpenAI: built-in image_generation tool. Claude: a generate_image tool backed by your OpenAI key (needs an OpenAI key).' }))),
          f('Image model', imageModel)),
        el('div', { class: 'm-section' }, el('h3', { text: 'History, memory & sessions' }),
          el('label', { class: 'check' }, saveHist, el('span', {}, 'Save history ', el('span', { class: 'help', text: 'On: chats, tasks, timetable and library persist between visits, and each session is mirrored into teach-assist-history.json in the browser cache (finalised when the app closes). Off: new chats last only for this session and nothing new is written to the file.' }))),
          el('label', { class: 'check' }, memDefault, el('span', {}, 'Memory on for new chats ', el('span', { class: 'help', text: 'Gives the model short summaries of your earlier chats (titles, what you asked, what it answered, files made). You can switch it per chat with the Memory toggle under the message box.' }))),
          histInfo,
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            el('button', { class: 'btn sm', text: 'Export history (JSON)', onclick: exportHistory }),
            el('button', { class: 'btn sm', text: 'Import history (JSON)', onclick: () => importAll(refreshHistInfo) })),
          el('div', { class: 'lbl', style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-dim)', margin: '14px 0 4px' }, text: 'Clear memory' }),
          el('div', { class: 'help', style: { fontSize: '12.5px', color: 'var(--text-dim)', marginBottom: '6px' }, text: 'A session is one time the app was open in a tab. Clearing a session removes the chats, tasks, timetable blocks and files created in it — from this browser and from the history file.' }),
          sessionsHost,
          el('div', { class: 'help', style: { fontSize: '12px', color: 'var(--text-dim)', marginTop: '8px' }, text: 'Attachments are also uploaded to the provider you use (OpenAI Files API; Anthropic Files API via the relay) so the sandbox can read them; you can delete those from the provider console.' })),
        el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' } },
          el('button', { class: 'btn', text: 'Cancel', onclick: close }),
          el('button', { class: 'btn primary', text: 'Save', onclick: async () => {
            const patch = {
              anthropicKey: anthropicKey.value.trim(), openaiKey: openaiKey.value.trim(), anthropicRelay: relay.value.trim().replace(/\/+$/, ''),
              userName: userName.value.trim(), profile: profile.value.trim(), timezone: tz.value.trim() || DEFAULT_SETTINGS.timezone,
              maxTokens: clamp(parseInt(maxTok.value, 10) || 64000, 1024, 128000), imageModel: imageModel.value,
              showThinking: showThinking.checked, webSearch: defWeb.checked, codeTools: defCode.checked, imageGen: imgGen.checked,
              saveHistory: saveHist.checked, memoryEnabled: memDefault.checked, trustedParentOrigin: trustedOrigin.value.trim().replace(/\/+$/, ''),
              rememberKeys: remember.checked,
            };
            const keysChanged = patch.anthropicKey !== settings.anthropicKey || patch.openaiKey !== settings.openaiKey;
            // A key the user typed (different from what the main program supplied) becomes theirs.
            const src = { ...settings.keySource };
            if (patch.anthropicKey !== settings.anthropicKey) src.anthropic = patch.anthropicKey ? 'user' : '';
            if (patch.openaiKey !== settings.openaiKey) src.openai = patch.openaiKey ? 'user' : '';
            patch.keySource = src;
            if (patch.saveHistory !== settings.saveHistory) {
              // Turning saving back on keeps the chats from this session; turning it off affects new chats only.
              if (patch.saveHistory) for (const c of state.convs) if (c.ephemeral) { c.ephemeral = false; await store.put('conversations', c); }
            }
            saveSettings(patch);
            close();
            if (keysChanged || !state.models[settings.provider]?.live) await Promise.all([fetchModels('anthropic', keysChanged), fetchModels('openai', keysChanged)]);
            ensureUsableProvider();
            renderModelSelect(); updateComposerState(); renderMessages();
            if (keyFor('anthropic') || keyFor('openai')) $('#bannerHost').innerHTML = '';
          } })))));
  host.append(modal);
  // Focusing a field on a phone pops the keyboard over half the sheet; only do it on desktop.
  if (!s.anthropicKey && !s.openaiKey && !(typeof isMobile === 'function' && isMobile())) anthropicKey.focus();
}
const RELAY_WORKER_SOURCE = `// Cloudflare Worker: CORS relay for Anthropic's Files API (/v1/files/* only).
// Forwards your own x-api-key from the browser; stores nothing. Optional env var
// ALLOWED_ORIGIN (e.g. "https://you.github.io", or "null" for file://) restricts callers.
const ALLOW_PATH = /^\\/v1\\/files(\\/|$)/;
const PASS = ['x-api-key','authorization','anthropic-version','anthropic-beta','content-type'];
const cors = (origin, env) => ({
  'Access-Control-Allow-Origin': env && env.ALLOWED_ORIGIN ? (origin === env.ALLOWED_ORIGIN ? origin : 'null') : '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'x-api-key, authorization, anthropic-version, anthropic-beta, anthropic-dangerous-direct-browser-access, content-type',
  'Access-Control-Expose-Headers': 'content-type, content-length, content-disposition, request-id',
  'Access-Control-Max-Age': '86400', 'Vary': 'Origin',
});
export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('Origin') || '', h = cors(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (env && env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) return new Response('Origin not allowed', { status: 403, headers: h });
    if (!ALLOW_PATH.test(url.pathname)) return new Response('Not found', { status: 404, headers: h });
    if (!request.headers.get('x-api-key') && !request.headers.get('authorization')) return new Response('Missing x-api-key', { status: 401, headers: h });
    const headers = new Headers();
    for (const k of PASS) { const v = request.headers.get(k); if (v) headers.set(k, v); }
    if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
    const up = await fetch('https://api.anthropic.com' + url.pathname + url.search, { method: request.method, headers, body: ['GET','HEAD'].includes(request.method) ? undefined : request.body });
    const out = new Headers();
    for (const k of ['content-type','content-length','content-disposition','request-id']) { const v = up.headers.get(k); if (v) out.set(k, v); }
    for (const [k, v] of Object.entries(h)) out.set(k, v);
    return new Response(up.body, { status: up.status, headers: out });
  },
};`;
async function exportAll() {
  const convs = await store.all('conversations');
  const msgs = await store.all('messages');
  const slim = msgs.map((m) => ({ ...m, attachments: (m.attachments || []).map((a) => ({ ...a, base64: a.kind === 'image' ? a.base64 : undefined })) }));
  downloadBlob(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), conversations: convs, messages: slim }, null, 1)], { type: 'application/json' }), `teach-assist-export-${localDateStamp()}.json`);
}
/** Import a history JSON (v2 sessions, v1 exchange list, or an old full export): rebuilds chats, tasks and timetable, merges into the file. */
function importAll(after) {
  const input = el('input', { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    const f = input.files?.[0]; if (!f) return;
    try {
      let data = JSON.parse(await f.text());
      if (Array.isArray(data.conversations) && Array.isArray(data.messages) && !data.sessions && !data.entries) {
        for (const c of data.conversations) await store.put('conversations', c);
        for (const m of data.messages) await store.put('messages', m);
        await loadConversations(); renderConvList();
        alert(`Imported ${data.conversations.length} conversations.`);
        if (typeof after === 'function') after();
        return;
      }
      data = upgradeHistoryDoc(data);
      if (!data || !Array.isArray(data.sessions)) throw new Error('not a Teach Assist history file');
      await historyQueue;
      const doc = (await readHistory()) || emptyHistoryDoc();
      const existingConvs = new Set((await store.all('conversations')).map((c) => c.id));
      const existingTasks = new Set((await store.all('tasks')).map((t) => t.id));
      const existingBlocks = new Set((await store.all('blocks')).map((b) => b.id));
      let addedEx = 0, rebuilt = 0, tasksN = 0, blocksN = 0;
      for (const ses of data.sessions) {
        const target = sessionEntry(doc, ses.id || uid('ses'));
        if (ses.startedAt && (!target.startedAt || ses.startedAt < target.startedAt)) target.startedAt = ses.startedAt;
        if (ses.endedAt) target.endedAt = ses.endedAt;
        const seen = new Set(target.exchanges.map((e) => e.id));
        const byConv = new Map();
        for (const e of ses.exchanges || []) {
          if (!e || !e.conversationId) continue;
          if (!seen.has(e.id)) { target.exchanges.push(e); seen.add(e.id); addedEx++; }
          if (!byConv.has(e.conversationId)) byConv.set(e.conversationId, []);
          byConv.get(e.conversationId).push(e);
        }
        for (const [cid, entries] of byConv) {
          if (existingConvs.has(cid)) continue;
          entries.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
          const t0 = Date.parse(entries[0].timestamp) || Date.now();
          const tN = Date.parse(entries[entries.length - 1].timestamp) || Date.now();
          await store.put('conversations', { id: cid, title: entries[0].conversationTitle || 'Imported chat', createdAt: t0, updatedAt: tN, provider: entries[0].provider, model: entries[0].model, webSearch: settings.webSearch, codeTools: settings.codeTools, imported: true, sessionId: target.id });
          for (const e of entries) {
            const ts = Date.parse(e.timestamp) || t0;
            const names = (e.user?.attachments || []).map((a) => a.name).filter(Boolean);
            const fileNames = (e.assistant?.files || []).map((x) => x.name).filter(Boolean);
            await store.put('messages', { id: uid('msg'), conversationId: cid, role: 'user', createdAt: ts - 1, sessionId: target.id, text: (e.user?.text || '') + (names.length ? `\n\n[attachments not included in history: ${names.join(', ')}]` : '') });
            const text = (e.assistant?.text || '') + (fileNames.length ? `\n\n_Files from this reply are not stored in the history file: ${fileNames.join(', ')}_` : '');
            await store.put('messages', { id: uid('msg'), conversationId: cid, role: 'assistant', createdAt: ts, sessionId: target.id, text, segments: text ? [{ type: 'text', text, citations: [] }] : [], sources: e.assistant?.sources || [], files: [], provider: e.provider, model: e.model, status: 'done', usage: e.usage || undefined, ...(e.assistant?.error ? { error: e.assistant.error } : {}) });
          }
          existingConvs.add(cid); rebuilt++;
        }
        for (const t of ses.tasks || []) {
          if (!t?.id || existingTasks.has(t.id)) continue;
          await store.put('tasks', { id: t.id, title: t.title || 'Task', description: t.description || '', deadline: t.deadline ? Date.parse(t.deadline) : undefined, estimatedDurationMin: t.estimatedDurationMin || 30, priority: t.priority || 3, status: t.status || 'inbox', tags: t.tags || [], createdAt: Date.parse(t.createdAt) || Date.now(), updatedAt: Date.parse(t.updatedAt) || Date.now(), source: 'imported', sessionId: target.id });
          existingTasks.add(t.id); tasksN++;
        }
        for (const b of ses.blocks || []) {
          if (!b?.id || existingBlocks.has(b.id)) continue;
          if (isNaN(parseLocal(b.startISO)) || isNaN(parseLocal(b.endISO))) continue; // unparseable dates would never render
          await store.put('blocks', { id: b.id, title: b.title || 'Block', type: b.type || 'custom', startISO: b.startISO, endISO: b.endISO, location: b.location || '', notes: b.notes || '', recurrence: b.recurrence || undefined, exdates: b.exdates || [], status: b.status || 'scheduled', taskId: b.taskId || undefined, artifactIds: [], source: 'imported', createdAt: Date.now(), sessionId: target.id });
          existingBlocks.add(b.id); blocksN++;
        }
        if (!target.tasks.length) target.tasks = ses.tasks || [];
        if (!target.blocks.length) target.blocks = ses.blocks || [];
        if (!target.artifacts.length) target.artifacts = ses.artifacts || [];
      }
      doc.updated = new Date().toISOString();
      await writeHistory(doc);
      await loadConversations(); renderConvList();
      if (typeof refreshPlannerViews === 'function') refreshPlannerViews();
      alert(`Imported: ${rebuilt} chat${rebuilt === 1 ? '' : 's'} rebuilt, ${addedEx} exchange${addedEx === 1 ? '' : 's'} merged, ${tasksN} task${tasksN === 1 ? '' : 's'}, ${blocksN} timetable block${blocksN === 1 ? '' : 's'}.`);
      if (typeof after === 'function') after();
    } catch (e) { alert(`Import failed: ${e.message}`); }
  };
  input.click();
}

/* ───────────────────────────── Wiring ───────────────────────────── */
async function init() {
  applyTheme();
  if (window.innerWidth < 1024) $('#sidebar').classList.add('collapsed');
  await loadConversations();
  renderConvList();
  renderModelSelect();
  await selectConversation(state.convs[0]?.id || null);
  updateComposerState();
  requestAnimationFrame(() => requestAnimationFrame(() => $('#sidebar').classList.remove('no-anim')));

  const input = $('#input');
  input.addEventListener('input', () => { autosize(); updateComposerState(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!$('#sendBtn').disabled) submit(); } });
  input.addEventListener('paste', (e) => { const files = Array.from(e.clipboardData?.files || []); if (files.length) { e.preventDefault(); addFiles(files); } });
  $('#sendBtn').addEventListener('click', submit);
  $('#stopBtn').addEventListener('click', stopGeneration);
  $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const box = $('#composerBox');
  for (const ev of ['dragenter', 'dragover']) box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add('drag'); });
  for (const ev of ['dragleave', 'drop']) box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.remove('drag'); });
  box.addEventListener('drop', (e) => addFiles(e.dataTransfer?.files));
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  const persistToggle = (btnSel, field) => async () => { const b = $(btnSel); setToggle(b, !b.classList.contains('on')); const c = activeConv(); if (c) { c[field] = b.classList.contains('on'); await store.put('conversations', c); } };
  $('#tglWeb').addEventListener('click', persistToggle('#tglWeb', 'webSearch'));
  $('#tglCode').addEventListener('click', persistToggle('#tglCode', 'codeTools'));
  $('#tglMemory').addEventListener('click', persistToggle('#tglMemory', 'memory'));
  $('#newChatBtn').addEventListener('click', async () => { state.activeConvId = null; state.messages = []; await selectConversation(null); $('#input').focus(); });
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#sbToggle').addEventListener('click', () => collapseSidebar(!$('#sidebar').classList.contains('collapsed')));
  $('#scrim').addEventListener('click', () => collapseSidebar(true));
  $('#providerSel').addEventListener('change', async (e) => {
    const p = e.target.value;
    if (p === 'local') {
      // Pick up a model that is already on this device; otherwise help choose one.
      const have = settings.localModel || LOCAL_MODELS.find((m) => isLocalDownloaded(m.key))?.key || '';
      saveSettings({ provider: 'local', localModel: have });
      renderModelSelect(); updateComposerState();
      if (have && /API key/.test($('#bannerHost').textContent)) $('#bannerHost').innerHTML = '';
      if (!have) openLocalAISheet(); else if (isLocalDownloaded(have)) ensureLocalEngine(have).catch(() => {});
      return;
    }
    saveSettings({ provider: p }); if (!state.models[settings.provider]?.live) await fetchModels(settings.provider); renderModelSelect(); updateComposerState();
  });
  $('#modelSel').addEventListener('change', async (e) => {
    const v = e.target.value;
    if (settings.provider === 'local') {
      if (v === '__manage' || !v) { renderModelSelect(); openLocalAISheet(); return; }
      renderModelSelect();
      await useLocalModel(v);
      renderModelSelect(); updateComposerState();
      return;
    }
    saveSettings(settings.provider === 'anthropic' ? { anthropicModel: v } : { openaiModel: v }); renderModelSelect(); updateComposerState();
  });
  $('#bannerHost').addEventListener('click', (e) => { const a = e.target.closest('[data-act]'); if (!a) return; e.preventDefault(); if (a.dataset.act === 'local') openLocalAISheet(); else if (a.dataset.act === 'settings') openSettings(); });
  $('#effortSel').addEventListener('change', (e) => { saveSettings({ effort: e.target.value }); syncPillLabels(); });
  window.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); $('#newChatBtn').click(); } });

  // Keys from the main program: shared api_cache first, then the frame handshake.
  onKeysChanged = async () => {
    ensureUsableProvider(); renderModelSelect();
    await Promise.all([settings.anthropicKey ? fetchModels('anthropic', true) : null, settings.openaiKey ? fetchModels('openai', true) : null]);
    ensureUsableProvider();
    if (keyFor('anthropic') || keyFor('openai')) $('#bannerHost').innerHTML = '';
    renderModelSelect(); updateComposerState();
  };
  window.addEventListener('message', onParentMessage);
  window.addEventListener('storage', (e) => { if (['api_cache', 'OPENAI_API_KEY', 'CLAUDE_API_KEY', 'openai_api_key'].includes(e.key) && applyMainKeys(readLocalApiCache(), 'api_cache')) onKeysChanged(); });
  applyMainKeys(readLocalApiCache(), 'api_cache');
  if (inFrame() && !(settings.anthropicKey && settings.openaiKey && settings.keySource.anthropic === 'user' && settings.keySource.openai === 'user')) await requestParentKeys();

  if (!settings.anthropicKey && !settings.openaiKey) {
    const local = ensureUsableProvider() === 'local';
    if (local) { renderModelSelect(); updateComposerState(); }
    if (KEYS_STATE.expired) showBanner('warn', `Your saved API keys were cleared after ${KEY_TTL_DAYS} days. Add them again in <b>Settings</b> (tick “Remember me” to keep them for another ${KEY_TTL_DAYS} days).${local ? ' Meanwhile your on-device model answers.' : ''}`);
    else if (!local) showBanner('warn', 'Add your Claude (Anthropic) or OpenAI API key in <b>Settings</b> to start — one is enough. Or <a href="#" data-act="local">use free on-device AI</a> — no key needed, works offline.');
  } else {
    ensureUsableProvider();
    await Promise.all([settings.anthropicKey ? fetchModels('anthropic') : null, settings.openaiKey ? fetchModels('openai') : null]);
    renderModelSelect(); updateComposerState();
  }
}
async function submit() {
  const text = $('#input').value.trim();
  const atts = state.pending.filter((p) => !p.parsing);
  if (!text && !atts.length) return;
  $('#input').value = ''; autosize();
  state.pending = []; renderPending();
  $('#bannerHost').innerHTML = '';
  try { await sendMessage(text, atts); }
  catch (e) { showBanner('err', escapeHtml(e.message || String(e))); }
  updateComposerState();
}
