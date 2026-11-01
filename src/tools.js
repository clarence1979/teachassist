/* ═══════════════════════════════════════════════════════════════════════════
   App tools the model can call (tasks, timetable, library) — one registry,
   offered to Claude as client tools and to OpenAI as function tools.
   ═══════════════════════════════════════════════════════════════════════════ */

const PRIORITY_WORDS = { urgent: 1, high: 2, medium: 3, low: 4, someday: 5 };
const PRIORITY_LABEL = { 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low', 5: 'someday' };
const BLOCK_TYPE_ENUM = BLOCK_TYPES.map((t) => t.value);
const DT = { type: 'string', description: 'Local date-time YYYY-MM-DDTHH:MM:SS (no timezone suffix)' };
const D = { type: 'string', description: 'Local date YYYY-MM-DD' };

const CLIENT_TOOLS = [
  { name: 'add_task', kind: 'task', title: 'Adding a task', description: "Add a task to the teacher's to-do list.", input_schema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, deadline: { ...DT, description: 'Optional due date-time, local YYYY-MM-DDTHH:MM:SS' }, estimatedDurationMin: { type: 'number', description: 'Estimated minutes of work' }, priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'someday'] }, tags: { type: 'array', items: { type: 'string' } } }, required: ['title'] } },
  { name: 'list_tasks', kind: 'task', title: 'Reading the task list', description: "List the teacher's tasks, optionally filtered by status or a search term.", input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['inbox', 'scheduled', 'done', 'all'], description: 'Default: everything not done' }, query: { type: 'string', description: 'Case-insensitive match on title, description or tags' } } } },
  { name: 'update_task', kind: 'task', title: 'Updating a task', description: 'Change a task (title, deadline, priority, status, …). Pass only the fields to change. Use status "done" to complete it.', input_schema: { type: 'object', properties: { taskId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, deadline: { ...DT, description: 'New due date-time, or "" to clear' }, estimatedDurationMin: { type: 'number' }, priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'someday'] }, status: { type: 'string', enum: ['inbox', 'scheduled', 'done'] }, tags: { type: 'array', items: { type: 'string' } } }, required: ['taskId'] } },
  { name: 'delete_task', kind: 'task', title: 'Deleting a task', description: 'Delete a task permanently.', input_schema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] } },
  { name: 'schedule_block', kind: 'timetable', title: 'Adding to the timetable', description: 'Add a block to the timetable (a class, prep, meeting, duty, PD, personal or custom block). For a recurring class pass an RRULE, e.g. "FREQ=WEEKLY;BYDAY=MO,WE" or "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU" for fortnightly.', input_schema: { type: 'object', properties: { title: { type: 'string' }, type: { type: 'string', enum: BLOCK_TYPE_ENUM }, startISO: DT, endISO: DT, location: { type: 'string' }, notes: { type: 'string' }, recurrence: { type: 'string', description: 'Optional RRULE (FREQ=DAILY|WEEKLY|MONTHLY; INTERVAL; BYDAY; UNTIL=YYYYMMDD; COUNT)' }, taskId: { type: 'string', description: 'Optional task this block is work time for (marks the task scheduled)' } }, required: ['title', 'startISO', 'endISO'] } },
  { name: 'list_timetable_blocks', kind: 'timetable', title: 'Reading the timetable', description: 'List timetable occurrences in a date range (default: today to 14 days ahead), with the block IDs needed for edits. Recurring blocks are expanded to their occurrences.', input_schema: { type: 'object', properties: { fromISO: { ...D, description: 'Start of range (date or date-time)' }, toISO: { ...D, description: 'End of range (date or date-time)' }, type: { type: 'string', enum: BLOCK_TYPE_ENUM }, titleContains: { type: 'string' }, limit: { type: 'number', description: 'Max occurrences to return (default 80)' } } } },
  { name: 'update_timetable_block', kind: 'timetable', title: 'Changing a timetable block', description: 'Edit a block. For a recurring block the change applies to the whole series unless scope="single" with occurrenceDateISO, which changes only that occurrence.', input_schema: { type: 'object', properties: { blockId: { type: 'string' }, title: { type: 'string' }, type: { type: 'string', enum: BLOCK_TYPE_ENUM }, startISO: DT, endISO: DT, location: { type: 'string' }, notes: { type: 'string' }, recurrence: { type: 'string', description: 'New RRULE, or "" to stop repeating' }, status: { type: 'string', enum: ['scheduled', 'done', 'cancelled'] }, scope: { type: 'string', enum: ['series', 'single'] }, occurrenceDateISO: D }, required: ['blockId'] } },
  { name: 'delete_timetable_block', kind: 'timetable', title: 'Removing from the timetable', description: 'Delete a block. For a recurring block, scope="single" with occurrenceDateISO skips just that occurrence; otherwise the whole series goes.', input_schema: { type: 'object', properties: { blockId: { type: 'string' }, scope: { type: 'string', enum: ['series', 'single'] }, occurrenceDateISO: D }, required: ['blockId'] } },
  { name: 'clear_timetable_range', kind: 'timetable', title: 'Clearing part of the timetable', description: 'Remove every occurrence that overlaps a time window (one-off blocks are deleted; recurring blocks skip just the occurrences inside the window). Use this before re-planning a day.', input_schema: { type: 'object', properties: { fromISO: DT, toISO: DT, excludeBlockIds: { type: 'array', items: { type: 'string' } }, types: { type: 'array', items: { type: 'string', enum: BLOCK_TYPE_ENUM }, description: 'Only clear these types (default all)' } }, required: ['fromISO', 'toISO'] } },
  { name: 'search_library', kind: 'library', title: 'Searching the library', description: "Search the teacher's library of generated files (documents, slides, spreadsheets, images) by title or chat.", input_schema: { type: 'object', properties: { query: { type: 'string' }, kind: { type: 'string', enum: ['document', 'slides', 'spreadsheet', 'pdf', 'image', 'code', 'archive', 'other'] }, limit: { type: 'number' } } } },
  { name: 'attach_resource_to_block', kind: 'library', title: 'Attaching a resource', description: 'Attach a library file to a timetable block so it shows on that lesson.', input_schema: { type: 'object', properties: { blockId: { type: 'string' }, artifactId: { type: 'string' } }, required: ['blockId', 'artifactId'] } },
];

