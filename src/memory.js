/* ═══════════════════════════════════════════════════════════════════════════
   Saved memory — lasting notes about the teacher (facts, preferences, standing instructions).
   • Kept in this browser's IndexedDB ("memory" store). Clearing chats or sessions never touches
     it; only "Forget everything" in the Memory manager (or deleting single notes) does.
   • Every new chat gets the pinned notes plus the newest ones (up to MEM_PROMPT_BUDGET characters)
     in its system prompt; the rest are found with memory_search.
   • Claude and OpenAI save, search, update and delete notes through the memory_* tools.
   ═══════════════════════════════════════════════════════════════════════════ */
const MEM_PROMPT_BUDGET = 9000;
const memOn = () => settings.savedMemory !== false;
const memClean = (s) => String(s || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
async function memoryAll() {
  const all = await store.all('memory').catch(() => []);
  return all.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
}
async function memorySave(items, source = 'chat') {
  const existing = await memoryAll();
  const byText = new Map(existing.map((n) => [n.text.toLowerCase(), n]));
  const saved = [];
  for (const it of items) {
    const text = memClean(it.text).slice(0, 2000);
    if (!text) continue;
    const dup = byText.get(text.toLowerCase());
    if (dup) { dup.updatedAt = Date.now(); if (it.pinned !== undefined) dup.pinned = !!it.pinned; await store.put('memory', dup); saved.push(dup); continue; }
    const n = { id: uid('mem'), text, topic: memClean(it.topic).slice(0, 60) || 'general', pinned: !!it.pinned, source, createdAt: Date.now(), updatedAt: Date.now() };
    await store.put('memory', n); byText.set(text.toLowerCase(), n); saved.push(n);
  }
  memoryChanged();
  return saved;
}
async function memoryUpdate(id, patch) {
  const n = await store.get('memory', id); if (!n) throw new Error(`No memory note ${id}`);
  if (patch.text !== undefined) n.text = memClean(patch.text).slice(0, 2000);
  if (patch.topic !== undefined) n.topic = memClean(patch.topic).slice(0, 60) || 'general';
  if (patch.pinned !== undefined) n.pinned = !!patch.pinned;
  n.updatedAt = Date.now();
  await store.put('memory', n); memoryChanged();
  return n;
}
async function memoryDelete(ids) { for (const id of [].concat(ids)) await store.del('memory', id).catch(() => {}); memoryChanged(); }
async function memoryClear() { await store.clear('memory'); memoryChanged(); }
function memoryChanged() { MEM_UI.repaint?.(); }
/** Simple relevance: shared words (and prefixes) between the query and the note/topic. */
function memoryRank(notes, query) {
  const words = (s) => String(s).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  const q = [...new Set(words(query))];
  if (!q.length) return notes;
  return notes.map((n) => {
    const w = words(`${n.text} ${n.topic}`);
    let s = 0; for (const t of q) { if (w.includes(t)) s += 2; else if (w.some((x) => x.startsWith(t) || t.startsWith(x))) s += 1; }
    return { n, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.n);
}
/** The block that goes into a new chat's system prompt: pinned first, then newest, within the budget. */
async function memoryPromptBlock(budget = MEM_PROMPT_BUDGET) {
  if (!memOn()) return { text: '', included: 0, total: 0 };
  const notes = await memoryAll();
  const lines = []; let used = 0;
  for (const n of notes) {
    const line = `- [${n.id}] (${n.topic}) ${n.text.replace(/\n+/g, ' / ')}`;
    if (used + line.length > budget) continue;
    lines.push(line); used += line.length + 1;
  }
  return { text: lines.join('\n'), included: lines.length, total: notes.length };
}
function memoryPromptSection(snap) {
  if (!snap) return '';
  const more = snap.total > snap.included ? ` ${snap.total - snap.included} older notes are not shown here — use memory_search when the teacher refers to something you don't see.` : '';
  return `
# Saved memory (kept on the teacher's device across chats)
You DO have long-term memory: these notes persist between chats and sessions until the teacher deletes them.${more}
- When the teacher asks you to remember something, or states a lasting fact, preference or standing instruction (classes, school, conventions, how they like things done), save it with memory_save — short self-contained notes in their words; many at once is fine. Correct or remove notes that become wrong (memory_update / memory_delete).
- Use the notes silently where they change your answer; don't recite them.
- Save sensitive personal details (health, family, colleagues, unannounced news) only when the teacher explicitly asks. Never save passwords, API keys or tokens.
- If the teacher pastes a long memory export, save its useful facts with memory_save in batches, or suggest Settings → Memory → Import, which lets them untick sections.
${snap.text ? `Notes:\n${snap.text}` : 'No notes saved yet.'}`;
}

/* ───────────── Tools (offered to Claude and OpenAI through CLIENT_TOOLS) ───────────── */
const MEMORY_TOOLS = [
  { name: 'memory_save', kind: 'memory', title: 'Saving to memory', description: "Save one or more lasting notes about the teacher (facts, preferences, standing instructions) to their device's long-term memory, so future chats know them.", input_schema: { type: 'object', properties: { notes: { type: 'array', items: { type: 'object', properties: { text: { type: 'string', description: 'One self-contained fact, in plain words' }, topic: { type: 'string', description: 'Short topic, e.g. profile, preferences, classes, a project name' }, pinned: { type: 'boolean', description: 'Always include in every chat (use for core profile and preferences)' } }, required: ['text'] } } }, required: ['notes'] } },
  { name: 'memory_search', kind: 'memory', title: 'Searching memory', description: 'Search all saved memory notes (including older ones not shown in the prompt). Empty query lists the newest.', input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', description: 'Default 30' } } } },
  { name: 'memory_update', kind: 'memory', title: 'Updating memory', description: 'Change a saved note (by its id, e.g. mem_…).', input_schema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, topic: { type: 'string' }, pinned: { type: 'boolean' } }, required: ['id'] } },
  { name: 'memory_delete', kind: 'memory', title: 'Forgetting a note', description: 'Delete saved notes that are wrong or that the teacher wants forgotten.', input_schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } },
];
async function executeMemoryTool(name, i = {}) {
  if (!memOn()) throw new Error('Saved memory is switched off in Settings.');
  switch (name) {
    case 'memory_save': {
      const items = Array.isArray(i.notes) ? i.notes : i.text ? [{ text: i.text, topic: i.topic, pinned: i.pinned }] : [];
      if (!items.length) throw new Error('notes is empty');
      const saved = await memorySave(items, 'chat');
      return { content: { ok: true, saved: saved.map((n) => ({ id: n.id, topic: n.topic, text: n.text })) }, summary: `${saved.length} note${saved.length === 1 ? '' : 's'} saved` };
    }
    case 'memory_search': {
      const all = await memoryAll();
      const hits = (i.query ? memoryRank(all, i.query) : all).slice(0, Math.min(+i.limit || 30, 100));
      return { content: { total: all.length, results: hits.map((n) => ({ id: n.id, topic: n.topic, pinned: n.pinned, text: n.text })) }, summary: `${hits.length} of ${all.length}` };
    }
    case 'memory_update': { const n = await memoryUpdate(String(i.id || ''), i); return { content: { ok: true, note: { id: n.id, topic: n.topic, pinned: n.pinned, text: n.text } }, summary: 'note updated' }; }
    case 'memory_delete': { const ids = [].concat(i.ids || i.id || []).map(String); await memoryDelete(ids); return { content: { ok: true, deleted: ids.length }, summary: `${ids.length} forgotten` }; }
    default: throw new Error(`Unknown memory tool ${name}`);
  }
}

/* ───────────── Importing an export (Markdown, text or JSON) ───────────── */
/** Split an export into notes, keeping the heading or file name each line sits under as its topic. */
function parseMemoryImport(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  const out = [];
  const json = parseJsonLoose(text.trim());
  if (json) {
    const arr = Array.isArray(json) ? json : Array.isArray(json.notes) ? json.notes : Array.isArray(json.memory) ? json.memory : null;
    if (arr) { for (const x of arr) { const t = typeof x === 'string' ? x : x?.text || x?.content; if (t) out.push({ text: t, topic: x?.topic || 'imported', pinned: !!x?.pinned }); } return out; }
  }
  let topic = 'imported', inFront = false, para = [];
  const flush = () => { const t = memClean(para.join(' ')); if (t) out.push({ text: t, topic }); para = []; };
  for (const lineRaw of text.split('\n')) {
    const line = lineRaw.trim();
    if (line === '---') { flush(); inFront = !inFront; continue; }
    if (inFront) { const m = line.match(/^name:\s*(.+)$/i); if (m) topic = memClean(m[1]).replace(/^["']|["']$/g, ''); continue; }
    const h = line.match(/^#{1,6}\s+(.+)$/) || line.match(/^(?:={3,}|-{3,})\s*(.+?)\s*(?:={3,}|-{3,})$/) || line.match(/^(?:FILE|File):\s*(.+)$/);
    if (h) { flush(); topic = memClean(h[1]).replace(/^\//, '').replace(/\.md$/i, '').replace(/^(areas|topics|people|projects)\//, '$1: ') || topic; continue; }
    if (!line) { flush(); continue; }
    const b = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (b) { flush(); const t = memClean(b[1].replace(/^\[(stated|inferred|[a-z]+)\]\s*/i, '').replace(/\s*\(for=\w+\)\s*$/, '')); if (t) out.push({ text: t, topic }); continue; }
    if (/^(description|sources|aliases):/i.test(line)) continue;
    para.push(line);
  }
  flush();
  return out.filter((n) => n.text.length > 2);
}

/* ───────────── Memory manager ───────────── */
const MEM_UI = { repaint: null, filter: '' };
async function openMemorySheet() {
  const body = el('div', { class: 'mem-sheet' });
  const close = openModal('Memory', [body], null, { wide: true });
  const search = el('input', { type: 'search', placeholder: 'Search notes…', value: MEM_UI.filter, class: 'mem-search' });
  search.addEventListener('input', () => { MEM_UI.filter = search.value; paintList(); });
  const listHost = el('div', { class: 'mem-list' });
  const statLine = el('div', { class: 'help' });
  const newText = el('textarea', { rows: 2, placeholder: 'Add something to remember, e.g. “Use Australian spelling and VCAA terminology.”' });
  const newTopic = el('input', { type: 'text', placeholder: 'Topic (optional)', class: 'mem-topic' });
  const onBox = el('input', { type: 'checkbox' }); onBox.checked = memOn();
  onBox.addEventListener('change', () => { saveSettings({ savedMemory: onBox.checked }); paintList(); });
  const paintList = async () => {
    if (!listHost.isConnected && MEM_UI.repaint) { /* first paint */ }
    const all = await memoryAll();
    const snap = await memoryPromptBlock();
    statLine.textContent = !memOn() ? 'Saved memory is off: notes are kept but not used.' : all.length ? `${all.length} note${all.length === 1 ? '' : 's'} · ${snap.included} go with every new chat (pinned first, then newest, up to ${MEM_PROMPT_BUDGET.toLocaleString()} characters)${snap.total > snap.included ? '; the rest are searched when relevant' : ''}.` : 'Nothing saved yet. Tell the assistant “remember that…”, add a note here, or import an export.';
    const shown = MEM_UI.filter ? memoryRank(all, MEM_UI.filter) : all;
    const inPrompt = new Set((snap.text.match(/\[(mem_[^\]]+)\]/g) || []).map((x) => x.slice(1, -1)));
    const groups = new Map();
    for (const n of shown) { if (!groups.has(n.topic)) groups.set(n.topic, []); groups.get(n.topic).push(n); }
    listHost.innerHTML = '';
    for (const [topic, notes] of groups) {
      listHost.append(el('div', { class: 'mem-group' },
        el('div', { class: 'mem-gh' }, el('span', { text: topic }), el('span', { class: 'mem-count', text: String(notes.length) }),
          el('button', { class: 'btn ghost sm danger-txt', text: 'Delete topic', onclick: async () => { if (confirm(`Delete all ${notes.length} notes under “${topic}”?`)) await memoryDelete(notes.map((n) => n.id)); } })),
        ...notes.map((n) => {
          const row = el('div', { class: `mem-row${n.pinned ? ' pinned' : ''}${inPrompt.has(n.id) ? ' inprompt' : ''}`, 'data-id': n.id });
          const txt = el('div', { class: 'mem-text', text: n.text });
          row.append(
            el('button', { class: `mem-pin${n.pinned ? ' on' : ''}`, title: n.pinned ? 'Pinned: always included — click to unpin' : 'Pin: always include in every chat', 'aria-label': n.pinned ? 'Unpin' : 'Pin', 'aria-pressed': String(!!n.pinned), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>', onclick: () => memoryUpdate(n.id, { pinned: !n.pinned }) }),
            txt,
            el('button', { class: 'btn icon ghost sm', title: 'Edit', 'aria-label': 'Edit note', html: svgIcon('edit'), onclick: () => {
              const ta = el('textarea', { rows: 3 }); ta.value = n.text;
              const save = el('button', { class: 'btn sm primary', text: 'Save', onclick: () => memoryUpdate(n.id, { text: ta.value }) });
              txt.replaceWith(el('div', { class: 'mem-edit' }, ta, el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } }, save, el('button', { class: 'btn sm', text: 'Cancel', onclick: paintList }))));
              ta.focus();
            } }),
            el('button', { class: 'btn icon ghost sm', title: 'Forget this note', 'aria-label': 'Delete note', html: svgIcon('trash'), onclick: () => memoryDelete(n.id) }));
          return row;
        })));
    }
    if (!shown.length && all.length) listHost.append(el('div', { class: 'help', text: 'No notes match.' }));
  };
  MEM_UI.repaint = () => { if (!body.isConnected) { MEM_UI.repaint = null; return; } paintList(); };
  body.append(
    el('div', { class: 'help mem-intro', html: 'Notes the assistant keeps about you <b>on this device</b>. They stay until you delete them — clearing chats or sessions doesn’t touch them. Pinned and newest notes are sent with your requests to Claude, OpenAI or the on-device model; the rest are searched when relevant.' }),
    el('label', { class: 'check', style: { margin: '10px 0 4px' } }, onBox, el('span', {}, 'Use saved memory', el('span', { class: 'help', text: 'Off: notes are kept but not sent, and the assistant can’t save new ones.' }))),
    el('div', { class: 'm-section' }, el('h3', { text: 'Add a note' }), newText,
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, newTopic,
        el('button', { class: 'btn sm primary', text: 'Remember', onclick: async () => { if (!newText.value.trim()) return; await memorySave([{ text: newText.value, topic: newTopic.value }], 'manual'); newText.value = ''; toast('Saved to memory.'); } }),
        el('button', { class: 'btn sm', text: 'Import notes…', onclick: () => { close(); openMemoryImport(); } }),
        el('button', { class: 'btn sm', text: 'Export (JSON)', onclick: async () => downloadBlob(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), notes: (await memoryAll()).map(({ text, topic, pinned, createdAt, updatedAt }) => ({ text, topic, pinned, createdAt, updatedAt })) }, null, 1)], { type: 'application/json' }), `teach-assist-memory-${localDateStamp()}.json`) }),
        el('button', { class: 'btn sm danger-txt', text: 'Forget everything', onclick: async () => { if (!confirm('Delete every saved memory note from this device? This cannot be undone.')) return; await memoryClear(); toast('Memory cleared.'); } }))),
    el('div', { class: 'm-section' }, el('h3', { text: 'Saved notes' }), statLine, search, listHost));
  paintList();
}
function openMemoryImport() {
  const ta = el('textarea', { rows: 8, placeholder: 'Paste a memory export (Markdown, plain text or JSON)…', class: 'mem-import' });
  const file = el('input', { type: 'file', accept: '.md,.txt,.json,text/*,application/json' });
  const preview = el('div', { class: 'mem-preview' });
  let parsed = [], chosen = new Set();
  const paint = () => {
    parsed = parseMemoryImport(ta.value);
    const topics = [...new Set(parsed.map((n) => n.topic))];
    for (const t of [...chosen]) if (!topics.includes(t)) chosen.delete(t);
    for (const t of topics) if (!paint.seen?.has(t)) { chosen.add(t); (paint.seen ||= new Set()).add(t); }
    preview.innerHTML = '';
    if (!parsed.length) { preview.append(el('div', { class: 'help', text: ta.value.trim() ? 'No notes found in that text.' : 'Notes appear here, grouped by section.' })); return; }
    const sensitive = /people|family|son|wife|health|ndis|medical|disab|colleague|job|restructur|embargo|award|redundan|salary|finance/i;
    preview.append(el('div', { class: 'help', html: `<b>${parsed.length} notes</b> in ${topics.length} section${topics.length === 1 ? '' : 's'}. Untick anything you'd rather not send to the AI provider — sections that look personal are marked.` }));
    for (const t of topics) {
      const n = parsed.filter((x) => x.topic === t);
      const cb = el('input', { type: 'checkbox' }); cb.checked = chosen.has(t);
      cb.addEventListener('change', () => { if (cb.checked) chosen.add(t); else chosen.delete(t); count.textContent = label(); });
      preview.append(el('label', { class: 'check mem-topic-row' }, cb, el('span', {}, `${t} `, el('span', { class: 'mem-count', text: String(n.length) }), sensitive.test(`${t} ${n.map((x) => x.text).join(' ')}`.slice(0, 4000)) ? el('span', { class: 'lm-chip fit-tight', text: 'personal', style: { marginLeft: '6px' } }) : null, el('span', { class: 'help', text: n.slice(0, 2).map((x) => x.text).join(' · ').slice(0, 160) }))));
    }
    count.textContent = label();
  };
  const label = () => { const k = parsed.filter((n) => chosen.has(n.topic)).length; return `Import ${k} note${k === 1 ? '' : 's'}`; };
  const count = el('button', { class: 'btn primary', text: 'Import', onclick: async () => {
    const pick = parsed.filter((n) => chosen.has(n.topic));
    if (!pick.length) return;
    const pinTopic = /^(profile|preferences?)$/i;
    const saved = await memorySave(pick.map((n) => ({ ...n, pinned: n.pinned || pinTopic.test(n.topic) })), 'import');
    toast(`${saved.length} notes saved to memory.`);
    closeImp(); openMemorySheet();
  } });
  ta.addEventListener('input', () => { clearTimeout(paint.t); paint.t = setTimeout(paint, 250); });
  file.addEventListener('change', async () => { const f = file.files?.[0]; if (!f) return; ta.value = await f.text(); paint(); });
  const closeImp = openModal('Import memory', [
    el('div', { class: 'help', text: 'Paste an export from another assistant (or choose a file). Each bullet or paragraph becomes a note, grouped by the heading it sits under. Profile and preference sections are pinned.' }),
    ta, el('div', { style: { margin: '8px 0' } }, file), preview,
  ], [el('button', { class: 'btn', text: 'Cancel', onclick: () => closeImp() }), count], { wide: true });
  paint();
}
