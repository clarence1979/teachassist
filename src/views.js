/* ═══════════════════════════════════════════════════════════════════════════
   Views: Studio · Tasks · Timetable · Library · sessions list · view switching.
   Everything reads/writes the local IndexedDB stores (tasks, blocks, artifacts).
   ═══════════════════════════════════════════════════════════════════════════ */

const VIEW = { current: 'chat' };
/* Phone detection: a narrow viewport, or a coarse pointer on anything tablet-sized or smaller. The CSS
   breakpoint is 640px; the JS side also treats a touch device under 900px as mobile for behaviour
   (three-day timetable grid, swipe navigation). */
const MOBILE_MQ = window.matchMedia('(max-width: 640px)');
const COARSE_MQ = window.matchMedia('(hover: none) and (pointer: coarse) and (max-width: 900px)');
function isMobile() { return MOBILE_MQ.matches || COARSE_MQ.matches; }
function applyMobileClass() { document.documentElement.classList.toggle('mobile', isMobile()); }

/* ───────────────────────────── Shared UI helpers ───────────────────────────── */
function openModal(title, body, footer, { wide = false } = {}) {
  const host = $('#modalHost'); host.innerHTML = '';
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { host.innerHTML = ''; document.removeEventListener('keydown', esc); };
  document.addEventListener('keydown', esc);
  const modal = el('div', { class: 'modal-bg', onclick: (e) => { if (e.target === modal) close(); } },
    el('div', { class: 'modal', style: wide ? { maxWidth: '860px' } : null },
      el('div', { class: 'm-head' }, el('h2', { text: title }), el('button', { class: 'btn icon ghost', html: '×', title: 'Close', onclick: close })),
      el('div', { class: 'm-body' }, ...body.flat(), footer ? el('div', { class: 'm-foot', style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px', flexWrap: 'wrap' } }, ...footer.flat()) : null)));
  host.append(modal);
  return close;
}
const field = (label, input, help, cls = '') => el('div', { class: `field ${cls}`.trim() }, el('label', { text: label }), input, help ? el('div', { class: 'help', text: help }) : null);
function selectEl(options, value) { const s = el('select', {}, ...options.map(([v, t]) => el('option', { value: v, text: t }))); if (value !== undefined) s.value = value; return s; }
function roundTo30(d) { d = new Date(parseLocal(d)); d.setSeconds(0, 0); d.setMinutes(Math.ceil(d.getMinutes() / 30) * 30); return d; }
function fmtHour(h) { h = h % 24; return h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`; }
/** Horizontal swipe on touch screens → cb(+1) for left, cb(-1) for right. Ignores mostly-vertical drags. */
function attachSwipe(node, cb) {
  let x0 = 0, y0 = 0, t0 = 0, active = false;
  node.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); active = true; }, { passive: true });
  node.addEventListener('touchend', (e) => {
    if (!active) return; active = false;
    const t = e.changedTouches[0]; const dx = t.clientX - x0, dy = t.clientY - y0;
    if (Date.now() - t0 < 700 && Math.abs(dx) > 70 && Math.abs(dy) < 50 && Math.abs(dx) > Math.abs(dy) * 1.5) cb(dx < 0 ? 1 : -1);
  }, { passive: true });
}
function viewHead(title, ...controls) { return el('div', { class: 'view-head' }, el('h1', { text: title }), ...controls.flat()); }
function segmented(options, value, onChange) {
  const seg = el('div', { class: 'seg' });
  for (const [v, t] of options) seg.append(el('button', { class: v === value ? 'on' : '', text: t, 'data-value': v, onclick: () => { for (const b of seg.children) b.classList.toggle('on', b.dataset.value === v); onChange(v); } }));
  return seg;
}
function toast(text) {
  const host = $('#modalHost');
  const t = el('div', { class: 'toast', text, style: { position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', background: 'var(--bg-elev)', border: '1px solid var(--border-strong)', borderRadius: '10px', padding: '9px 14px', fontSize: '13px', zIndex: 200, boxShadow: '0 6px 24px rgba(0,0,0,.3)' } });
  host.append(t); setTimeout(() => t.remove(), 2600);
}

/** Open a fresh chat, optionally prefilled, with the Code & files toggle set, and optionally send. */
async function startChatWith({ text = '', files = null, codeTools = true, webSearch = null, send = false } = {}) {
  showView('chat');
  state.activeConvId = null; state.messages = []; state.pending = []; renderPending();
  await selectConversation(null);
  setToggle($('#tglCode'), codeTools);
  if (webSearch !== null) setToggle($('#tglWeb'), webSearch);
  $('#input').value = text; autosize(); updateComposerState();
  if (files && files.length) await addFiles(files);
  if (send && !keyFor(settings.provider)) { showBanner('warn', `Add your ${settings.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key in <b>Settings</b>, then press Enter to send this request.`); openSettings(); return; }
  if (send) await submit(); else $('#input').focus();
}

/* ───────────────────────────── View switching ───────────────────────────── */
function showView(name, { remember = true } = {}) {
  if (name === 'settings') { openSettings(); return; }
  if (!['chat', 'studio', 'tasks', 'timetable', 'library'].includes(name)) name = 'chat';
  for (const sec of document.querySelectorAll('#main .view')) sec.classList.toggle('hidden', sec.id !== `view-${name}`);
  for (const b of document.querySelectorAll('#rail button')) b.classList.toggle('active', b.dataset.view === name);
  $('#sidebar').classList.toggle('off', name !== 'chat');
  if (name !== 'chat') $('#scrim').classList.remove('show');
  VIEW.current = name;
  if (remember) saveSettings({ activeView: name });
  if (name === 'tasks') renderTasks(); else if (name === 'timetable') renderTimetable(); else if (name === 'library') renderLibrary(); else if (name === 'studio') renderStudio();
  else setTimeout(() => $('#input').focus(), 0);
}
function refreshPlannerViews() {
  if (VIEW.current === 'tasks') renderTasks();
  else if (VIEW.current === 'timetable') renderTimetable();
  else if (VIEW.current === 'library') renderLibrary();
  updateRailBadges();
}
async function updateRailBadges() {
  try {
    const tasks = await store.all('tasks');
    const end = endOfDay(new Date()).getTime();
    const due = tasks.filter((t) => t.status !== 'done' && t.deadline && t.deadline <= end).length;
    const btn = document.querySelector('#rail button[data-view="tasks"]');
    if (!btn) return;
    btn.querySelector('.badge')?.remove();
    if (due) btn.append(el('span', { class: 'badge', text: String(due), title: `${due} task${due === 1 ? '' : 's'} due today or overdue` }));
  } catch { /* ignore */ }
}

/* ═════════════════════════════════ Tasks ═════════════════════════════════ */
const TASKS = { filter: 'open', list: [] };
const PRIO_STYLE = { 1: ['Urgent', 'var(--red)'], 2: ['High', 'var(--amber)'], 3: ['Medium', 'var(--accent)'], 4: ['Low', 'var(--text-dim)'], 5: ['Someday', 'var(--text-dim)'] };
function sortTasks(a, b) { return ((a.status === 'done') - (b.status === 'done')) || (a.priority - b.priority) || ((a.deadline || Infinity) - (b.deadline || Infinity)) || (b.createdAt - a.createdAt); }
function deadlineLabel(t) {
  if (!t.deadline) return null;
  const d = new Date(t.deadline), now = new Date();
  const overdue = d < now && t.status !== 'done';
  const txt = sameDay(d, now) ? `Due today ${fmtTime(d)}` : sameDay(d, addDays(now, 1)) ? `Due tomorrow ${fmtTime(d)}` : `Due ${fmtDateShort(d)} ${fmtTime(d)}`;
  return el('span', { style: { color: overdue ? 'var(--red)' : 'inherit', fontWeight: overdue ? 600 : 400 }, text: overdue ? `Overdue — was ${txt.replace(/^Due /, '')}` : txt });
}
async function renderTasks() {
  const root = $('#view-tasks');
  const tasks = (await store.all('tasks')).sort(sortTasks);
  TASKS.list = tasks;
  const open = tasks.filter((t) => t.status !== 'done');
  const shown = TASKS.filter === 'all' ? tasks : TASKS.filter === 'open' ? open : tasks.filter((t) => t.status === TASKS.filter);
  const aiBtn = el('button', { class: 'btn sm', text: 'Prioritise with AI', title: 'Ask the model to rank your open tasks', onclick: () => prioritiseWithAI(aiBtn) });
  root.innerHTML = '';
  root.append(viewHead('Tasks',
    el('span', { class: 'muted small', text: `${open.length} open` }),
    segmented([['open', 'Open'], ['scheduled', 'Scheduled'], ['done', 'Done'], ['all', 'All']], TASKS.filter, (v) => { TASKS.filter = v; renderTasks(); }),
    aiBtn,
    el('button', { class: 'btn sm primary', text: '+ Task', onclick: () => openTaskModal() })));
  const body = el('div', { class: 'view-body' });
  if (!shown.length) body.append(el('div', { class: 'empty-note', html: TASKS.filter === 'open' && !tasks.length ? 'No tasks yet. Add one here, or just tell the chat <i>"remind me to book the excursion bus by Friday"</i> — the model adds it for you.' : 'Nothing here.' }));
  else { const list = el('div', { class: 'card-list' }); for (const t of shown) list.append(taskRow(t)); body.append(list); }
  root.append(body);
  updateRailBadges();
}
function taskRow(t) {
  const [pl, pc] = PRIO_STYLE[t.priority] || PRIO_STYLE[3];
  const chk = el('input', { type: 'checkbox', class: 'chk', title: t.status === 'done' ? 'Mark not done' : 'Mark done' }); chk.checked = t.status === 'done';
  chk.addEventListener('change', async () => {
    if (chk.checked) t.status = 'done';
    else { t.status = (await allBlocks()).some((b) => b.taskId === t.id) ? 'scheduled' : 'inbox'; }
    t.updatedAt = Date.now(); await store.put('tasks', t); renderTasks();
  });
  const sub = el('div', { class: 'sub', style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
    el('span', { class: 'pill', style: { background: 'var(--bg-elev)', color: pc, border: `1px solid ${pc}` }, text: pl }),
    deadlineLabel(t),
    t.estimatedDurationMin ? el('span', { text: `~${t.estimatedDurationMin} min` }) : null,
    t.status === 'scheduled' ? el('span', { text: 'On timetable' }) : null,
    ...(t.tags || []).map((g) => el('span', { class: 'pill', style: { background: 'var(--accent-soft)', color: 'var(--accent)' }, text: g })));
  const grow = el('div', { class: 'grow' }, el('div', { class: 'ttl', text: t.title }), t.description ? el('div', { class: 'sub', text: t.description }) : null, sub,
    t.aiRationale ? el('div', { class: 'sub', style: { fontStyle: 'italic' }, text: `AI: ${t.aiRationale}` }) : null);
  const actions = el('div', { class: 'acts' },
    t.status !== 'done' ? el('button', { class: 'btn sm', text: 'Schedule', title: 'Put time for this task on the timetable', onclick: () => openBlockModal({ defaults: { title: t.title, type: 'prep', taskId: t.id, duration: t.estimatedDurationMin || 60 } }) }) : null,
    el('button', { class: 'btn icon ghost', html: svgIcon('edit'), title: 'Edit', onclick: () => openTaskModal(t) }),
    el('button', { class: 'btn icon ghost', html: svgIcon('trash'), title: 'Delete', onclick: async () => { if (!confirm(`Delete "${t.title}"?`)) return; await store.del('tasks', t.id); renderTasks(); } }));
  return el('div', { class: `row-card${t.status === 'done' ? ' done' : ''}` }, chk, grow, actions);
}
function openTaskModal(t = null) {
  const title = el('input', { type: 'text', value: t?.title || '', placeholder: 'What needs doing?' });
  const desc = el('textarea', { placeholder: 'Details (optional)', rows: 3 }); desc.value = t?.description || '';
  const dl = el('input', { type: 'datetime-local', value: t?.deadline ? isoDateTime(new Date(t.deadline)).slice(0, 16) : '' });
  const dur = el('input', { type: 'number', min: 5, step: 5, value: t?.estimatedDurationMin || 30 });
  const prio = selectEl([[1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low'], [5, 'Someday']], String(t?.priority || 3));
  const tags = el('input', { type: 'text', value: (t?.tags || []).join(', '), placeholder: 'marking, year 9, admin' });
  const close = openModal(t ? 'Edit task' : 'New task', [
    el('div', { class: 'form-grid' },
      field('Title', title, null, 'full'), field('Details', desc, null, 'full'),
      field('Due', dl), field('Estimated minutes', dur), field('Priority', prio), field('Tags (comma-separated)', tags)),
  ], [
    el('button', { class: 'btn', text: 'Cancel', onclick: () => close() }),
    el('button', { class: 'btn primary', text: t ? 'Save' : 'Add task', onclick: async () => {
      const name = title.value.trim(); if (!name) { title.focus(); return; }
      const rec = t || { id: uid('task'), status: 'inbox', source: 'manual', createdAt: Date.now() };
      Object.assign(rec, { title: name, description: desc.value.trim(), deadline: dl.value ? parseLocal(dl.value).getTime() : undefined, estimatedDurationMin: Math.max(5, parseInt(dur.value, 10) || 30), priority: parseInt(prio.value, 10) || 3, tags: tags.value.split(',').map((s) => s.trim()).filter(Boolean), updatedAt: Date.now() });
      await store.put('tasks', rec); close(); renderTasks();
    } }),
  ]);
  title.focus();
}
async function prioritiseWithAI(btn) {
  const open = TASKS.list.filter((t) => t.status !== 'done');
  if (!open.length) { toast('No open tasks to prioritise.'); return; }
  if (!keyFor(settings.provider)) { openSettings(); return; }
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Thinking…';
  try {
    const payload = open.map((t) => ({ id: t.id, title: t.title, description: t.description || '', deadline: t.deadline ? isoDateTime(new Date(t.deadline)) : null, estimatedDurationMin: t.estimatedDurationMin, currentPriority: PRIORITY_LABEL[t.priority], tags: t.tags || [] }));
    const text = await quickComplete({
      system: 'You are a planning assistant for a school teacher. Reply with JSON only — no prose, no code fences.',
      prompt: `Today is ${todayContext(settings.timezone)} (${settings.timezone}). Rank these tasks. Return a JSON array of objects {"id": string, "priority": "urgent"|"high"|"medium"|"low"|"someday", "rationale": string (max 12 words)} covering every id, most urgent first. Weigh deadlines (anything due within 2 days is urgent), effort, and impact on students.\n\n${JSON.stringify(payload)}`,
    });
    const arr = parseJsonLoose((text.match(/\[[\s\S]*\]/) || [text])[0]);
    if (!Array.isArray(arr)) throw new Error('the model did not return a list');
    let n = 0;
    for (const r of arr) { const t = open.find((x) => x.id === r.id); if (!t) continue; const p = PRIORITY_WORDS[String(r.priority || '').toLowerCase()]; if (p) t.priority = p; t.aiRationale = String(r.rationale || '').slice(0, 160); t.updatedAt = Date.now(); await store.put('tasks', t); n++; }
    await renderTasks(); toast(`Re-prioritised ${n} task${n === 1 ? '' : 's'}.`);
  } catch (e) { alert(`Couldn't prioritise: ${e.message}`); }
  finally { btn.disabled = false; btn.textContent = label; }
}

/* ═════════════════════════════════ Timetable ═════════════════════════════════ */
const TT = { view: ['day', 'week', 'month', 'agenda'].includes(settings.ttView) ? settings.ttView : 'week', anchor: startOfDay(new Date()), weekend: !!settings.ttWeekend, hourH: 56 };
function ttRange() {
  switch (TT.view) {
    case 'day': return [startOfDay(TT.anchor), endOfDay(TT.anchor)];
    case 'month': { const g = startOfWeek(startOfMonth(TT.anchor)); return [g, endOfDay(addDays(g, 41))]; }
    case 'agenda': return [startOfDay(TT.anchor), endOfDay(addDays(TT.anchor, 13))];
    default: {
      if (isMobile()) { const s = startOfDay(TT.anchor); return [s, endOfDay(addDays(s, 2))]; } // three days from the anchor
      const s = startOfWeek(TT.anchor); return [s, endOfDay(addDays(s, TT.weekend ? 6 : 4))];
    }
  }
}
function ttTitle() {
  const [from, to] = ttRange();
  if (TT.view === 'day') return fmtDateLong(from);
  if (TT.view === 'month') return TT.anchor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  const sameMonth = from.getMonth() === to.getMonth();
  return `${from.getDate()}${sameMonth ? '' : ' ' + from.toLocaleDateString('en-AU', { month: 'short' })} – ${to.getDate()} ${to.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}`;
}
function ttStep(dir) {
  if (TT.view === 'day') TT.anchor = addDays(TT.anchor, dir);
  else if (TT.view === 'week') TT.anchor = addDays(TT.anchor, (isMobile() ? 3 : 7) * dir);
  else if (TT.view === 'month') { const d = new Date(TT.anchor); d.setDate(1); d.setMonth(d.getMonth() + dir); TT.anchor = d; }
  else TT.anchor = addDays(TT.anchor, 14 * dir);
  renderTimetable();
}
function isAllDay(o) { return !!o.block.allDay || durationMin(o.startISO, o.endISO) >= 1439; }
function markConflicts(occ) {
  const live = occ.filter((o) => o.block.status !== 'cancelled' && !isAllDay(o));
  for (const o of occ) o.conflict = false;
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) if (overlaps(live[i].startISO, live[i].endISO, live[j].startISO, live[j].endISO)) { live[i].conflict = true; live[j].conflict = true; }
}
async function renderTimetable() {
  const root = $('#view-timetable');
  const blocks = await allBlocks();
  const [from, to] = ttRange();
  const occ = expandOccurrences(blocks, from, to);
  markConflicts(occ);
  const weekendBtn = el('button', { class: `toggle${TT.weekend ? ' on' : ''}`, text: 'Sat/Sun', title: 'Show weekends in the week view', onclick: () => { TT.weekend = !TT.weekend; saveSettings({ ttWeekend: TT.weekend }); renderTimetable(); } });
  const more = el('details', { class: 'tt-more', style: { position: 'relative' } }, el('summary', { class: 'btn sm', style: { listStyle: 'none', cursor: 'pointer' }, text: 'More ▾' }),
    el('div', { style: { position: 'absolute', right: 0, top: '34px', zIndex: 20, background: 'var(--bg-elev)', border: '1px solid var(--border-strong)', borderRadius: '10px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '240px', boxShadow: '0 8px 30px rgba(0,0,0,.35)' } },
      el('button', { class: 'btn sm', style: { justifyContent: 'flex-start' }, text: 'Import timetable from a photo / PDF (AI)', onclick: importTimetableFromImage }),
      el('button', { class: 'btn sm', style: { justifyContent: 'flex-start' }, text: 'Plan my week with AI', onclick: planWeekWithAI }),
      el('button', { class: 'btn sm', style: { justifyContent: 'flex-start' }, text: 'Import .ics calendar', onclick: importIcs }),
      el('button', { class: 'btn sm', style: { justifyContent: 'flex-start' }, text: 'Export .ics calendar', onclick: exportIcs }),
      el('button', { class: 'btn sm', style: { justifyContent: 'flex-start', color: 'var(--red)' }, text: 'Clear this week…', onclick: () => clearWeekPrompt(blocks) })));
  root.innerHTML = '';
  const addBtn = el('button', { class: 'btn sm primary', text: isMobile() ? '+' : '+ Block', title: 'Add a block', style: isMobile() ? { marginLeft: 'auto', minWidth: '38px', fontSize: '18px' } : null, onclick: () => openBlockModal({ defaults: { startISO: isoDateTime(roundTo30(sameDay(TT.anchor, new Date()) ? new Date() : addMinutes(TT.anchor, 9 * 60))) } }) });
  const seg = segmented([['day', 'Day'], ['week', isMobile() ? '3 days' : 'Week'], ['month', 'Month'], ['agenda', 'Agenda']], TT.view, (v) => { TT.view = v; saveSettings({ ttView: v }); renderTimetable(); });
  const toolbar = el('div', { class: 'tt-toolbar' },
    el('button', { class: 'btn sm', html: '‹', title: 'Previous', onclick: () => ttStep(-1) }),
    el('button', { class: 'btn sm', text: 'Today', onclick: () => { TT.anchor = startOfDay(new Date()); renderTimetable(); } }),
    el('button', { class: 'btn sm', html: '›', title: 'Next', onclick: () => ttStep(1) }),
    el('span', { class: 'tt-title', text: ttTitle() }),
    isMobile() ? addBtn : null);
  root.append(isMobile()
    ? el('div', { class: 'view-head' }, toolbar, el('div', { style: { display: 'flex', gap: '6px', width: '100%', alignItems: 'center' } }, seg, el('span', { style: { flex: 1 } }), more))
    : viewHead('Timetable', toolbar, seg, TT.view === 'week' ? weekendBtn : null, more, addBtn));
  TT.hourH = isMobile() ? 48 : 56;
  const body = el('div', { class: 'view-body' });
  attachSwipe(body, (dir) => ttStep(dir));
  if (!blocks.length) body.append(el('div', { class: 'empty-note', html: 'Your timetable is empty. Add blocks with <b>+ Block</b>, click a time slot, import an <b>.ics</b> file, or use <b>More → Import from a photo</b> and let the model read your printed timetable. In chat you can also say <i>"I teach 9B Maths Mon/Wed 9–10"</i>.' }));
  if (TT.view === 'month') body.append(renderMonth(occ));
  else if (TT.view === 'agenda') body.append(renderAgenda(occ));
  else {
    const days = []; for (let d = new Date(from); d <= to; d = addDays(d, 1)) days.push(d);
    body.append(renderGrid(days, occ));
  }
  body.append(el('div', { class: 'legend', style: { marginTop: '12px' } }, ...BLOCK_TYPES.map((t) => el('span', {}, el('i', { style: { background: t.color } }), t.label)), el('span', { class: 'muted' }, el('i', { style: { outline: '2px solid var(--red)', outlineOffset: '-2px', background: 'transparent' } }), 'overlap')));
  root.append(body);
}
function layoutLanes(occ) {
  const sorted = [...occ].sort((a, b) => a.startISO.localeCompare(b.startISO) || b.endISO.localeCompare(a.endISO));
  const out = []; let cluster = [], clusterEnd = null;
  const flush = () => {
    if (!cluster.length) return;
    const laneEnds = [];
    const placed = cluster.map((o) => { let lane = laneEnds.findIndex((e) => parseLocal(e) <= parseLocal(o.startISO)); if (lane < 0) { lane = laneEnds.length; laneEnds.push(o.endISO); } else laneEnds[lane] = o.endISO; return { o, lane }; });
    for (const p of placed) out.push({ ...p, lanes: laneEnds.length });
    cluster = []; clusterEnd = null;
  };
  for (const o of sorted) { if (clusterEnd && parseLocal(o.startISO) >= parseLocal(clusterEnd)) flush(); cluster.push(o); if (!clusterEnd || parseLocal(o.endISO) > parseLocal(clusterEnd)) clusterEnd = o.endISO; }
  flush();
  return out;
}
function renderGrid(days, occ) {
  const timed = occ.filter((o) => !isAllDay(o));
  let h0 = 7, h1 = 18;
  for (const o of timed) {
    const sm = minutesOfDay(o.startISO); h0 = Math.min(h0, Math.floor(sm / 60));
    const crossesMidnight = !sameDay(o.startISO, o.endISO);
    const em = crossesMidnight ? 1440 : minutesOfDay(o.endISO);
    h1 = Math.max(h1, Math.ceil(em / 60), Math.floor(sm / 60) + 1);
  }
  h1 = Math.min(Math.max(h1, h0 + 1), 24);
  const hours = h1 - h0, H = TT.hourH;
  const grid = el('div', { class: 'tt-grid' });
  grid.style.setProperty('--days', days.length); grid.style.setProperty('--hour-h', `${H}px`);
  const today = new Date();
  grid.append(el('div', { class: 'tt-head' }));
  for (const d of days) {
    const head = el('div', { class: `tt-head${sameDay(d, today) ? ' today' : ''}`, html: `${DOW_LABELS[d.getDay()]}<span class="d">${d.getDate()}</span>` });
    for (const o of occ.filter((x) => isAllDay(x) && sameDay(x.startISO, d))) head.append(el('div', { class: 'mev', style: { background: typeColor(o.block.type, o.block.color), color: '#fff', borderRadius: '5px', padding: '1px 5px', marginTop: '3px', fontSize: '11px', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: o.block.title, onclick: () => openBlockModal({ block: o.block, occurrence: o }) }));
    grid.append(head);
  }
  const gutter = el('div', { class: 'tt-gutter', style: { height: `${hours * H}px` } });
  for (let h = h0; h <= h1; h++) gutter.append(el('span', { style: { top: `${(h - h0) * H}px`, transform: h === h0 ? 'translateY(2px)' : h === h1 ? 'translateY(-100%)' : undefined }, text: fmtHour(h) }));
  grid.append(gutter);
  for (const d of days) {
    const col = el('div', { class: `tt-col${sameDay(d, today) ? ' today' : ''}`, style: { height: `${hours * H}px` } });
    col.addEventListener('click', (e) => {
      if (e.target !== col) return;
      const mins = h0 * 60 + Math.floor((e.offsetY / H) * 2) * 30;
      openBlockModal({ defaults: { startISO: isoDateTime(addMinutes(startOfDay(d), mins)) } });
    });
    for (const { o, lane, lanes } of layoutLanes(timed.filter((x) => sameDay(x.startISO, d)))) {
      const top = (minutesOfDay(o.startISO) - h0 * 60) / 60 * H;
      const visibleEnd = sameDay(o.startISO, o.endISO) ? minutesOfDay(o.endISO) : 1440;
      const height = Math.max(20, (visibleEnd - minutesOfDay(o.startISO)) / 60 * H - 2);
      const ev = el('div', { class: `tt-ev${o.conflict ? ' conflict' : ''}`, title: `${o.block.title}\n${fmtTime(o.startISO)}–${fmtTime(o.endISO)}${o.block.location ? '\n' + o.block.location : ''}${o.block.recurrence ? '\n' + describeRRule(o.block.recurrence) : ''}`,
        style: { top: `${top}px`, height: `${height}px`, background: typeColor(o.block.type, o.block.color), left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)`, right: 'auto', opacity: o.block.status === 'cancelled' ? .45 : 1, textDecoration: o.block.status === 'cancelled' ? 'line-through' : 'none' },
        onclick: () => openBlockModal({ block: o.block, occurrence: o }) },
        el('div', { class: 't', text: o.block.title }),
        height > 30 ? el('div', { class: 'm', text: `${fmtTime(o.startISO)}–${fmtTime(o.endISO)}${o.block.location ? ' · ' + o.block.location : ''}` }) : null);
      if (o.block.artifactIds?.length) ev.append(el('span', { class: 'clip', text: `📎${o.block.artifactIds.length > 1 ? o.block.artifactIds.length : ''}` }));
      col.append(ev);
    }
    if (sameDay(d, today)) { const m = minutesOfDay(today); if (m >= h0 * 60 && m <= h1 * 60) col.append(el('div', { class: 'tt-now', style: { top: `${(m - h0 * 60) / 60 * H}px` } })); }
    grid.append(col);
  }
  return el('div', { class: 'tt-wrap' }, grid);
}
function renderMonth(occ) {
  const s = startOfMonth(TT.anchor), g = startOfWeek(s), today = new Date();
  const grid = el('div', { class: 'month-grid' });
  for (const l of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) grid.append(el('div', { class: 'month-head', text: l }));
  for (let i = 0; i < 42; i++) {
    const d = addDays(g, i);
    const dayOcc = occ.filter((o) => sameDay(o.startISO, d));
    const cell = el('div', { class: `month-cell${d.getMonth() !== s.getMonth() ? ' other' : ''}${sameDay(d, today) ? ' today' : ''}`, onclick: () => { TT.anchor = startOfDay(d); TT.view = 'day'; saveSettings({ ttView: 'day' }); renderTimetable(); } },
      el('div', { class: 'dn' }, el('span', { text: d.getDate() }), dayOcc.length ? el('span', { class: 'muted', text: String(dayOcc.length) }) : null));
    for (const o of dayOcc.slice(0, 3)) cell.append(el('div', { class: 'mev', style: { background: typeColor(o.block.type, o.block.color) }, text: `${isAllDay(o) ? '' : fmtTime(o.startISO) + ' '}${o.block.title}`, onclick: (e) => { e.stopPropagation(); openBlockModal({ block: o.block, occurrence: o }); } }));
    if (dayOcc.length > 3) cell.append(el('div', { class: 'muted small', text: `+${dayOcc.length - 3} more` }));
    grid.append(cell);
  }
  return grid;
}
function renderAgenda(occ) {
  if (!occ.length) return el('div', { class: 'empty-note', text: 'Nothing scheduled in this fortnight.' });
  const wrap = el('div'); let last = null;
  for (const o of occ) {
    if (o.occurrenceDate !== last) { last = o.occurrenceDate; wrap.append(el('div', { class: 'agenda-day', text: `${fmtDateLong(o.occurrenceDate)}${sameDay(o.occurrenceDate, new Date()) ? ' · Today' : ''}` })); }
    wrap.append(occRow(o));
  }
  return wrap;
}
function occRow(o) {
  const b = o.block;
  return el('div', { class: 'row-card', style: { cursor: 'pointer', borderLeft: `4px solid ${typeColor(b.type, b.color)}` }, onclick: () => openBlockModal({ block: b, occurrence: o }) },
    el('div', { class: 'grow' },
      el('div', { class: 'ttl' }, b.title, o.conflict ? el('span', { class: 'pill', style: { background: 'var(--red)', color: '#fff', marginLeft: '8px' }, text: 'overlap' }) : null),
      el('div', { class: 'sub', text: `${isAllDay(o) ? 'All day' : `${fmtTime(o.startISO)}–${fmtTime(o.endISO)}`} · ${typeLabel(b.type)}${b.location ? ' · ' + b.location : ''}${b.recurrence ? ' · ' + describeRRule(b.recurrence) : ''}${b.artifactIds?.length ? ` · 📎 ${b.artifactIds.length}` : ''}` })));
}

/** Add / edit a block. `occurrence` is set when opened from a specific day of a recurring series. */
async function openBlockModal({ block = null, occurrence = null, defaults = {} } = {}) {
  const [blocks, arts, tasksAll] = await Promise.all([allBlocks(), store.all('artifacts'), store.all('tasks')]);
  const base = block || {};
  const isEdit = !!block, recurring = !!base.recurrence;
  const start0 = occurrence?.startISO || base.startISO || defaults.startISO || isoDateTime(roundTo30(new Date()));
  const dur0 = isEdit ? durationMin(base.startISO, base.endISO) : (defaults.duration || 60);
  const end0 = occurrence?.endISO || base.endISO || defaults.endISO || isoDateTime(addMinutes(start0, dur0));
  const title = el('input', { type: 'text', value: base.title || defaults.title || '', placeholder: 'e.g. 9B Maths' });
  let type = base.type || defaults.type || 'class';
  const typeChips = el('div', { class: 'chips-sel' });
  const paintChips = () => { typeChips.innerHTML = ''; for (const t of BLOCK_TYPES) typeChips.append(el('button', { class: t.value === type ? 'on' : '', text: t.label, style: t.value === type ? { borderColor: t.color, color: t.color } : null, onclick: () => { type = t.value; paintChips(); } })); };
  paintChips();
  const date = el('input', { type: 'date', value: start0.slice(0, 10) });
  const startT = el('input', { type: 'time', value: start0.slice(11, 16) });
  const endT = el('input', { type: 'time', value: end0.slice(11, 16) });
  const location = el('input', { type: 'text', value: base.location || '', placeholder: 'Room / where' });
  const notes = el('textarea', { rows: 3, placeholder: 'Notes' }); notes.value = base.notes || '';
  const rr = parseRRule(base.recurrence);
  const repeat = selectEl([['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['fortnightly', 'Every 2 weeks'], ['monthly', 'Every month']],
    !recurring ? 'none' : rr.freq === 'DAILY' ? 'daily' : rr.freq === 'MONTHLY' ? 'monthly' : rr.interval === 2 ? 'fortnightly' : (rr.byday?.length === 5 && !rr.byday.includes('SA') && !rr.byday.includes('SU')) ? 'weekdays' : 'weekly');
  let byday = new Set(rr.byday || [DOW_CODES[parseLocal(start0).getDay()]]);
  let bydayTouched = !!rr.byday?.length; // until the user picks days, the chips follow the chosen date
  const dayChips = el('div', { class: 'chips-sel' });
  const paintDays = () => { dayChips.innerHTML = ''; for (let i = 1; i <= 7; i++) { const code = DOW_CODES[i % 7]; dayChips.append(el('button', { class: byday.has(code) ? 'on' : '', text: DOW_LABELS[i % 7], onclick: () => { bydayTouched = true; if (byday.has(code)) byday.delete(code); else byday.add(code); paintDays(); } })); } };
  paintDays();
  date.addEventListener('input', () => { if (!bydayTouched && date.value) { byday = new Set([DOW_CODES[parseLocal(date.value).getDay()]]); paintDays(); } });
  const until = el('input', { type: 'date', value: rr.until ? isoDate(rr.until) : '' });
  const repeatBox = el('div', { class: 'full', style: { display: 'grid', gap: '8px' } });
  const paintRepeat = () => { repeatBox.innerHTML = ''; const v = repeat.value; if (v === 'none') return; if (v === 'weekly' || v === 'fortnightly') repeatBox.append(field('On days', dayChips)); repeatBox.append(field('Until (optional)', until)); };
  repeat.addEventListener('change', paintRepeat); paintRepeat();
  const taskSel = selectEl([['', '— none —'], ...tasksAll.filter((t) => t.status !== 'done' || t.id === base.taskId).map((t) => [t.id, t.title])], base.taskId || defaults.taskId || '');
  // Attached resources
  let artifactIds = [...(base.artifactIds || [])];
  const attList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
  const attSel = selectEl([['', '— attach a library file —']], '');
  const paintAtt = () => {
    attList.innerHTML = '';
    for (const id of artifactIds) { const a = arts.find((x) => x.id === id); attList.append(el('div', { class: 'row-card', style: { padding: '6px 10px', alignItems: 'center' } }, el('div', { class: 'grow', style: { fontSize: '13px' }, text: a ? a.title : '(missing file)' }), a ? el('button', { class: 'btn icon ghost', html: svgIcon('download'), title: 'Download', onclick: () => downloadArtifact(a) }) : null, el('button', { class: 'btn icon ghost', html: '×', title: 'Detach', onclick: () => { artifactIds = artifactIds.filter((x) => x !== id); paintAtt(); } }))); }
    attSel.innerHTML = ''; attSel.append(el('option', { value: '', text: arts.length ? '— attach a library file —' : 'Library is empty' }));
    for (const a of arts.filter((x) => !artifactIds.includes(x.id)).sort((x, y) => y.createdAt - x.createdAt)) attSel.append(el('option', { value: a.id, text: a.title }));
  };
  attSel.addEventListener('change', () => { if (attSel.value) { artifactIds.push(attSel.value); paintAtt(); } });
  paintAtt();
  const conflictNote = el('div', { class: 'warn-text full' });
  const compose = () => { const s = `${date.value}T${startT.value || '00:00'}:00`; let e = `${date.value}T${endT.value || '00:00'}:00`; if ((endT.value || '00:00') === '00:00' && date.value) e = isoDateTime(addDays(`${date.value}T00:00:00`, 1)); return [s, e]; };
  const checkConflicts = () => {
    const [s, e] = compose();
    if (!date.value || parseLocal(e) <= parseLocal(s)) { conflictNote.textContent = date.value ? 'End must be after start.' : ''; return; }
    const c = findConflicts(blocks, s, e, base.id).filter((o) => !(occurrence && o.block.id === base.id));
    conflictNote.textContent = c.length ? `Overlaps: ${c.map((o) => `${o.block.title} ${fmtTime(o.startISO)}–${fmtTime(o.endISO)}`).join(', ')}` : '';
  };
  for (const i of [date, startT, endT]) i.addEventListener('input', checkConflicts);
  checkConflicts();
  const buildRecurrence = () => {
    const v = repeat.value; if (v === 'none') return undefined;
    const r = { freq: v === 'daily' ? 'DAILY' : v === 'monthly' ? 'MONTHLY' : 'WEEKLY', interval: v === 'fortnightly' ? 2 : 1, byday: v === 'weekdays' ? ['MO', 'TU', 'WE', 'TH', 'FR'] : (v === 'weekly' || v === 'fortnightly') ? [...byday].sort((a, b) => DOW_CODES.indexOf(a) - DOW_CODES.indexOf(b)) : null, until: until.value ? parseLocal(until.value) : null };
    if (r.freq === 'WEEKLY' && !r.byday?.length) r.byday = [DOW_CODES[parseLocal(compose()[0]).getDay()]];
    return formatRRule(r);
  };
  const gather = () => {
    const [startISO, endISO] = compose();
    if (!title.value.trim()) { title.focus(); return null; }
    if (!date.value || parseLocal(endISO) <= parseLocal(startISO)) { conflictNote.textContent = 'End must be after start.'; return null; }
    return { title: title.value.trim(), type, startISO, endISO, location: location.value.trim(), notes: notes.value.trim(), recurrence: buildRecurrence(), taskId: taskSel.value || undefined, artifactIds };
  };
  const afterSave = async (patch) => {
    if (patch.taskId) { const t = tasksAll.find((x) => x.id === patch.taskId); if (t && t.status !== 'done') { t.status = 'scheduled'; t.updatedAt = Date.now(); await store.put('tasks', t); } }
    close(); refreshPlannerViews();
  };
  const saveSeries = async () => {
    const p = gather(); if (!p) return;
    if (!isEdit) { await createBlock({ ...p, source: 'manual' }); return afterSave(p); }
    if (recurring) {
      // Keep the series anchored on its first date; apply the new time of day and duration.
      const dur = durationMin(p.startISO, p.endISO);
      p.startISO = `${base.startISO.slice(0, 10)}T${p.startISO.slice(11)}`;
      p.endISO = isoDateTime(addMinutes(p.startISO, dur));
    }
    await updateBlock(base.id, p); return afterSave(p);
  };
  const saveSingle = async () => {
    const p = gather(); if (!p) return;
    delete p.recurrence;
    await overrideOccurrence(block, occurrence.occurrenceDate, p); return afterSave(p);
  };
  const del = async (mode) => {
    if (mode === 'single') { if (!confirm(`Skip "${base.title}" on ${fmtDateShort(occurrence.occurrenceDate)} only?`)) return; await skipOccurrence(block, occurrence.occurrenceDate); }
    else { if (!confirm(recurring ? `Delete the whole "${base.title}" series?` : `Delete "${base.title}"?`)) return; await deleteBlock(base.id); }
    close(); refreshPlannerViews();
  };
  const info = [];
  if (isEdit && recurring) info.push(el('div', { class: 'full small muted', text: `Part of a series: ${describeRRule(base.recurrence)}${occurrence ? ` — you opened ${fmtDateShort(occurrence.occurrenceDate)}` : ''}.` }));
  if (base.overrideOfSeries) info.push(el('div', { class: 'full small muted', text: 'This occurrence was changed from its series; it no longer follows series edits.' }));
  if (base.source === 'ai') info.push(el('div', { class: 'full small muted', text: 'Added by the assistant in chat.' }));
  const dangerBtns = [
    isEdit ? el('button', { class: 'btn', style: { color: 'var(--red)', marginRight: isMobile() ? 0 : 'auto' }, text: recurring && occurrence ? 'Skip this occurrence' : 'Delete', onclick: () => del(recurring && occurrence ? 'single' : 'series') }) : null,
    isEdit && recurring ? el('button', { class: 'btn', style: { color: 'var(--red)' }, text: 'Delete series', onclick: () => del('series') }) : null,
  ].filter(Boolean);
  const close = openModal(isEdit ? 'Edit block' : 'New block', [
    el('div', { class: 'form-grid' },
      field('Title', title, null, 'full'), field('Type', typeChips, null, 'full'),
      field('Date', date), el('div', { class: 'row', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, field('Start', startT), field('End', endT)),
      field('Location', location), field('Repeat', repeat), repeatBox,
      field('Notes', notes, null, 'full'),
      field('Work time for task', taskSel, 'Linking a task marks it as scheduled.'),
      field('Attached resources', el('div', {}, attList, attSel), 'Files from the Library show on this block.'),
      conflictNote, ...info),
    isMobile() && dangerBtns.length ? el('div', { class: 'danger-row' }, ...dangerBtns) : null,
  ], [
    ...(isMobile() ? [] : dangerBtns),
    el('button', { class: 'btn', text: 'Cancel', onclick: () => close() }),
    isEdit && recurring && occurrence ? el('button', { class: 'btn', text: 'Save this occurrence only', onclick: saveSingle }) : null,
    el('button', { class: 'btn primary', text: isEdit ? (recurring ? 'Save whole series' : 'Save') : 'Add block', onclick: saveSeries }),
  ], { wide: true });
  if (!isEdit) title.focus();
}
function importIcs() {
  const input = el('input', { type: 'file', accept: '.ics,text/calendar' });
  input.onchange = async () => {
    const f = input.files?.[0]; if (!f) return;
    try {
      const events = parseIcs(await f.text());
      if (!events.length) { alert('No events found in that file.'); return; }
      const byUid = new Map((await allBlocks()).filter((b) => b.icsUid && !b.overrideOfSeries).map((b) => [b.icsUid, b]));
      let n = 0, modified = 0;
      // Series and one-offs first; modified instances (RECURRENCE-ID) become overrides of their series.
      for (const e of events.filter((x) => !x.recurrenceId)) {
        if (e.uid && byUid.has(e.uid)) continue;
        if (isNaN(parseLocal(e.startISO)) || isNaN(parseLocal(e.endISO))) continue;
        const b = await createBlock({ title: e.title, type: e.type, startISO: e.startISO, endISO: e.endISO, allDay: e.allDay || undefined, location: e.location, notes: e.notes, recurrence: e.recurrence, exdates: e.exdates || [], icsUid: e.uid, source: 'ics' }); n++;
        if (e.uid) byUid.set(e.uid, b);
      }
      for (const e of events.filter((x) => x.recurrenceId)) {
        const series = e.uid ? byUid.get(e.uid) : null;
        if (series?.recurrence) {
          const cur = await store.get('blocks', series.id);
          if ((cur.exdates || []).includes(e.recurrenceId)) continue; // already handled on an earlier import
          await overrideOccurrence(cur, e.recurrenceId, { title: e.title, startISO: e.startISO, endISO: e.endISO, location: e.location, notes: e.notes }); modified++;
        } else if (!series) {
          await createBlock({ title: e.title, type: e.type, startISO: e.startISO, endISO: e.endISO, location: e.location, notes: e.notes, source: 'ics' }); n++;
        }
      }
      toast(`Imported ${n} event${n === 1 ? '' : 's'}${modified ? ` and ${modified} changed occurrence${modified === 1 ? '' : 's'}` : ''} from ${f.name}.`); renderTimetable();
    } catch (e) { alert(`Import failed: ${e.message}`); }
  };
  input.click();
}
async function exportIcs() {
  const blocks = await allBlocks();
  if (!blocks.length) { toast('Nothing to export.'); return; }
  downloadBlob(new Blob([buildIcs(blocks)], { type: 'text/calendar' }), `teach-assist-timetable-${localDateStamp()}.ics`);
}
function importTimetableFromImage() {
  const input = el('input', { type: 'file', accept: 'image/*,.pdf,.docx,.xlsx,.csv' });
  input.onchange = () => {
    const f = input.files?.[0]; if (!f) return;
    const monday = isoDate(startOfWeek(new Date()));
    startChatWith({ send: true, codeTools: true, files: [f], text: `This is my school timetable. Read every class, duty, meeting and free/prep period with its day and start–end time. Then add each one to my timetable with schedule_block as a weekly recurring block (FREQ=WEEKLY;BYDAY=…) starting from Monday ${monday}: type "class" for classes, "duty" for yard/bus duties, "meeting" for meetings, "prep" for free periods. If the timetable has a two-week (A/B) cycle, use INTERVAL=2 and ask me which week this is before scheduling; otherwise don't ask, just schedule everything. Finish with a day-by-day summary of what you added.` });
  };
  input.click();
}
function planWeekWithAI() {
  const from = startOfWeek(TT.anchor), to = addDays(from, 4);
  startChatWith({ send: true, codeTools: false, text: `Plan my week of ${isoDate(from)} to ${isoDate(to)}. First call list_tasks and list_timetable_blocks for that range. Then schedule work time for my open tasks (most urgent first) as "prep" blocks linked to each task (taskId), only in free slots on those days between 08:00 and 17:00, keeping 12:30–13:15 free for lunch, never overlapping existing blocks, each block 30–90 minutes. Show me the resulting plan day by day and list anything that did not fit.` });
}
function clearWeekPrompt(blocks) {
  const from = startOfWeek(TT.anchor), to = endOfDay(addDays(from, 6));
  const occ = expandOccurrences(blocks, from, to);
  if (!occ.length) { toast('Nothing in this week.'); return; }
  const oneOff = occ.filter((o) => !o.isRecurrence).length, rec = occ.length - oneOff;
  if (!confirm(`Clear ${fmtDateShort(from)} – ${fmtDateShort(addDays(from, 6))}?\n\n${oneOff} one-off block${oneOff === 1 ? '' : 's'} will be deleted and ${rec} occurrence${rec === 1 ? '' : 's'} of recurring blocks will be skipped (the series stay).`)) return;
  executeClientTool('clear_timetable_range', { fromISO: isoDateTime(from), toISO: isoDateTime(to) }).then((r) => toast(r.summary)).catch((e) => alert(e.message));
}

/* ═════════════════════════════════ Library ═════════════════════════════════ */
const LIB = { q: '', kind: '' };
const KIND_LABEL = { document: 'Document', slides: 'Slides', spreadsheet: 'Spreadsheet', pdf: 'PDF', image: 'Image', code: 'Code', archive: 'Archive', other: 'File' };
async function downloadArtifact(a) { const rec = await getCachedFile(a.fileKey); if (rec) downloadBlob(rec.blob, a.title); else alert('This file is no longer cached in this browser (it was deleted with its chat or session).'); }
async function renderLibrary() {
  const root = $('#view-library');
  const arts = (await store.all('artifacts')).sort((a, b) => b.createdAt - a.createdAt);
  const q = LIB.q.trim().toLowerCase();
  const shown = arts.filter((a) => (!LIB.kind || a.kind === LIB.kind) && (!q || `${a.title} ${a.conversationTitle || ''} ${(a.tags || []).join(' ')}`.toLowerCase().includes(q)));
  const search = el('input', { type: 'search', value: LIB.q, placeholder: 'Search files and chats…', style: { width: '220px' } });
  let timer; search.addEventListener('input', () => { LIB.q = search.value; clearTimeout(timer); timer = setTimeout(renderLibrary, 180); });
  const kinds = [...new Set(arts.map((a) => a.kind))].sort();
  const kindSel = selectEl([['', 'All types'], ...kinds.map((k) => [k, KIND_LABEL[k] || k])], LIB.kind); kindSel.className = 'sel';
  kindSel.addEventListener('change', () => { LIB.kind = kindSel.value; renderLibrary(); });
  root.innerHTML = '';
  root.append(viewHead('Library', el('span', { class: 'muted small', text: `${shown.length} of ${arts.length} file${arts.length === 1 ? '' : 's'}` }), search, kindSel));
  const body = el('div', { class: 'view-body' });
  if (!arts.length) body.append(el('div', { class: 'empty-note', html: 'Every file the assistant creates in chat (Word, PowerPoint, Excel, PDF, images) is collected here automatically. Ask for one — e.g. <i>"make a 10-question quiz on fractions as a Word document"</i> — with <b>Code &amp; files</b> on.' }));
  else if (!shown.length) body.append(el('div', { class: 'empty-note', text: 'No files match.' }));
  else { const grid = el('div', { class: 'grid-cards' }); for (const a of shown) grid.append(artTile(a)); body.append(grid); }
  root.append(body);
  const sel = root.querySelector('input[type=search]'); if (document.activeElement === document.body && LIB.q) { sel.focus(); sel.setSelectionRange(sel.value.length, sel.value.length); }
}
function artTile(a) {
  const [cls, label] = iconClassFor(a.title, a.mediaType || '');
  const tile = el('div', { class: 'tile' });
  if (a.kind === 'image') { const img = el('img', { alt: a.title, style: { width: '100%', height: '120px', objectFit: 'cover', borderRadius: '8px', background: 'var(--bg-elev)' } }); fileUrl(a.fileKey).then((u) => { if (u) img.src = u; }); tile.append(img); }
  tile.append(el('div', { class: 'ttl' }, el('span', { class: `ic ${cls}`, style: { fontSize: '10px', padding: '2px 5px', borderRadius: '5px' }, text: label }), el('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: a.title, text: a.title })));
  tile.append(el('p', { text: `${KIND_LABEL[a.kind] || 'File'} · ${fmtBytes(a.size)} · ${new Date(a.createdAt).toLocaleDateString()}${a.conversationTitle ? `\nFrom: ${a.conversationTitle}` : ''}`, style: { whiteSpace: 'pre-line' } }));
  tile.append(el('div', { class: 'foot' },
    el('button', { class: 'btn icon ghost', html: svgIcon('download'), title: 'Download', onclick: () => downloadArtifact(a) }),
    a.conversationId ? el('button', { class: 'btn sm', text: 'Open chat', onclick: async () => { if (!state.convs.some((c) => c.id === a.conversationId)) { toast('That chat no longer exists.'); return; } showView('chat'); await selectConversation(a.conversationId); } }) : null,
    el('button', { class: 'btn sm', text: 'Attach…', title: 'Attach to a timetable block', onclick: () => attachArtifactPrompt(a) }),
    el('button', { class: 'btn icon ghost', html: svgIcon('trash'), title: 'Remove from library', onclick: async () => {
      if (!confirm(`Remove "${a.title}" from the library? The file stays available in its chat.`)) return;
      await store.del('artifacts', a.id);
      for (const b of await allBlocks()) if (b.artifactIds?.includes(a.id)) await updateBlock(b.id, { artifactIds: b.artifactIds.filter((x) => x !== a.id) });
      if (!state.convs.some((c) => c.id === a.conversationId)) await store.del('files', a.fileKey).catch(() => {});
      renderLibrary();
    } })));
  return tile;
}
async function attachArtifactPrompt(a) {
  const blocks = await allBlocks();
  if (!blocks.length) { toast('No timetable blocks to attach to yet.'); return; }
  const upcoming = expandOccurrences(blocks, startOfDay(new Date()), endOfDay(addDays(new Date(), 28)));
  const seen = new Set(); const opts = [];
  for (const o of upcoming) { if (seen.has(o.block.id)) continue; seen.add(o.block.id); opts.push([o.block.id, `${o.block.title} — ${fmtDateShort(o.startISO)} ${fmtTime(o.startISO)}${o.block.recurrence ? ' (series)' : ''}`]); }
  for (const b of blocks) if (!seen.has(b.id)) opts.push([b.id, `${b.title} — ${fmtDateShort(b.startISO)}`]);
  const sel = selectEl(opts, opts[0]?.[0]);
  const close = openModal(`Attach "${a.title}"`, [field('Timetable block', sel)], [
    el('button', { class: 'btn', text: 'Cancel', onclick: () => close() }),
    el('button', { class: 'btn primary', text: 'Attach', onclick: async () => { const r = await executeClientTool('attach_resource_to_block', { blockId: sel.value, artifactId: a.id }); close(); toast(r.summary); } }),
  ]);
}

/* ═════════════════════════════════ Studio ═════════════════════════════════ */
const STUDIO = [
  { id: 'lesson', title: 'Lesson plan', icon: 'file', desc: 'Objectives, sequence with timings, differentiation, formative checks and resources.', fields: ['subject', 'year', 'topic', 'duration', 'extras'], output: 'docx' },
  { id: 'unit', title: 'Unit plan', icon: 'file', desc: 'A multi-week unit: big ideas, lesson-by-lesson outline, assessment plan.', fields: ['subject', 'year', 'topic', 'weeks', 'extras'], output: 'docx' },
  { id: 'worksheet', title: 'Worksheet', icon: 'edit', desc: 'Scaffolded practice with worked examples and a full answer key.', fields: ['subject', 'year', 'topic', 'count', 'extras'], output: 'docx' },
  { id: 'quiz', title: 'Quiz / test', icon: 'check', desc: 'Mixed question types with marks, answer key and marking notes.', fields: ['subject', 'year', 'topic', 'count', 'extras'], output: 'docx' },
  { id: 'slides', title: 'Slide deck', icon: 'image', desc: 'A teaching deck with clear visuals, checks for understanding and speaker notes.', fields: ['subject', 'year', 'topic', 'slides', 'extras'], output: 'pptx' },
  { id: 'rubric', title: 'Rubric', icon: 'check', desc: 'Criteria × levels with descriptors a student can act on.', fields: ['subject', 'year', 'topic', 'extras'], output: 'docx' },
  { id: 'exit', title: 'Exit tickets', icon: 'edit', desc: 'Short end-of-lesson checks, several variants, with expected answers.', fields: ['subject', 'year', 'topic', 'extras'], output: 'docx' },
  { id: 'differentiate', title: 'Differentiate a resource', icon: 'refresh', desc: 'Attach a worksheet or text; get support, core and extension versions.', fields: ['year', 'extras'], output: 'docx', needsFiles: true },
  { id: 'feedback', title: 'Feedback on student work', icon: 'brain', desc: 'Attach student work; get specific feedback against your criteria.', fields: ['subject', 'year', 'extras'], output: 'chat', needsFiles: true },
  { id: 'letter', title: 'Letter / email home', icon: 'file', desc: 'Excursion, behaviour, celebration, reminders — warm, clear and short.', fields: ['audience', 'topic', 'extras'], output: 'docx' },
  { id: 'reports', title: 'Report comments', icon: 'edit', desc: 'Personalised comment bank from your notes, in your school’s tone.', fields: ['subject', 'year', 'extras'], output: 'xlsx' },
  { id: 'custom', title: 'Anything else', icon: 'code', desc: 'Describe the resource you need and the format you want.', fields: ['extras'], output: 'docx' },
];
const STUDIO_FIELDS = {
  subject: ['Subject', 'text', 'e.g. Mathematics'], year: ['Year level', 'text', 'e.g. Year 9'], topic: ['Topic / focus', 'text', 'e.g. Pythagoras’ theorem'],
  duration: ['Lesson length (minutes)', 'number', '60'], weeks: ['Length (weeks)', 'number', '5'], count: ['Number of questions', 'number', '15'], slides: ['Number of slides', 'number', '12'],
  audience: ['To', 'text', 'e.g. Year 7 parents and carers'], extras: ['Anything else', 'textarea', 'Curriculum codes, texts in use, student needs, tone, school name, things to include or avoid…'],
};
const OUTPUTS = [['docx', 'Word document (.docx)'], ['pptx', 'PowerPoint (.pptx)'], ['xlsx', 'Excel (.xlsx)'], ['pdf', 'PDF'], ['chat', 'In the chat (no file)']];
function renderStudio() {
  const root = $('#view-studio');
  root.innerHTML = '';
  root.append(viewHead('Studio', el('span', { class: 'muted small', text: 'Pick a resource. The model builds it as a real file in a new chat (Code & files on).' })));
  const body = el('div', { class: 'view-body' });
  const grid = el('div', { class: 'grid-cards' });
  for (const g of STUDIO) grid.append(el('div', { class: 'tile clickable', onclick: () => openStudioForm(g) }, el('div', { class: 'ttl', html: `${svgIcon(g.icon)}<span>${escapeHtml(g.title)}</span>` }), el('p', { text: g.desc }), el('div', { class: 'foot' }, el('span', { class: 'pill', style: { background: 'var(--accent-soft)', color: 'var(--accent)' }, text: g.needsFiles ? 'attach files' : (OUTPUTS.find((o) => o[0] === g.output)?.[1] || '').replace(/ \(.*/, '') }))));
  body.append(grid);
  root.append(body);
}
function openStudioForm(g) {
  const inputs = {};
  const nodes = [];
  for (const k of g.fields) {
    const [label, type, ph] = STUDIO_FIELDS[k];
    const inp = type === 'textarea' ? el('textarea', { rows: 4, placeholder: ph }) : el('input', { type, placeholder: ph, value: type === 'number' ? ph : '' });
    inputs[k] = inp; nodes.push(field(label, inp, null, type === 'textarea' ? 'full' : ''));
  }
  const out = selectEl(OUTPUTS, g.output);
  if (!g.needsFiles || g.output !== 'chat') nodes.push(field('Deliver as', out));
  const prompt = () => composeStudioPrompt(g, Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()])), out.value);
  const close = openModal(g.title, [
    el('div', { class: 'form-grid' }, ...nodes),
    g.needsFiles ? el('div', { class: 'help', style: { marginTop: '8px' }, text: 'This one needs your file(s): the chat opens with the request filled in — attach the files, then press Enter.' }) : null,
  ], [
    el('button', { class: 'btn', text: 'Cancel', onclick: () => close() }),
    el('button', { class: 'btn', text: g.needsFiles ? 'Open in chat & attach files' : 'Open in chat to edit', onclick: () => { close(); startChatWith({ text: prompt(), codeTools: out.value !== 'chat', send: false }); } }),
    g.needsFiles ? null : el('button', { class: 'btn primary', text: 'Generate now', onclick: () => { close(); startChatWith({ text: prompt(), codeTools: out.value !== 'chat', send: true }); } }),
  ], { wide: true });
  (inputs.subject || inputs.topic || inputs.audience || inputs.extras)?.focus();
}
function composeStudioPrompt(g, f, output) {
  const ctx = [f.subject && `Subject: ${f.subject}`, f.year && `Year level: ${f.year}`, f.topic && `Topic: ${f.topic}`].filter(Boolean).join('. ');
  const fmt = output === 'chat' ? 'Give the complete content here in the chat, well formatted.' : `Deliver it as a ${output === 'docx' ? 'Word document (.docx)' : output === 'pptx' ? 'PowerPoint deck (.pptx)' : output === 'xlsx' ? 'Excel workbook (.xlsx)' : 'PDF'} built with the document tools, complete and ready to use — no placeholders.`;
  const extras = f.extras ? `\n\nAdditional details: ${f.extras}` : '';
  let body;
  switch (g.id) {
    case 'lesson': body = `Write a complete ${f.duration || 60}-minute lesson plan. ${ctx}. Include: learning intentions and success criteria (student-facing), prior knowledge and misconceptions, a timed sequence (hook, explicit teaching, guided and independent practice, closure) with teacher and student actions and all questions/prompts written out, differentiation (support and extension), formative assessment with expected answers, resources and a homework/follow-up option.`; break;
    case 'unit': body = `Design a ${f.weeks || 5}-week unit plan. ${ctx}. Include: rationale and big ideas, learning outcomes, a week-by-week and lesson-by-lesson outline (focus, key activities, checks for understanding), the assessment plan (formative and summative, with a brief task description and success criteria), differentiation strategies, key vocabulary and resources.`; break;
    case 'worksheet': body = `Create a worksheet with ${f.count || 15} questions. ${ctx}. Start with a short recap and two fully worked examples, then questions that increase in difficulty (fluency → application → reasoning), with space to work. Add a challenge question. Put a complete answer key with working on the final page(s).`; break;
    case 'quiz': body = `Create a quiz/test with ${f.count || 15} questions. ${ctx}. Mix question types (multiple choice, short answer, one or two extended responses), state marks per question and the total, order from easier to harder, and include a full answer key with marking notes/acceptable alternatives. Make it classroom-ready with a name/date line.`; break;
    case 'slides': body = `Create a teaching slide deck of about ${f.slides || 12} slides. ${ctx}. Structure: title, learning intentions, hook, explicit teaching in small steps with examples, checks for understanding (questions with answers revealed on the next slide), guided practice, summary, exit question. Keep text lean, use visuals/diagrams where they help, and add speaker notes with what to say and ask on each slide.`; break;
    case 'rubric': body = `Create an assessment rubric. ${ctx}. Use 4–6 criteria and 4 performance levels with specific, observable descriptors written so students can see how to improve, plus a marks/grades conversion and a short feedback section.`; break;
    case 'exit': body = `Create a set of 5 exit-ticket variants (3–4 quick questions each). ${ctx}. Cover the key ideas and common misconceptions, include the expected answers for the teacher, and a one-line "what to do tomorrow" note for each possible result pattern.`; break;
    case 'differentiate': body = `I am attaching a resource. Produce three differentiated versions for ${f.year || 'my class'}: Support (scaffolded, simplified language, hints, fewer steps), Core (equivalent to the original, tidied), and Extension (deeper reasoning and open-ended questions). Keep the same learning goal. Include answer keys for each.`; break;
    case 'feedback': body = `I am attaching student work${f.subject ? ` for ${f.subject}` : ''}${f.year ? ` (${f.year})` : ''}. Give specific, constructive feedback for each piece: what is done well, the two or three most important improvements with concrete examples, and a short next-step. Use a warm, direct tone suitable to show the student. If I provide criteria or a rubric, assess against them.`; break;
    case 'letter': body = `Write a letter/email to ${f.audience || 'parents and carers'}${f.topic ? ` about: ${f.topic}` : ''}. Warm, clear and concise; plain language; the key information first (what, when, where, what to do); a short closing with contact details placeholder for me to fill. Offer a subject line.`; break;
    case 'reports': body = `Build a report-comment bank${f.subject ? ` for ${f.subject}` : ''}${f.year ? `, ${f.year}` : ''}: a spreadsheet with columns for Strand/Skill, Achievement level (Excellent / Good / Satisfactory / Developing), Comment (2–3 sentences, student-name placeholder [Name], he/she/they variants), and Next step. Cover at least 6 strands. Comments must be specific, positive in tone, and free of jargon.`; break;
    default: body = `Please create the following teaching resource.${ctx ? ' ' + ctx + '.' : ''}`; break;
  }
  return `${body}${extras}\n\n${fmt}`;
}

/* ═════════════════════════════════ Sessions (clear memory) ═════════════════════════════════ */
async function listSessions() {
  const [recs, convs, tasks, blocks, arts] = await Promise.all([store.all('sessions'), store.all('conversations'), store.all('tasks'), store.all('blocks'), store.all('artifacts')]);
  const doc = await readHistory();
  const map = new Map();
  const get = (id) => { if (!map.has(id)) map.set(id, { id, startedAt: null, endedAt: null, lastActiveAt: null, exchanges: 0, convs: 0, tasks: 0, blocks: 0, artifacts: 0 }); return map.get(id); };
  for (const r of recs) Object.assign(get(r.id), { startedAt: r.startedAt, endedAt: r.endedAt || null, lastActiveAt: r.lastActiveAt || r.startedAt });
  for (const s of doc?.sessions || []) { const m = get(s.id); m.exchanges = (s.exchanges || []).length; m.startedAt = m.startedAt || Date.parse(s.startedAt) || null; m.lastActiveAt = Math.max(m.lastActiveAt || 0, Date.parse(s.lastActiveAt || s.startedAt) || 0) || null; if (!m.endedAt && s.endedAt) m.endedAt = Date.parse(s.endedAt); }
  for (const c of convs) { const m = get(c.sessionId || 'ses_unknown'); m.convs++; m.lastActiveAt = Math.max(m.lastActiveAt || 0, c.updatedAt || 0) || null; m.startedAt = m.startedAt || c.createdAt; }
  for (const t of tasks) get(t.sessionId || 'ses_unknown').tasks++;
  for (const b of blocks) get(b.sessionId || 'ses_unknown').blocks++;
  for (const a of arts) get(a.sessionId || 'ses_unknown').artifacts++;
  if (!map.has(SESSION.id)) get(SESSION.id).startedAt = SESSION.startedAt;
  return [...map.values()].filter((m) => m.id === SESSION.id || m.exchanges || m.convs || m.tasks || m.blocks || m.artifacts || m.startedAt).sort((a, b) => (b.id === SESSION.id) - (a.id === SESSION.id) || ((b.lastActiveAt || b.startedAt || 0) - (a.lastActiveAt || a.startedAt || 0)));
}
function renderSessionsList(host, refresh) {
  host.innerHTML = '';
  host.append(el('div', { class: 'muted small', text: 'Loading sessions…' }));
  listSessions().then((list) => {
    host.innerHTML = '';
    const checks = new Map();
    const fmtWhen = (ms) => ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
    for (const s of list) {
      const chk = el('input', { type: 'checkbox', class: 'chk', style: { marginTop: 0 } }); checks.set(s.id, chk);
      const isCur = s.id === SESSION.id;
      const bits = [s.convs || s.exchanges ? `${Math.max(s.convs, 0)} chat${s.convs === 1 ? '' : 's'} / ${s.exchanges} exchange${s.exchanges === 1 ? '' : 's'}` : 'no chats', s.tasks ? `${s.tasks} task${s.tasks === 1 ? '' : 's'}` : null, s.blocks ? `${s.blocks} timetable block${s.blocks === 1 ? '' : 's'}` : null, s.artifacts ? `${s.artifacts} file${s.artifacts === 1 ? '' : 's'}` : null].filter(Boolean);
      host.append(el('div', { class: `sess-row${isCur ? ' current' : ''}`, 'data-session': s.id }, chk,
        el('div', { class: 'grow' },
          el('div', {}, isCur ? el('b', { text: 'This session' }) : el('span', { text: s.id === 'ses_imported_v1' ? 'Imported history (v1 file)' : s.id === 'ses_unknown' ? 'Before sessions were tracked' : `Session ${fmtWhen(s.startedAt)}` }), isCur && !s.endedAt ? el('span', { class: 'pill', style: { background: 'var(--accent-soft)', color: 'var(--accent)', marginLeft: '8px' }, text: 'open' }) : null),
          el('div', { class: 'meta', text: `${isCur ? `Started ${fmtWhen(s.startedAt)}` : `Last active ${fmtWhen(s.lastActiveAt || s.startedAt)}`} · ${bits.join(' · ')}` })),
        el('button', { class: 'btn sm', text: isCur ? 'Clear this session' : 'Clear', onclick: () => clearSessionsPrompt([s.id], refresh) })));
    }
    host.append(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } },
      el('button', { class: 'btn sm', text: 'Clear selected', onclick: () => { const ids = [...checks].filter(([, c]) => c.checked).map(([id]) => id); if (!ids.length) { toast('Tick the sessions to clear first.'); return; } clearSessionsPrompt(ids, refresh); } }),
      el('button', { class: 'btn sm', style: { color: 'var(--red)' }, text: 'Clear all sessions', onclick: () => clearSessionsPrompt(null, refresh) })));
  }).catch((e) => { host.innerHTML = ''; host.append(el('div', { class: 'warn-text', text: `Couldn't list sessions: ${e.message}` })); });
}
function clearSessionsPrompt(ids, refresh) {
  const all = ids === null;
  const msg = all ? 'Clear ALL sessions? Every chat, task, timetable block and generated file in this browser is deleted and the history file is emptied. Your settings and API keys are kept.' : `Clear ${ids.length === 1 ? (ids[0] === SESSION.id ? 'this session' : 'this session') : `${ids.length} sessions`}? The chats, tasks, timetable blocks and files created in ${ids.length === 1 ? 'it' : 'them'} are removed from this browser and from the history file.`;
  if (!confirm(msg)) return;
  (all ? clearAllSessions() : clearSessions(ids)).then(() => { toast(all ? 'All sessions cleared.' : 'Session memory cleared.'); if (typeof refresh === 'function') refresh(); }).catch((e) => alert(`Clear failed: ${e.message}`));
}
async function clearSessions(ids) {
  const set = new Set(ids);
  await historyQueue;
  const waits = [];
  for (const [cid, ctl] of state.busy) { const c = state.convs.find((x) => x.id === cid); if (c && set.has(c.sessionId || 'ses_unknown')) { state.purged.add(cid); ctl.abort(); if (state.turns.has(cid)) waits.push(state.turns.get(cid)); } }
  await Promise.allSettled(waits);
  for (const c of await store.all('conversations')) if (set.has(c.sessionId || 'ses_unknown')) await purgeConversation(c.id);
  for (const m of await store.all('messages')) if (set.has(m.sessionId || 'ses_unknown')) {
    for (const a of m.attachments || []) if (a.blobKey) await store.del('files', a.blobKey).catch(() => {});
    for (const f of m.files || []) if (f.key) await store.del('files', f.key).catch(() => {});
    await store.del('messages', m.id);
  }
  for (const t of await store.all('tasks')) if (set.has(t.sessionId || 'ses_unknown')) await store.del('tasks', t.id);
  for (const b of await store.all('blocks')) if (set.has(b.sessionId || 'ses_unknown')) await store.del('blocks', b.id);
  for (const a of await store.all('artifacts')) if (set.has(a.sessionId || 'ses_unknown')) { await store.del('files', a.fileKey).catch(() => {}); await store.del('artifacts', a.id); }
  for (const id of set) await store.del('sessions', id).catch(() => {});
  await queueHistory(async () => { const doc = await readHistory(); if (!doc) return; doc.sessions = doc.sessions.filter((s) => !set.has(s.id)); doc.updated = new Date().toISOString(); await writeHistory(doc); });
  if (set.has(SESSION.id)) { SESSION.startedAt = Date.now(); await store.put('sessions', { id: SESSION.id, startedAt: SESSION.startedAt, lastActiveAt: Date.now(), endedAt: null }); }
  DIRTY.session = false;
  await loadConversations();
  await selectConversation(state.convs[0]?.id || null);
  refreshPlannerViews();
}
async function clearAllSessions() {
  await historyQueue;
  for (const [cid, ctl] of state.busy) { state.purged.add(cid); ctl.abort(); }
  await Promise.allSettled([...state.turns.values()]);
  for (const s of ['conversations', 'messages', 'files', 'tasks', 'blocks', 'artifacts', 'sessions']) await store.clear(s);
  await clearHistory();
  for (const u of state.fileBlobUrls.values()) URL.revokeObjectURL(u); state.fileBlobUrls.clear();
  SESSION.startedAt = Date.now();
  await store.put('sessions', { id: SESSION.id, startedAt: SESSION.startedAt, lastActiveAt: Date.now(), endedAt: null });
  DIRTY.session = false;
  await loadConversations();
  await selectConversation(null);
  refreshPlannerViews();
}