function clientToolDefs({ imageTool }) {
  const defs = CLIENT_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  if (imageTool) defs.push(IMAGE_TOOL_DEF);
  return defs;
}
function clientToolMeta(name) {
  const t = CLIENT_TOOLS.find((x) => x.name === name);
  if (name === 'generate_image') return { kind: 'image', title: 'Generating an image' };
  return t ? { kind: t.kind, title: t.title } : { kind: 'other', title: name || 'Tool' };
}
function clientToolQuery(name, input = {}) {
  switch (name) {
    case 'add_task': case 'update_task': return input.title || input.taskId || '';
    case 'delete_task': return input.taskId || '';
    case 'schedule_block': return `${input.title || ''}${input.startISO ? ' · ' + fmtDateShort(input.startISO) + ' ' + fmtTime(input.startISO) : ''}`;
    case 'list_timetable_blocks': return input.fromISO ? `${input.fromISO.slice(0, 10)} → ${(input.toISO || '').slice(0, 10)}` : 'next 14 days';
    case 'update_timetable_block': case 'delete_timetable_block': return input.blockId || '';
    case 'clear_timetable_range': return `${(input.fromISO || '').replace('T', ' ').slice(0, 16)} → ${(input.toISO || '').replace('T', ' ').slice(0, 16)}`;
    case 'search_library': return input.query || input.kind || '';
    case 'list_tasks': return input.query || input.status || '';
    case 'generate_image': return (input.prompt || '').slice(0, 120);
    default: return '';
  }
}

