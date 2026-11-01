/* ═══════════════════════════════════════════════════════════════════════════
   Boot: session record, rail navigation, lifecycle (finalise the session's entry in the
   history file when the tab is hidden or closed), then the chat init().
   ═══════════════════════════════════════════════════════════════════════════ */

async function registerSession() {
  try {
    const rec = (await store.get('sessions', SESSION.id)) || { id: SESSION.id, startedAt: SESSION.startedAt };
    if (rec.startedAt) SESSION.startedAt = rec.startedAt; // a reload inside the same tab continues the session
    rec.lastActiveAt = Date.now(); rec.endedAt = null;
    await store.put('sessions', rec);
  } catch (e) { console.warn('[session]', e); }
}
let sessionEnded = false;
function endSession() {
  if (sessionEnded) return; sessionEnded = true;
  clearTimeout(sessionSyncTimer);
  store.put('sessions', { id: SESSION.id, startedAt: SESSION.startedAt, lastActiveAt: Date.now(), endedAt: Date.now() }).catch(() => {});
  // Finalise this session's entry in teach-assist-history.json (sets endedAt). Best effort — the
  // entry is already kept current a couple of seconds after every change.
  syncSessionToHistory(true);
}
function resumeSession() {
  if (!sessionEnded) return; sessionEnded = false;
  touchSession();
  if (settings.saveHistory) syncSessionToHistory(false);
  finaliseStaleSessions();
}

/* Sessions in other tabs answer on this channel; a session record with no endedAt whose tab is
   gone (closed without the final write completing, crashed, lost power) is finalised here. */
const SESSION_BC = (() => { try { return new BroadcastChannel('teachassist-sessions'); } catch { return null; } })();
const ALIVE = new Set();
if (SESSION_BC) SESSION_BC.onmessage = (e) => { const d = e.data || {}; if (d.type === 'ping') SESSION_BC.postMessage({ type: 'pong', id: SESSION.id }); else if (d.type === 'pong' && d.id) ALIVE.add(d.id); };
async function finaliseStaleSessions() {
  try {
    const recs = await store.all('sessions');
    const others = recs.filter((r) => r.id !== SESSION.id);
    if (!others.length) return;
    const open = others.filter((r) => !r.endedAt);
    if (open.length && SESSION_BC) { // without BroadcastChannel we cannot tell a live tab from a dead one, so leave them open
      ALIVE.clear();
      SESSION_BC.postMessage({ type: 'ping' }); await new Promise((r) => setTimeout(r, 1200));
      for (const r of open) if (!ALIVE.has(r.id)) { r.endedAt = r.lastActiveAt || r.startedAt || Date.now(); await store.put('sessions', r); }
    }
    // The tab's own final write may have reached IndexedDB but not the history file: reconcile.
    const ended = others.filter((r) => r.endedAt);
    if (!ended.length) return;
    await queueHistory(async () => {
      const doc = await readHistory(); if (!doc) return;
      let changed = false;
      for (const r of ended) { const s = doc.sessions.find((x) => x.id === r.id); if (s && !s.endedAt) { s.endedAt = new Date(r.endedAt).toISOString(); changed = true; } }
      if (changed) await writeHistory(doc);
    });
  } catch (e) { console.warn('[session] finalise', e); }
}
function touchSession() { store.put('sessions', { id: SESSION.id, startedAt: SESSION.startedAt, lastActiveAt: Date.now(), endedAt: null }).catch(() => {}); }

function wireRail() {
  for (const b of document.querySelectorAll('#rail button[data-view]')) b.addEventListener('click', () => showView(b.dataset.view));
  window.addEventListener('keydown', (e) => {
    if (!(e.altKey && !e.ctrlKey && !e.metaKey)) return;
    const map = { 1: 'chat', 2: 'studio', 3: 'tasks', 4: 'timetable', 5: 'library' };
    if (map[e.key]) { e.preventDefault(); showView(map[e.key]); }
  });
}

