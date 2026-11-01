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

(async () => {
  applyMobileClass();
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