/* ───────────────────────────── Execution ───────────────────────────── */
const asStr = (v, d = '') => (typeof v === 'string' ? v : d);
const asNum = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);
function normDT(v, what = 'date-time') { if (v === undefined || v === null || String(v).trim() === '') throw new Error(`${what} is required (local YYYY-MM-DDTHH:MM:SS)`); const d = parseLocal(v); if (isNaN(d)) throw new Error(`Bad ${what} "${v}" — use YYYY-MM-DDTHH:MM:SS`); return isoDateTime(d); }
function normRange(fromV, toV, { defaultDays = 14 } = {}) {
  const from = fromV ? parseLocal(fromV) : startOfDay(new Date());
  if (isNaN(from)) throw new Error(`Bad fromISO "${fromV}" — use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS`);
  let to = toV ? parseLocal(toV) : endOfDay(addDays(from, defaultDays));
  if (isNaN(to)) throw new Error(`Bad toISO "${toV}" — use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS`);
  if (toV && String(toV).length <= 10) to = endOfDay(to);
  if (to < from) throw new Error('toISO is before fromISO');
  return [from, to];
}
function taskView(t) { return { id: t.id, title: t.title, description: t.description || '', status: t.status, priority: PRIORITY_LABEL[t.priority] || 'medium', deadline: t.deadline ? isoDateTime(new Date(t.deadline)) : null, estimatedDurationMin: t.estimatedDurationMin, tags: t.tags || [] }; }
function occView(o) { return { blockId: o.block.id, title: o.block.title, type: o.block.type, date: o.occurrenceDate, day: DOW_LABELS[parseLocal(o.startISO).getDay()], start: o.startISO, end: o.endISO, location: o.block.location || '', recurring: !!o.block.recurrence, recurrence: o.block.recurrence || null, status: o.block.status || 'scheduled', attachments: (o.block.artifactIds || []).length, taskId: o.block.taskId || null }; }