/* ───────────── Header, sidebar and composer extras ───────────── */
function wireChrome() {
  $('#brandLogo').innerHTML = ART.logo();
  $('#brandMascot').innerHTML = ART.mascot();
  $('#themeToggle').addEventListener('click', () => saveSettings({ appearance: resolvedTheme() === 'dark' ? 'light' : 'dark' }));
  $('#tsDown').addEventListener('click', () => stepTextScale(-1));
  $('#tsReset').addEventListener('click', () => stepTextScale(0));
  $('#tsUp').addEventListener('click', () => stepTextScale(1));
  $('#a11yBtn').addEventListener('click', openA11yPanel);
  renderSideNav();
  $('#addFilesBtn').addEventListener('click', () => $('#fileInput').click());
  $('#pasteImgBtn').addEventListener('click', pasteImageFromClipboard);
  setupDictation($('#micBtn'));
  // On phones the bottom tabs give way to the on-screen keyboard (detected from the visual viewport).
  const vv = window.visualViewport;
  if (vv) { const onVV = () => document.documentElement.classList.toggle('typing-mobile', isMobile() && vv.height < window.innerHeight * 0.78); vv.addEventListener('resize', onVV); }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sidebar').classList.contains('collapsed') && window.innerWidth < 1024) collapseSidebar(true); });
}
async function pasteImageFromClipboard() {
  try {
    if (!navigator.clipboard?.read) throw new Error('unsupported');
    const items = await navigator.clipboard.read();
    const files = [];
    for (const it of items) for (const type of it.types) if (type.startsWith('image/')) { const b = await it.getType(type); files.push(new File([b], `pasted-image-${localDateStamp()}.${type.split('/')[1] || 'png'}`, { type })); }
    if (!files.length) { toast('No image on the clipboard — copy an image first.'); return; }
    await addFiles(files);
  } catch { toast('Your browser blocked clipboard access. Click in the message box and press Ctrl+V (⌘V on Mac) to paste the image.'); $('#input').focus(); }
}
/** Speech-to-text into the message box (Web Speech API where the browser offers it). */
function setupDictation(btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, base = '', listening = false;
  const stop = () => { listening = false; btn.classList.remove('rec'); btn.setAttribute('aria-pressed', 'false'); try { rec?.stop(); } catch { /* ignore */ } };
  btn.addEventListener('click', () => {
    if (!SR) { showBanner('info', 'Voice typing isn’t available in this browser. Use your keyboard’s microphone key, or try Chrome, Edge or Safari.'); return; }
    if (listening) { stop(); return; }
    rec = new SR();
    rec.lang = navigator.language || 'en-AU'; rec.continuous = true; rec.interimResults = true;
    base = $('#input').value ? $('#input').value.replace(/\s*$/, ' ') : '';
    rec.onresult = (ev) => {
      let fin = '', interim = '';
      for (let i = 0; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += t; else interim += t; }
      $('#input').value = base + fin + interim; autosize(); updateComposerState();
    };
    rec.onerror = (ev) => { stop(); if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') showBanner('warn', 'Microphone access was blocked. Allow it in your browser’s site settings to dictate.'); };
    rec.onend = () => { if (listening) stop(); };
    try { rec.start(); listening = true; btn.classList.add('rec'); btn.setAttribute('aria-pressed', 'true'); } catch { stop(); }
  });
}

(async () => {
  applyMobileClass();
  wireChrome();
  let resizeTimer = null;
  const onLayoutChange = () => { applyMobileClass(); clearTimeout(resizeTimer); resizeTimer = setTimeout(refreshPlannerViews, 150); };
  MOBILE_MQ.addEventListener('change', onLayoutChange);
  COARSE_MQ.addEventListener('change', onLayoutChange);
  window.addEventListener('orientationchange', onLayoutChange);
  wireRail();
  onLibraryChanged = () => { if (VIEW.current === 'library') renderLibrary(); };
  await registerSession();
  await init();
  showView(settings.activeView || 'chat', { remember: false });
  // On-device AI: load the chosen model from this device in the background; cover for lost connections.
  setTimeout(warmLocalOnBoot, 800);
  window.addEventListener('offline', () => {
    if (settings.provider === 'local' || turnProvider() !== 'local') return;
    showBanner('info', `You're offline — replies will come from <b>${escapeHtml(localModelName(settings.localModel))}</b> on this device until the connection returns.`);
    ensureLocalEngine(settings.localModel).catch(() => {});
  });
  window.addEventListener('online', () => { if (settings.provider !== 'local' && /offline/.test($('#bannerHost').textContent)) $('#bannerHost').innerHTML = ''; });
  // Lets the app itself open without a connection (GitHub Pages / any https host).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || window.TA_FORCE_SW)) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e));
  updateRailBadges();
  if (settings.saveHistory) scheduleSessionSync(1500); // re-opens this session's entry after a reload
  finaliseStaleSessions();
  setInterval(() => { if (document.visibilityState === 'visible' && !sessionEnded) { touchSession(); finaliseStaleSessions(); } }, 60 * 1000);
  window.addEventListener('pagehide', endSession);
  window.addEventListener('beforeunload', endSession);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') endSession(); else resumeSession(); });
  // Keep the week view's "now" line and today's highlight fresh.
  setInterval(() => { if (VIEW.current === 'timetable' && (TT.view === 'day' || TT.view === 'week')) renderTimetable(); }, 5 * 60 * 1000);
})().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:auto 12px 12px 12px;background:#3b1111;color:#fff;padding:12px;border-radius:10px;font:13px system-ui">Teach Assist failed to start: ${escapeHtml(e.message || String(e))}</div>`); });