async function executeClientTool(name, input, ctx = {}) {
  input = input || {};
  switch (name) {
    case 'add_task': {
      const title = asStr(input.title).trim(); if (!title) throw new Error('title is required');
      const t = { id: uid('task'), title, description: asStr(input.description), deadline: input.deadline ? parseLocal(normDT(input.deadline)).getTime() : undefined, estimatedDurationMin: asNum(input.estimatedDurationMin, 30), priority: PRIORITY_WORDS[asStr(input.priority, 'medium')] || 3, tags: Array.isArray(input.tags) ? input.tags.map(String) : [], status: 'inbox', source: 'ai', createdAt: Date.now(), updatedAt: Date.now() };
      await store.put('tasks', t); refreshPlannerViews();
      return { content: { ok: true, task: taskView(t) }, summary: `Added "${title}"` };
    }
    case 'list_tasks': {
      const status = asStr(input.status, 'open'); const q = asStr(input.query).toLowerCase();
      let tasks = await store.all('tasks');
      if (status === 'open') tasks = tasks.filter((t) => t.status !== 'done'); else if (status !== 'all') tasks = tasks.filter((t) => t.status === status);
      if (q) tasks = tasks.filter((t) => `${t.title} ${t.description || ''} ${(t.tags || []).join(' ')}`.toLowerCase().includes(q));
      tasks.sort((a, b) => (a.priority - b.priority) || ((a.deadline || Infinity) - (b.deadline || Infinity)));
      return { content: { count: tasks.length, tasks: tasks.slice(0, 100).map(taskView) }, summary: `${tasks.length} task${tasks.length === 1 ? '' : 's'}` };
    }
    case 'update_task': {
      const t = await store.get('tasks', asStr(input.taskId)); if (!t) throw new Error('Task not found — call list_tasks for current IDs');
      if (typeof input.title === 'string') t.title = input.title;
      if (typeof input.description === 'string') t.description = input.description;
      if (input.deadline !== undefined) t.deadline = input.deadline ? parseLocal(normDT(input.deadline)).getTime() : undefined;
      if (input.estimatedDurationMin !== undefined) t.estimatedDurationMin = asNum(input.estimatedDurationMin, t.estimatedDurationMin);
      if (input.priority) t.priority = PRIORITY_WORDS[input.priority] || t.priority;
      if (input.status) t.status = input.status;
      if (Array.isArray(input.tags)) t.tags = input.tags.map(String);
      t.updatedAt = Date.now();
      await store.put('tasks', t); refreshPlannerViews();
      return { content: { ok: true, task: taskView(t) }, summary: `Updated "${t.title}"` };
    }
    case 'delete_task': {
      const t = await store.get('tasks', asStr(input.taskId)); if (!t) throw new Error('Task not found');
      await store.del('tasks', t.id); refreshPlannerViews();
      return { content: { ok: true, deleted: t.title }, summary: `Deleted "${t.title}"` };
    }
    case 'schedule_block': {
      const title = asStr(input.title).trim(); if (!title) throw new Error('title is required');
      const startISO = normDT(input.startISO, 'startISO'), endISO = normDT(input.endISO, 'endISO');
      if (parseLocal(endISO) <= parseLocal(startISO)) throw new Error('endISO must be after startISO');
      const type = BLOCK_TYPE_ENUM.includes(input.type) ? input.type : 'custom';
      const blocks = await allBlocks();
      const conflicts = findConflicts(blocks, startISO, endISO);
      const b = await createBlock({ title, type, startISO, endISO, location: asStr(input.location), notes: asStr(input.notes), recurrence: asStr(input.recurrence) || undefined, taskId: asStr(input.taskId) || undefined, source: 'ai' });
      if (b.taskId) { const t = await store.get('tasks', b.taskId); if (t && t.status !== 'done') { t.status = 'scheduled'; t.updatedAt = Date.now(); await store.put('tasks', t); } }
      refreshPlannerViews();
      return { content: { ok: true, block: occView({ block: b, startISO, endISO, occurrenceDate: isoDate(startISO) }), repeats: describeRRule(b.recurrence), conflicts: conflicts.map((o) => `${o.block.title} ${fmtTime(o.startISO)}–${fmtTime(o.endISO)}`) }, summary: `${title} · ${fmtDateShort(startISO)} ${fmtTime(startISO)}–${fmtTime(endISO)}${b.recurrence ? ' · ' + describeRRule(b.recurrence) : ''}${conflicts.length ? ` · overlaps ${conflicts.length}` : ''}` };
    }
    case 'list_timetable_blocks': {
      const [from0, to] = normRange(input.fromISO, input.toISO);
      const from = startOfDay(from0);
      let occ = expandOccurrences(await allBlocks(), from, to);
      if (input.type) occ = occ.filter((o) => o.block.type === input.type);
      if (input.titleContains) { const q = String(input.titleContains).toLowerCase(); occ = occ.filter((o) => o.block.title.toLowerCase().includes(q)); }
      const limit = asNum(input.limit, 80);
      return { content: { range: { from: isoDateTime(from), to: isoDateTime(to) }, count: occ.length, occurrences: occ.slice(0, limit).map(occView) }, summary: `${occ.length} occurrence${occ.length === 1 ? '' : 's'} ${isoDate(from)} → ${isoDate(to)}` };
    }
    case 'update_timetable_block': {
      const b = await store.get('blocks', asStr(input.blockId)); if (!b) throw new Error('Block not found — call list_timetable_blocks for current IDs');
      const patch = {};
      for (const k of ['title', 'type', 'location', 'notes', 'status']) if (typeof input[k] === 'string') patch[k] = input[k];
      if (input.startISO !== undefined) patch.startISO = normDT(input.startISO, 'startISO');
      if (input.endISO !== undefined) patch.endISO = normDT(input.endISO, 'endISO');
      if (typeof input.recurrence === 'string') patch.recurrence = input.recurrence || undefined;
      const oldDur = durationMin(b.startISO, b.endISO);
      if (b.recurrence && input.scope === 'single') {
        const date = asStr(input.occurrenceDateISO).slice(0, 10); if (!date || isNaN(parseLocal(date))) throw new Error('occurrenceDateISO (YYYY-MM-DD) is required for scope "single"');
        const s0 = patch.startISO || `${date}T${b.startISO.slice(11)}`;
        const e0 = patch.endISO ? (patch.startISO || patch.endISO.slice(0, 10) === date ? patch.endISO : `${date}T${patch.endISO.slice(11)}`) : isoDateTime(addMinutes(s0, oldDur));
        if (parseLocal(e0) <= parseLocal(s0)) throw new Error('endISO must be after startISO');
        patch.startISO = s0; patch.endISO = e0;
        const nb = await overrideOccurrence(b, date, patch); refreshPlannerViews();
        return { content: { ok: true, scope: 'single', block: occView({ block: nb, startISO: nb.startISO, endISO: nb.endISO, occurrenceDate: isoDate(nb.startISO) }) }, summary: `Changed ${b.title} on ${fmtDateShort(date)} only` };
      }
      if (b.recurrence) {
        // Editing a series: keep it anchored on its first date; take only the time of day from the new values.
        const day = b.startISO.slice(0, 10);
        if (patch.startISO) patch.startISO = `${day}T${patch.startISO.slice(11)}`;
        if (patch.endISO) patch.endISO = `${day}T${patch.endISO.slice(11)}`;
        if (patch.startISO && !patch.endISO) patch.endISO = isoDateTime(addMinutes(patch.startISO, oldDur));
      } else if (patch.startISO && !patch.endISO) patch.endISO = isoDateTime(addMinutes(patch.startISO, oldDur));
      const fs = patch.startISO || b.startISO, fe = patch.endISO || b.endISO;
      if (parseLocal(fe) <= parseLocal(fs)) {
        if (fe.slice(11) === '00:00:00') patch.endISO = isoDateTime(addDays(fe, 1)); // "until midnight"
        else throw new Error(`endISO (${fe}) must be after startISO (${fs})`);
      }
      const nb = await updateBlock(b.id, patch); refreshPlannerViews();
      if (patch.taskId !== undefined || nb.taskId) await reconcileTaskStatus(nb.taskId || b.taskId);
      return { content: { ok: true, scope: 'series', block: occView({ block: nb, startISO: nb.startISO, endISO: nb.endISO, occurrenceDate: isoDate(nb.startISO) }), repeats: describeRRule(nb.recurrence) }, summary: `Updated ${nb.title}` };
    }
    case 'delete_timetable_block': {
      const b = await store.get('blocks', asStr(input.blockId)); if (!b) throw new Error('Block not found — call list_timetable_blocks for current IDs');
      if (b.recurrence && input.scope === 'single') {
        const date = asStr(input.occurrenceDateISO).slice(0, 10); if (!date) throw new Error('occurrenceDateISO is required for scope "single"');
        await skipOccurrence(b, date); refreshPlannerViews();
        return { content: { ok: true, skipped: date, day: DOW_LABELS[parseLocal(date).getDay()] }, summary: `Skipped ${b.title} on ${fmtDateShort(date)}` };
      }
      await deleteBlock(b.id); refreshPlannerViews();
      return { content: { ok: true, deleted: b.title, wasSeries: !!b.recurrence }, summary: `Deleted ${b.title}${b.recurrence ? ' (whole series)' : ''}` };
    }
    case 'clear_timetable_range': {
      if (!input.fromISO || !input.toISO) throw new Error('fromISO and toISO are required');
      const [from, to] = normRange(input.fromISO, input.toISO);
      const exclude = new Set(Array.isArray(input.excludeBlockIds) ? input.excludeBlockIds : []);
      const types = Array.isArray(input.types) && input.types.length ? new Set(input.types) : null;
      const occ = expandOccurrences(await allBlocks(), from, to).filter((o) => !exclude.has(o.block.id) && (!types || types.has(o.block.type)));
      let deleted = 0, skipped = 0; const removed = [];
      for (const o of occ) {
        if (o.isRecurrence) { const cur = await store.get('blocks', o.block.id); if (cur) await skipOccurrence(cur, o.occurrenceDate); skipped++; }
        else { await deleteBlock(o.block.id); deleted++; }
        removed.push(`${o.block.title} (${o.occurrenceDate} ${fmtTime(o.startISO)})`);
      }
      const remaining = expandOccurrences(await allBlocks(), from, to).filter((o) => !exclude.has(o.block.id) && (!types || types.has(o.block.type)));
      refreshPlannerViews();
      return { content: { ok: remaining.length === 0, from: isoDateTime(from), fromDay: DOW_LABELS[from.getDay()], to: isoDateTime(to), toDay: DOW_LABELS[to.getDay()], deleted, skippedOccurrences: skipped, removed, remainingInWindow: remaining.map(occView) }, summary: `Cleared ${deleted + skipped} between ${fmtDateShort(from)} ${fmtTime(from)} and ${fmtDateShort(to)} ${fmtTime(to)}${remaining.length ? ` — ${remaining.length} remain` : ''}` };
    }
    case 'search_library': {
      const q = asStr(input.query).toLowerCase(); const kind = asStr(input.kind);
      let arts = await store.all('artifacts');
      if (kind) arts = arts.filter((a) => a.kind === kind);
      if (q) arts = arts.filter((a) => `${a.title} ${a.conversationTitle || ''} ${(a.tags || []).join(' ')}`.toLowerCase().includes(q));
      arts.sort((a, b) => b.createdAt - a.createdAt);
      const limit = asNum(input.limit, 20);
      return { content: { count: arts.length, files: arts.slice(0, limit).map((a) => ({ artifactId: a.id, title: a.title, kind: a.kind, size: a.size, created: isoDateTime(new Date(a.createdAt)), fromChat: a.conversationTitle || '' })) }, summary: `${arts.length} file${arts.length === 1 ? '' : 's'}` };
    }
    case 'attach_resource_to_block': {
      const b = await store.get('blocks', asStr(input.blockId)); if (!b) throw new Error('Block not found');
      const a = await store.get('artifacts', asStr(input.artifactId)); if (!a) throw new Error('Library file not found — call search_library for IDs');
      const ids = new Set(b.artifactIds || []); ids.add(a.id);
      await updateBlock(b.id, { artifactIds: [...ids] }); refreshPlannerViews();
      return { content: { ok: true, block: b.title, attached: a.title }, summary: `Attached ${a.title} to ${b.title}` };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

/* ───────────────────────────── One-off model calls (utilities) ─────────────────────────────
   Used by "Prioritise with AI" and similar helpers: a short, non-streaming request to the
   currently selected provider that returns text. */
async function quickComplete({ system, prompt, maxTokens = 2000 }) {
  const provider = ensureUsableProvider() || settings.provider;
  if (turnProvider() === 'local' || provider === 'local') return localComplete({ system, prompt, maxTokens: Math.min(maxTokens, LOCAL_MAX_OUT) });
  const key = keyFor(provider);
  if (!key) throw new Error(`No ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key`);
  if (provider === 'anthropic') {
    const caps = anthropicCaps(settings.anthropicModel);
    const body = { model: settings.anthropicModel, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] };
    if (caps.effort) body.output_config = { effort: 'low' };
    const res = await fetch(`${SPEC.anthropic.base}/v1/messages`, { method: 'POST', headers: anthropicHeaders(key), body: JSON.stringify(body) });
    if (!res.ok) throw await anthropicError(res);
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
  const caps = openaiCaps(settings.openaiModel);
  const body = { model: settings.openaiModel, instructions: system, input: prompt, store: false, max_output_tokens: maxTokens };
  if (caps.reasoning) body.reasoning = { effort: 'low' };
  const res = await fetch(`${SPEC.openai.base}/v1/responses`, { method: 'POST', headers: openaiHeaders(key), body: JSON.stringify(body) });
  if (!res.ok) throw await openaiError(res);
  const data = await res.json();
  return data.output_text || (data.output || []).flatMap((it) => (it.content || []).filter((c) => c.type === 'output_text').map((c) => c.text)).join('');
}
