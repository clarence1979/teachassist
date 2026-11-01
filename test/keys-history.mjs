// Tests: keys from the main program (api_cache + iframe postMessage handshake) and the chat-history JSON file.
import pw from '/opt/npm-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const appHtml = readFileSync(path.join(here, '..', 'index.html'));
// A stand-in "main program": stores keys in api_cache and answers the frame handshake.
const mainHtml = `<!doctype html><html><body><h1>Main program</h1>
<iframe id="ta" src="/teach-assist.html" style="width:1200px;height:800px"></iframe>
<script>
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'REQUEST_API_VALUES') {
      e.source.postMessage({ type: 'API_VALUES_RESPONSE', data: { username: 'clarence', isAdmin: true, OPENAI_API_KEY: 'sk-from-main-openai', CLAUDE_API_KEY: 'sk-ant-from-main' } }, '*');
    }
  });
</script></body></html>`;
const mk = (port) => http.createServer((req, res) => {
  if (req.url.startsWith('/main.html')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(mainHtml); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(appHtml);
});
const s1 = mk(); await new Promise((r) => s1.listen(0, '127.0.0.1', r));
const s2 = mk(); await new Promise((r) => s2.listen(0, '127.0.0.1', r)); // second origin (different port) for cross-origin framing
const A = `http://127.0.0.1:${s1.address().port}`;
const B = `http://127.0.0.1:${s2.address().port}`;

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const fails = [];
const check = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails.push(m); };
const keysSeen = [];
let replyN = 0;

const browser = await chromium.launch();
async function newCtx() {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request(); const url = req.url();
    keysSeen.push(req.headers()['x-api-key']);
    if (url.includes('/v1/models')) return route.fulfill({ json: { data: [{ id: 'claude-fable-5-1', created_at: '2026-09-01T00:00:00Z' }] } });
    replyN++;
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([
      { type: 'message_start', message: { id: 'm' + replyN, type: 'message', role: 'assistant', content: [], model: 'claude-fable-5-1', usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `Reply number ${replyN}.` } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ]) });
  });
  await ctx.route('https://api.openai.com/**', (route) => route.fulfill({ json: { data: [{ id: 'gpt-6-astra', created: 1 }] } }));
  return ctx;
}
const readSettings = (page) => page.evaluate(() => ({ ...JSON.parse(localStorage.getItem('teachassist.settings.v1') || '{}'), ...(JSON.parse(localStorage.getItem('teachassist.keys.v1') || 'null') || JSON.parse(sessionStorage.getItem('teachassist.keys.session') || '{}')) }));
const histDoc = (page) => page.evaluate(async () => { const c = await caches.open('teach-assist-history'); const keys = await c.keys(); if (!keys.length) return null; return (await c.match(keys[0])).json(); });
async function send(page, text) {
  const n = await page.$$eval('.msg.assistant .actions', (e) => e.length);
  await page.fill('#input', text); await page.click('#sendBtn');
  await page.waitForFunction((k) => document.querySelectorAll('.msg.assistant .actions').length === k + 1, n);
}

console.log('\n[1] Same-origin main program: keys read from localStorage api_cache');
{
  const ctx = await newCtx(); const page = await ctx.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem('api_cache')) localStorage.setItem('api_cache', JSON.stringify({ OPENAI_API_KEY: 'sk-cache-openai', CLAUDE_API_KEY: 'sk-ant-cache', GEMINI_API_KEY: 'g', REPLICATE_API_KEY: 'r', username: 'clarence', isAdmin: true })); });
  await page.goto(`${A}/teach-assist.html`);
  await page.waitForFunction(() => document.querySelector('#modelSel option'));
  const st = await readSettings(page);
  check(st.anthropicKey === 'sk-ant-cache' && st.openaiKey === 'sk-cache-openai', 'Claude and OpenAI keys populated from api_cache');
  check(st.keySource.anthropic === 'main' && st.keySource.openai === 'main', 'keys marked as supplied by the main program');
  check(st.userName === 'clarence', 'username picked up from api_cache');
  check(!(await page.$('.banner.warn')), 'no "add your key" banner');
  await page.click('#settingsBtn');
  check((await page.$$eval('.key-status.ok', (e) => e.filter((x) => /Supplied by the main program/.test(x.textContent)).length)) === 2, 'Settings shows both keys as supplied by the main program');
  // Main program rotates a key → refreshed; user-typed key is never overwritten
  await page.evaluate(() => localStorage.setItem('api_cache', JSON.stringify({ OPENAI_API_KEY: 'sk-cache-openai-2', CLAUDE_API_KEY: 'sk-ant-cache' })));
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modelSel option'));
  check((await readSettings(page)).openaiKey === 'sk-cache-openai-2', 'rotated main-program key is picked up on next launch');
  await page.click('#settingsBtn');
  const inputs = await page.$$('.modal input[type=password]');
  await inputs[0].fill('sk-ant-my-own');
  await page.click('.modal .btn.primary');
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modelSel option'));
  const st2 = await readSettings(page);
  check(st2.anthropicKey === 'sk-ant-my-own' && st2.keySource.anthropic === 'user', 'a key typed in Settings is kept over the main program\'s');
  // Individual-key fallback
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('api_cache', '{}'); localStorage.setItem('openai_api_key', 'sk-indiv'); localStorage.setItem('CLAUDE_API_KEY', 'sk-ant-indiv'); });
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modelSel option'));
  const st3 = await readSettings(page);
  check(st3.openaiKey === 'sk-indiv' && st3.anthropicKey === 'sk-ant-indiv', 'falls back to individual keys (openai_api_key / CLAUDE_API_KEY)');
  await ctx.close();
}

console.log('\n[2] Cross-origin main program: keys via the REQUEST_API_VALUES / API_VALUES_RESPONSE frame handshake');
{
  const ctx = await newCtx(); const page = await ctx.newPage();
  await page.goto(`${B}/main.html`.replace('/main.html', '/main.html'));
  // main.html on origin B frames teach-assist from origin B; make it cross-origin by pointing the iframe at A
  await page.evaluate((a) => { document.getElementById('ta').src = `${a}/teach-assist.html`; }, A);
  const frame = await (await page.waitForSelector('#ta')).contentFrame();
  await frame.waitForFunction(() => ({ ...JSON.parse(localStorage.getItem('teachassist.settings.v1') || '{}'), ...(JSON.parse(localStorage.getItem('teachassist.keys.v1') || 'null') || JSON.parse(sessionStorage.getItem('teachassist.keys.session') || '{}')) }).anthropicKey === 'sk-ant-from-main', null, { timeout: 10000 });
  const st = await frame.evaluate(() => ({ ...JSON.parse(localStorage.getItem('teachassist.settings.v1') || '{}'), ...(JSON.parse(localStorage.getItem('teachassist.keys.v1') || 'null') || JSON.parse(sessionStorage.getItem('teachassist.keys.session') || '{}')) }));
  check(st.anthropicKey === 'sk-ant-from-main' && st.openaiKey === 'sk-from-main-openai', 'keys received from the parent frame');
  // A message from something that is NOT the parent frame is ignored
  await frame.evaluate(() => window.postMessage({ type: 'API_VALUES_RESPONSE', data: { CLAUDE_API_KEY: 'sk-ant-EVIL' } }, '*'));
  await frame.waitForTimeout(400);
  check((await frame.evaluate(() => ({ ...JSON.parse(localStorage.getItem('teachassist.settings.v1') || '{}'), ...(JSON.parse(localStorage.getItem('teachassist.keys.v1') || 'null') || JSON.parse(sessionStorage.getItem('teachassist.keys.session') || '{}')) }).anthropicKey)) === 'sk-ant-from-main', 'message from a non-parent window ignored');
  // Trusted origin set to something else → parent's messages rejected
  await frame.evaluate(() => { const s = JSON.parse(localStorage.getItem('teachassist.settings.v1')); s.trustedParentOrigin = 'https://not-the-parent.example'; s.keySource = { anthropic: '', openai: 'main' }; localStorage.setItem('teachassist.settings.v1', JSON.stringify(s)); const k = JSON.parse(localStorage.getItem('teachassist.keys.v1')); k.anthropicKey = ''; localStorage.setItem('teachassist.keys.v1', JSON.stringify(k)); });
  await page.evaluate((a) => { document.getElementById('ta').src = `${a}/teach-assist.html?r=1`; }, A);
  const frame2 = await (await page.waitForSelector('#ta')).contentFrame();
  await frame2.waitForFunction(() => document.querySelector('#modelSel option'));
  await frame2.waitForTimeout(3000);
  check(!(await frame2.evaluate(() => ({ ...JSON.parse(localStorage.getItem('teachassist.settings.v1') || '{}'), ...(JSON.parse(localStorage.getItem('teachassist.keys.v1') || 'null') || JSON.parse(sessionStorage.getItem('teachassist.keys.session') || '{}')) }).anthropicKey)), 'keys from a parent outside the trusted origin are rejected');
  await ctx.close();
}

console.log('\n[3] History JSON (v2 sessions): append, export, opt-out, import');
{
  const ctx = await newCtx(); const page = await ctx.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem('teachassist.settings.v1')) localStorage.setItem('teachassist.settings.v1', JSON.stringify({ anthropicKey: 'sk-ant-x', provider: 'anthropic', saveHistory: true, codeTools: false, webSearch: false })); });
  await page.goto(`${A}/teach-assist.html`);
  await page.waitForFunction(() => document.querySelector('#modelSel option'));
  await send(page, 'First question about loops');
  await page.waitForTimeout(300);
  let doc = await histDoc(page);
  const ex = (d) => (d?.sessions || []).flatMap((s) => s.exchanges || []);
  check(doc && doc.version === 2 && doc.sessions.length === 1 && ex(doc).length === 1 && ex(doc)[0].user.text === 'First question about loops' && /Reply number/.test(ex(doc)[0].assistant.text), 'first exchange written to teach-assist-history.json (v2, one session) in Cache Storage');
  const sessionId = await page.evaluate(() => SESSION.id);
  check(doc.sessions[0].id === sessionId && doc.sessions[0].startedAt && doc.sessions[0].endedAt === null, 'session entry carries id, startedAt and is still open');
  await send(page, 'Second question');
  await page.click('#newChatBtn');
  await send(page, 'A question in a new chat');
  await page.waitForTimeout(300);
  doc = await histDoc(page);
  check(ex(doc).length === 3 && new Set(ex(doc).map((e) => e.conversationId)).size === 2 && doc.sessions.length === 1, 'subsequent chats append to the same session (3 exchanges across 2 chats)');
  check(ex(doc).every((e) => e.timestamp && e.model === 'claude-fable-5-1' && e.provider === 'anthropic'), 'entries carry timestamp, provider and model');
  await page.click('#settingsBtn');
  await page.waitForFunction(() => /1 session, 3 exchanges from 2 chats/.test(document.querySelector('.modal').textContent));
  check(true, 'Settings shows the history file summary (1 session, 3 exchanges from 2 chats)');
  await page.waitForSelector('.sess-row.current');
  check(/This session/.test(await page.$eval('.sess-row.current', (e) => e.textContent)) && /2 chats \/ 3 exchanges/.test(await page.$eval('.sess-row.current', (e) => e.textContent)), 'sessions list shows the current session with its counts');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export history (JSON)')]);
  const exported = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  const stamp = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  check(dl.suggestedFilename() === `teach-assist-history-${stamp}.json` && ex(exported).length === 3, `export downloads ${dl.suggestedFilename()} with all entries`);
  // Opt out
  await page.click('.modal .m-head .btn');
  await page.click('#settingsBtn');
  await page.uncheck('text=Save history >> xpath=preceding-sibling::input');
  await page.click('.modal .btn.primary');
  await page.click('#newChatBtn');
  await send(page, 'Private question');
  await page.waitForTimeout(300);
  doc = await histDoc(page);
  check(ex(doc).length === 3, 'with saving off, nothing is appended to the history file');
  check(/History saving is off/.test(await page.$eval('#convList', (e) => e.textContent)), 'sidebar shows that history saving is off');
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modelSel option'));
  const titles = await page.$$eval('.conv-item .t', (e) => e.map((x) => x.textContent));
  check(titles.length === 2 && !titles.some((t) => /Private/.test(t)), 'session-only chat is gone after reload; saved chats remain');
  // Import into a fresh browser rebuilds chats from the history file
  const ctx2 = await newCtx(); const p2 = await ctx2.newPage();
  await p2.addInitScript(() => { if (!localStorage.getItem('teachassist.settings.v1')) localStorage.setItem('teachassist.settings.v1', JSON.stringify({ anthropicKey: 'sk-ant-x', provider: 'anthropic' })); });
  await p2.goto(`${A}/teach-assist.html`); await p2.waitForFunction(() => document.querySelector('#modelSel option'));
  await p2.click('#settingsBtn');
  const [ch2] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('text=Import history (JSON)')]);
  p2.once('dialog', (d) => d.accept());
  await ch2.setFiles(await dl.path());
  await p2.waitForFunction(() => document.querySelectorAll('.conv-item').length === 2);
  await p2.click('.modal .m-head .btn');
  await p2.click('.conv-item >> nth=1');
  await p2.waitForFunction(() => document.querySelectorAll('.msg').length >= 4);
  check((await p2.$$eval('.msg.user .bubble', (e) => e.map((x) => x.textContent))).includes('First question about loops'), 'importing the JSON in a fresh browser rebuilds the chats');
  const doc2 = await histDoc(p2);
  check(doc2 && doc2.sessions.some((s) => s.id === sessionId) && ex(doc2).length === 3, 'imported session is merged into the new browser\'s history file under its original id');
  await ctx2.close();
  await ctx.close();
}

console.log('\n[4] Planner: tasks, timetable, library on local storage; mirrored per session; clear memory per session / selected / all');
{
  const ctx = await newCtx(); const page = await ctx.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem('teachassist.settings.v1')) localStorage.setItem('teachassist.settings.v1', JSON.stringify({ anthropicKey: 'sk-ant-x', provider: 'anthropic', saveHistory: true, codeTools: false, webSearch: false })); });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${A}/teach-assist.html`);
  await page.waitForFunction(() => document.querySelector('#modelSel option'));
  // Rail navigation
  await page.click('#rail button[data-view="tasks"]');
  check(await page.$eval('#view-tasks', (e) => !e.classList.contains('hidden')) && await page.$eval('#view-chat', (e) => e.classList.contains('hidden')), 'rail switches to the Tasks view');
  // Add a task via the form
  await page.click('text=+ Task');
  await page.fill('.modal input[placeholder="What needs doing?"]', 'Mark 9B tests');
  await page.selectOption('.modal select', '2');
  await page.click('.modal .btn.primary');
  await page.waitForSelector('.row-card .ttl:text("Mark 9B tests")');
  check(/High/.test(await page.$eval('.row-card', (e) => e.textContent)), 'task added with priority High');
  // Timetable: add a weekly recurring block through the form
  await page.click('#rail button[data-view="timetable"]');
  await page.waitForSelector('.tt-grid');
  await page.click('text=+ Block');
  await page.fill('.modal input[placeholder="e.g. 9B Maths"]', '9B Maths');
  const monday = await page.evaluate(() => isoDate(startOfWeek(new Date())));
  await page.fill('.modal input[type=date]', monday);
  await page.fill('.modal input[type=time] >> nth=0', '09:00');
  await page.fill('.modal input[type=time] >> nth=1', '10:00');
  await page.selectOption('.modal select >> nth=0', 'weekly');
  await page.click('.modal .chips-sel >> nth=1 >> text=Wed');
  await page.click('.modal .btn.primary');
  await page.waitForSelector('.tt-ev');
  const evs = await page.$$eval('.tt-ev .t', (e) => e.map((x) => x.textContent));
  check(evs.filter((t) => t === '9B Maths').length === 2, 'weekly block on Mon+Wed renders twice in the week grid');
  const blocks = await page.evaluate(() => allBlocks());
  check(blocks.length === 1 && /FREQ=WEEKLY;BYDAY=MO,WE/.test(blocks[0].recurrence) && blocks[0].startISO === `${monday}T09:00:00`, `block stored with RRULE ${blocks[0]?.recurrence}`);
  // Model tools: schedule_block via the client tool path (same executor the chat uses)
  const r = await page.evaluate(async (m) => executeClientTool('schedule_block', { title: 'Staff meeting', type: 'meeting', startISO: `${m}T15:30:00`, endISO: `${m}T16:30:00` }), monday);
  check(r.content.ok && /Staff meeting/.test(r.summary), 'schedule_block tool adds a block');
  const list = await page.evaluate(async (m) => executeClientTool('list_timetable_blocks', { fromISO: m, toISO: m }), monday);
  check(list.content.count === 2 && list.content.occurrences.map((o) => o.title).sort().join() === '9B Maths,Staff meeting', 'list_timetable_blocks expands occurrences for the day');
  const upd = await page.evaluate(async (m) => { const b = (await allBlocks()).find((x) => x.title === '9B Maths'); return executeClientTool('update_timetable_block', { blockId: b.id, scope: 'single', occurrenceDateISO: m, startISO: `${m}T11:00:00`, endISO: `${m}T12:00:00` }); }, monday);
  check(upd.content.scope === 'single' && upd.content.block.start === `${monday}T11:00:00`, 'update_timetable_block scope=single moves one occurrence');
  const after = await page.evaluate(() => allBlocks());
  check(after.length === 3 && after.some((b) => b.overrideOfSeries) && after.find((b) => b.recurrence).exdates.includes(monday), 'override block created and the series has the exdate');
  const cleared = await page.evaluate(async (m) => executeClientTool('clear_timetable_range', { fromISO: `${m}T00:00:00`, toISO: `${m}T23:59:59` }), monday);
  check(cleared.content.ok && cleared.content.remainingInWindow.length === 0 && cleared.content.deleted === 2, 'clear_timetable_range empties the day (one-offs deleted, series skipped)');
  const tasksViaTool = await page.evaluate(() => executeClientTool('list_tasks', {}));
  check(tasksViaTool.content.count === 1 && tasksViaTool.content.tasks[0].priority === 'high', 'list_tasks sees the task added in the UI');
  // Chat tool loop: Claude calls add_task → tool_result → final text
  await ctx.unroute('https://api.anthropic.com/**');
  const bodies = [];
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request(); const url = req.url();
    if (url.includes('/v1/models')) return route.fulfill({ json: { data: [{ id: 'claude-fable-5-1', created_at: '2026-09-01T00:00:00Z' }] } });
    const body = JSON.parse(req.postData()); bodies.push(body);
    const last = body.messages[body.messages.length - 1];
    const isToolResult = Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result');
    const events = isToolResult ? [
      { type: 'message_start', message: { id: 'mt2', type: 'message', role: 'assistant', content: [], model: 'claude-fable-5-1', usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Added "Book the bus" to your tasks, due Friday.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' },
    ] : [
      { type: 'message_start', message: { id: 'mt1', type: 'message', role: 'assistant', content: [], model: 'claude-fable-5-1', usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'add_task', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"title": "Book the bus", "priority": "urgent", "deadline": "2026-11-06T15:00:00"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }, { type: 'message_stop' },
    ];
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(events) });
  });
  await page.click('#rail button[data-view="chat"]');
  await page.click('#newChatBtn');
  await send(page, 'Remind me to book the bus by Friday');
  check(bodies[0].tools.some((t) => t.name === 'add_task' && t.input_schema) && /planner \(tools\)/.test(bodies[0].system), 'planner tools offered to Claude and described in the system prompt');
  const tr = bodies[1].messages[bodies[1].messages.length - 1].content[0];
  check(tr.type === 'tool_result' && tr.tool_use_id === 'toolu_1' && /"ok":true/.test(tr.content) && /Book the bus/.test(tr.content), 'tool_result returned to the model with the created task');
  check(/Added "Book the bus"/.test(await page.$eval('.msg.assistant:last-of-type .prose', (e) => e.textContent)), 'final reply rendered after the tool round');
  check(/Adding a task: Book the bus/.test(await page.$eval('.msg.assistant details.card summary', (e) => e.textContent)), 'tool card shows the planner action');
  const allTasks = await page.evaluate(() => store.all('tasks'));
  check(allTasks.length === 2 && allTasks.some((t) => t.title === 'Book the bus' && t.priority === 1 && t.source === 'ai'), 'task created by the model is in the local store');
  // Same loop on OpenAI: function_call → function_call_output continuation → final text
  await ctx.unroute('https://api.openai.com/**');
  const obodies = [];
  await ctx.route('https://api.openai.com/**', async (route) => {
    const req = route.request(); const url = req.url();
    if (url.includes('/v1/models')) return route.fulfill({ json: { data: [{ id: 'gpt-6-astra', created: 1 }] } });
    const body = JSON.parse(req.postData()); obodies.push(body);
    const isOutput = Array.isArray(body.input) && body.input.some((i) => i.type === 'function_call_output');
    const rid = isOutput ? 'resp_2' : 'resp_1';
    const events = isOutput ? [
      { type: 'response.created', response: { id: rid, status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item: { id: 'omsg_1', type: 'message', role: 'assistant', status: 'in_progress', content: [] } },
      { type: 'response.output_text.delta', item_id: 'omsg_1', output_index: 0, content_index: 0, delta: 'Scheduled your staff meeting for Monday 3:30pm.' },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'omsg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Scheduled your staff meeting for Monday 3:30pm.', annotations: [] }] } },
      { type: 'response.completed', response: { id: rid, status: 'completed', usage: { input_tokens: 50, output_tokens: 20 } } },
    ] : [
      { type: 'response.created', response: { id: rid, status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'schedule_block', arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"title":"Staff meeting","type":"meeting",' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: `"startISO":"${monday}T15:30:00","endISO":"${monday}T16:30:00"}` },
      { type: 'response.function_call_arguments.done', item_id: 'fc_1', output_index: 0, arguments: `{"title":"Staff meeting","type":"meeting","startISO":"${monday}T15:30:00","endISO":"${monday}T16:30:00"}` },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'schedule_block', arguments: `{"title":"Staff meeting","type":"meeting","startISO":"${monday}T15:30:00","endISO":"${monday}T16:30:00"}`, status: 'completed' } },
      { type: 'response.completed', response: { id: rid, status: 'completed', usage: { input_tokens: 40, output_tokens: 30 } } },
    ];
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(events) });
  });
  await page.evaluate(() => { saveSettings({ openaiKey: 'sk-test', provider: 'openai' }); });
  await page.selectOption('#providerSel', 'openai');
  await page.waitForFunction(() => /gpt-6-astra/.test(document.querySelector('#hintLabel').textContent));
  await page.click('#newChatBtn');
  await send(page, 'Put a staff meeting on Monday at 3:30');
  check(obodies[0].tools.some((t) => t.type === 'function' && t.name === 'schedule_block' && t.parameters) && /planner \(tools\)/.test(obodies[0].instructions), 'planner tools offered to OpenAI as function tools');
  check(obodies[1].previous_response_id === 'resp_1' && obodies[1].input[0].type === 'function_call_output' && obodies[1].input[0].call_id === 'call_1' && /"ok":true/.test(obodies[1].input[0].output), 'function_call_output chained with previous_response_id');
  check(/Scheduled your staff meeting/.test(await page.$eval('.msg.assistant:last-of-type .prose', (e) => e.textContent)), 'OpenAI final reply rendered after the function round');
  check((await page.evaluate(() => allBlocks())).some((b) => b.title === 'Staff meeting' && b.source === 'ai'), 'block created by OpenAI is in the local store');
  await page.evaluate(() => { saveSettings({ provider: 'anthropic' }); });
  await page.selectOption('#providerSel', 'anthropic');
  // Session mirroring into the history file
  await page.waitForTimeout(3200);
  let doc = await histDoc(page);
  const sid1 = await page.evaluate(() => SESSION.id);
  const ses = doc.sessions.find((s) => s.id === sid1);
  check(ses && ses.tasks.length === 2 && ses.blocks.length === 2 && ses.exchanges.length === 2, `session entry mirrors tasks (${ses?.tasks.length}), blocks (${ses?.blocks.length}) and exchanges (${ses?.exchanges.length})`);
  // Second session (new tab = new sessionStorage) adds its own records
  const page2 = await ctx.newPage();
  await page2.goto(`${A}/teach-assist.html`); await page2.waitForFunction(() => document.querySelector('#modelSel option'));
  const sid2 = await page2.evaluate(() => SESSION.id);
  check(sid2 !== ses.id, 'a new tab starts a new session');
  await page2.evaluate(() => executeClientTool('add_task', { title: 'Task from session two' }));
  await page2.waitForTimeout(3200);
  doc = await histDoc(page2);
  check(doc.sessions.length === 2 && doc.sessions.find((s) => s.id === sid2).tasks.length === 1, 'second session mirrored separately in the JSON');
  // Closing the tab finalises the session (endedAt)
  await page2.close();
  await page.waitForTimeout(300);
  await page.evaluate(() => finaliseStaleSessions());
  await page.waitForTimeout(900);
  doc = await histDoc(page);
  check(!!doc.sessions.find((s) => s.id === sid2).endedAt, 'a closed tab\'s session is finalised with endedAt (final write on close, or stale-session sweep)');
  check(!doc.sessions.find((s) => s.id === sid1).endedAt, 'the session still open is not finalised');
  check((await page.evaluate(() => store.all('tasks'))).length === 3, 'both sessions\' tasks are in the shared local store');
  // Clear a selected (other) session from Settings
  await page.click('#settingsBtn');
  await page.waitForSelector('.sess-row:not(.current)');
  await page.check(`.sess-row[data-session="${sid2}"] input`);
  page.once('dialog', (d) => d.accept());
  await page.click('text=Clear selected');
  await page.waitForFunction((id) => !document.querySelector(`.sess-row[data-session="${id}"]`), sid2);
  check((await page.evaluate(() => store.all('tasks'))).length === 2 && !(await histDoc(page)).sessions.some((s) => s.id === sid2), 'clearing a selected session removes its records and its JSON entry; this session is untouched');
  // Clear this session
  page.once('dialog', (d) => d.accept());
  await page.click('.sess-row.current >> text=Clear this session');
  await page.waitForFunction(() => (document.querySelector('#convList')?.textContent || '').indexOf('Remind me') < 0);
  await page.waitForTimeout(400);
  check((await page.evaluate(() => store.all('tasks'))).length === 0 && (await page.evaluate(() => allBlocks())).length === 0 && (await page.$$eval('.conv-item', (e) => e.length)) === 0, 'clearing this session removes its chats, tasks and blocks');
  // Clear all
  await page.evaluate(() => executeClientTool('add_task', { title: 'Leftover' }));
  await page.waitForTimeout(3200);
  check((await histDoc(page))?.sessions.length >= 1, 'new activity after a clear is mirrored again');
  page.once('dialog', (d) => d.accept());
  await page.click('text=Clear all sessions');
  await page.waitForTimeout(600);
  check((await histDoc(page)) === null && (await page.evaluate(() => store.all('tasks'))).length === 0, 'clear all sessions empties every store and the history file');
  await page.waitForTimeout(3200);
  check((await histDoc(page)) === null, 'an empty session is not written back to the file');
  // Regressions from the code review
  const reg = await page.evaluate(async (m) => {
    const out = {};
    const series = await createBlock({ title: 'Series', type: 'class', startISO: `${m}T09:00:00`, endISO: `${m}T10:00:00`, recurrence: 'FREQ=WEEKLY;BYDAY=MO' });
    const next = isoDate(addDays(m, 7));
    // endISO alone (seen from a later occurrence) must change the duration, not stretch the series across days
    const r1 = await executeClientTool('update_timetable_block', { blockId: series.id, endISO: `${next}T10:30:00` });
    const b1 = await store.get('blocks', series.id);
    out.endOnly = { start: b1.startISO, end: b1.endISO, dur: durationMin(b1.startISO, b1.endISO), ok: r1.content.ok };
    let threw = null; try { await executeClientTool('update_timetable_block', { blockId: series.id, endISO: `${m}T08:00:00` }); } catch (e) { threw = e.message; }
    out.endBeforeStart = threw;
    try { await executeClientTool('schedule_block', { title: 'No start', endISO: `${m}T10:00:00` }); threw = null; } catch (e) { threw = e.message; }
    out.missingStart = threw;
    // unparseable dates must not hang expansion
    const t0 = performance.now();
    const occ = expandOccurrences([{ id: 'bad', title: 'Bad', startISO: 'next monday', endISO: 'later', recurrence: 'FREQ=WEEKLY' }, { id: 'bad2', title: 'Bad2', startISO: 'x', endISO: 'y', recurrence: 'FREQ=MONTHLY' }], startOfDay(new Date()), endOfDay(addDays(new Date(), 30)));
    out.badDates = { count: occ.length, ms: Math.round(performance.now() - t0) };
    // yearly repeats once a year; daily with BYDAY skips other days
    out.yearly = expandOccurrences([{ id: 'y', title: 'Y', startISO: '2026-11-05T09:00:00', endISO: '2026-11-05T10:00:00', recurrence: 'FREQ=YEARLY' }], '2026-11-01', '2028-12-01').map((o) => o.occurrenceDate);
    out.dailyByday = expandOccurrences([{ id: 'd', title: 'D', startISO: '2026-11-02T09:00:00', endISO: '2026-11-02T10:00:00', recurrence: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=7' }], '2026-11-01', '2026-12-01').map((o) => DOW_LABELS[parseLocal(o.startISO).getDay()]);
    // ICS with a modified instance (RECURRENCE-ID) → series + one override, no duplicate
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:abc', 'DTSTART:20261102T090000', 'DTEND:20261102T100000', 'SUMMARY:Year 10 Science', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:abc', 'RECURRENCE-ID:20261109T090000', 'DTSTART:20261109T110000', 'DTEND:20261109T120000', 'SUMMARY:Year 10 Science (moved)', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const parsed = parseIcs(ics);
    out.icsParsed = parsed.map((e) => [e.uid, e.recurrenceId || null, e.startISO]);
    await deleteBlock(series.id);
    return out;
  }, monday);
  check(reg.endOnly.ok && reg.endOnly.start === `${monday}T09:00:00` && reg.endOnly.dur === 90, `update with endISO only keeps the series anchored and sets 90 min (got ${JSON.stringify(reg.endOnly)})`);
  check(/after startISO/.test(reg.endBeforeStart) && /startISO is required/.test(reg.missingStart), 'end-before-start and missing startISO are rejected with clear errors');
  check(reg.badDates.count === 0 && reg.badDates.ms < 500, `unparseable block dates expand to nothing quickly (${reg.badDates.ms} ms)`);
  check(reg.yearly.join() === '2026-11-05,2027-11-05,2028-11-05', `YEARLY expands once a year (${reg.yearly.join()})`);
  check(reg.dailyByday.join() === 'Mon,Tue,Wed,Thu,Fri,Mon,Tue', `DAILY;BYDAY skips the weekend (${reg.dailyByday.join()})`);
  check(reg.icsParsed.length === 2 && reg.icsParsed[1][1] === '2026-11-09', 'ICS RECURRENCE-ID parsed');
  // Clearing the current session while a reply is streaming must not resurrect the chat
  await ctx.unroute('https://api.anthropic.com/**');
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/v1/models')) return route.fulfill({ json: { data: [{ id: 'claude-fable-5-1', created_at: '2026-09-01T00:00:00Z' }] } });
    await new Promise((r) => setTimeout(r, 2500));
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([
      { type: 'message_start', message: { id: 'slow', type: 'message', role: 'assistant', content: [], model: 'claude-fable-5-1', usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'late reply' } }, { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }, { type: 'message_stop' }]) });
  });
  if (await page.$('.modal')) await page.click('.modal .m-head .btn');
  await page.click('#rail button[data-view="chat"]');
  await page.click('#newChatBtn');
  await page.fill('#input', 'slow question'); await page.click('#sendBtn');
  await page.waitForSelector('.msg.assistant');
  await page.click('#settingsBtn');
  await page.waitForSelector('.sess-row.current');
  page.once('dialog', (d) => d.accept());
  await page.click('.sess-row.current >> text=Clear this session');
  await page.waitForTimeout(3500);
  check((await page.evaluate(() => store.all('conversations'))).length === 0 && (await page.evaluate(() => store.all('messages'))).length === 0 && (await page.$$eval('.conv-item', (e) => e.length)) === 0, 'clearing the session mid-stream leaves no chat behind');
  await page.click('.modal .m-head .btn');
  await ctx.unroute('https://api.anthropic.com/**');
  await ctx.route('https://api.anthropic.com/**', (route) => route.fulfill({ json: { data: [{ id: 'claude-fable-5-1', created_at: '2026-09-01T00:00:00Z' }] } }));
  await page.click('#settingsBtn');
  // Library tile for a generated file + attach to a block
  await page.evaluate(async () => {
    const blob = new Blob(['PK fake docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    await cacheFileBlob('test:quiz', blob, 'quiz.docx', blob.type);
    const conv = await createConversation(); conv.title = 'Quiz chat'; await store.put('conversations', conv);
    const msg = { id: 'msg_lib', conversationId: conv.id, role: 'assistant', createdAt: Date.now(), text: '' }; await store.put('messages', msg);
    await registerArtifact(msg, { key: 'test:quiz', name: 'quiz.docx', mediaType: blob.type, size: blob.size, status: 'ready' });
    await createBlock({ title: 'Lesson', type: 'class', startISO: isoDateTime(new Date()).slice(0, 11) + '10:00:00', endISO: isoDateTime(new Date()).slice(0, 11) + '11:00:00' });
  });
  if (await page.$('.modal')) await page.click('.modal .m-head .btn');
  await page.click('#rail button[data-view="library"]');
  await page.waitForSelector('.tile');
  check(/quiz\.docx/.test(await page.$eval('.tile', (e) => e.textContent)) && /Quiz chat/.test(await page.$eval('.tile', (e) => e.textContent)), 'library lists the generated file with its chat');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.tile [title="Download"]')]);
  check(dl.suggestedFilename() === 'quiz.docx', 'library download works');
  await page.click('.tile >> text=Attach…');
  await page.click('.modal .btn.primary');
  await page.waitForTimeout(200);
  const lesson = (await page.evaluate(() => allBlocks())).find((b) => b.title === 'Lesson');
  check(lesson.artifactIds.length === 1, 'file attached to the timetable block');
  const lib = await page.evaluate(() => executeClientTool('search_library', { query: 'quiz' }));
  check(lib.content.count === 1 && lib.content.files[0].title === 'quiz.docx', 'search_library tool finds it');
  // Studio composes a prompt and opens the chat with Code & files on
  await page.click('#rail button[data-view="studio"]');
  await page.click('.tile >> text=Quiz / test');
  await page.fill('.modal input[placeholder="e.g. Mathematics"]', 'Science');
  await page.fill('.modal input[placeholder="e.g. Year 9"]', 'Year 8');
  await page.fill('.modal input[placeholder="e.g. Pythagoras’ theorem"]', 'Cells');
  await page.click('text=Open in chat to edit');
  await page.waitForFunction(() => !document.querySelector('#view-chat').classList.contains('hidden'));
  const prompt = await page.$eval('#input', (e) => e.value);
  check(/quiz\/test with 15 questions/.test(prompt) && /Subject: Science\. Year level: Year 8\. Topic: Cells/.test(prompt) && /Word document/.test(prompt), 'Studio prompt composed from the form');
  check(await page.$eval('#tglCode', (e) => e.classList.contains('on')), 'Code & files toggled on for the Studio chat');
  // View restored after reload
  await page.click('#rail button[data-view="timetable"]');
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modelSel option'));
  check(await page.$eval('#view-timetable', (e) => !e.classList.contains('hidden')), 'last view restored after reload');
  check(errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 200)})`);
  await ctx.close();
}

console.log('\n[5] API keys: remember me (30 days), session-only, expiry, legacy migration, one key is enough');
{
  const ctx = await newCtx(); const page = await ctx.newPage();
  await page.goto(`${A}/teach-assist.html`);
  await page.waitForFunction(() => document.querySelector('#modelSel option'));
  check(/one is enough/.test(await page.$eval('#bannerHost', (e) => e.textContent)), 'first launch asks for a key and says one is enough');
  await page.click('#settingsBtn');
  check(await page.$eval('.modal .check input', (e) => true) && /Remember me — keep my API keys in this browser for 30 days/.test(await page.$eval('.modal', (e) => e.textContent)), 'Settings has the "Remember me (30 days)" checkbox');
  check(await page.$eval('label.check:has-text("Remember me") input', (e) => e.checked), 'Remember me is ticked by default');
  // Enter only an OpenAI key and close with × (no Save) — it must be kept, and the app must switch to OpenAI.
  await page.fill('input[placeholder="sk-…"]', 'sk-openai-only');
  await page.click('.modal .m-head .btn');
  const k1 = await page.evaluate(() => JSON.parse(localStorage.getItem('teachassist.keys.v1')));
  check(k1 && k1.openaiKey === 'sk-openai-only' && !k1.anthropicKey, 'key typed then sheet closed without Save is stored');
  const days = Math.round((k1.expiresAt - Date.now()) / 86400000);
  check(days === 30, `stored with a 30-day expiry (${days} days)`);
  check(!JSON.parse(await page.evaluate(() => localStorage.getItem('teachassist.settings.v1'))).openaiKey, 'keys are not in the settings blob');
  check((await page.$eval('#providerSel', (e) => e.value)) === 'openai', 'provider switched to OpenAI because that is the only key');
  check(/Claude \(no key\)/.test(await page.$eval('#providerSel', (e) => e.textContent)), 'provider menu marks Claude as "(no key)"');
  // Choose Claude anyway and send → goes to OpenAI with a notice instead of an error
  await page.waitForTimeout(800); // let the model-list refresh triggered by the new key finish
  await page.selectOption('#providerSel', 'anthropic');
  await ctx.route('https://api.openai.com/v1/responses', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([
    { type: 'response.created', response: { id: 'r1', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { id: 'm1', type: 'message', role: 'assistant', status: 'in_progress', content: [] } },
    { type: 'response.output_text.delta', item_id: 'm1', output_index: 0, content_index: 0, delta: 'Hello from OpenAI.' },
    { type: 'response.output_item.done', output_index: 0, item: { id: 'm1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Hello from OpenAI.', annotations: [] }] } },
    { type: 'response.completed', response: { id: 'r1', status: 'completed', usage: { input_tokens: 5, output_tokens: 5 } } }]) }));
  await send(page, 'hi');
  check(/Hello from OpenAI/.test(await page.$eval('.msg.assistant .prose', (e) => e.textContent)) && /no Claude key, so this was sent with/.test(await page.$eval('#bannerHost', (e) => e.textContent)), 'with only an OpenAI key, a message sent with Claude selected goes to OpenAI with a notice');
  // Untick Remember me → keys move to sessionStorage
  await page.click('#settingsBtn');
  await page.uncheck('label.check:has-text("Remember me") input');
  check(/cleared when you close this tab/.test(await page.$eval('.modal', (e) => e.textContent)), 'status explains keys last only until the tab closes');
  await page.click('.modal .btn.primary');
  check(!(await page.evaluate(() => localStorage.getItem('teachassist.keys.v1'))) && JSON.parse(await page.evaluate(() => sessionStorage.getItem('teachassist.keys.session'))).openaiKey === 'sk-openai-only', 'Remember me off: keys only in sessionStorage');
  const p2 = await ctx.newPage(); await p2.goto(`${A}/teach-assist.html`); await p2.waitForFunction(() => document.querySelector('#modelSel option'));
  check(!(await p2.evaluate(() => settings.openaiKey)), 'a new tab (browser reopened) has no keys when Remember me is off');
  await p2.close();
  // Tick again → back to localStorage with a fresh 30-day clock
  await page.click('#settingsBtn');
  await page.check('label.check:has-text("Remember me") input');
  check(/Remembered on this device until/.test(await page.$eval('.modal', (e) => e.textContent)), 'status shows the date the keys will be forgotten');
  await page.click('.modal .m-head .btn');
  check(!!(await page.evaluate(() => localStorage.getItem('teachassist.keys.v1'))), 'Remember me on again: keys back in localStorage');
  // Expiry: pretend 31 days have passed
  await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('teachassist.keys.v1')); k.expiresAt = Date.now() - 1000; localStorage.setItem('teachassist.keys.v1', JSON.stringify(k)); sessionStorage.clear(); });
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modelSel option'));
  check(!(await page.evaluate(() => settings.openaiKey)) && !(await page.evaluate(() => localStorage.getItem('teachassist.keys.v1'))), 'expired keys are erased on the next launch');
  check(/cleared after 30 days/.test(await page.$eval('#bannerHost', (e) => e.textContent)), 'banner explains the keys expired');
  // Forget keys button
  await page.click('#settingsBtn');
  await page.fill('input[placeholder="sk-ant-…"]', 'sk-ant-new');
  await page.click('.modal .m-head .btn');
  await page.click('#settingsBtn');
  page.once('dialog', (d) => d.accept());
  await page.click('text=Forget keys on this device');
  check(!(await page.evaluate(() => localStorage.getItem('teachassist.keys.v1'))) && !(await page.evaluate(() => settings.anthropicKey)) && (await page.$eval('input[placeholder="sk-ant-…"]', (e) => e.value)) === '', '"Forget keys on this device" removes them immediately');
  await page.click('.modal .m-head .btn');
  await ctx.close();
  // Legacy: keys inside the old settings blob are migrated to the key store with a 30-day expiry
  const ctx2 = await newCtx(); const p3 = await ctx2.newPage();
  await p3.addInitScript(() => { if (!localStorage.getItem('teachassist.settings.v1')) localStorage.setItem('teachassist.settings.v1', JSON.stringify({ anthropicKey: 'sk-ant-legacy', openaiKey: 'sk-legacy', provider: 'anthropic' })); });
  await p3.goto(`${A}/teach-assist.html`); await p3.waitForFunction(() => document.querySelector('#modelSel option'));
  const k3 = await p3.evaluate(() => JSON.parse(localStorage.getItem('teachassist.keys.v1')));
  const blob3 = await p3.evaluate(() => JSON.parse(localStorage.getItem('teachassist.settings.v1')));
  check(k3?.anthropicKey === 'sk-ant-legacy' && k3?.openaiKey === 'sk-legacy' && !blob3.anthropicKey && !blob3.openaiKey, 'keys saved by the previous version are moved out of the settings blob');
  await ctx2.close();
}

await browser.close(); s1.close(); s2.close();
console.log(`\n${fails.length ? fails.length + ' FAILED' : 'ALL PASSED'}`);
process.exit(fails.length ? 1 : 0);
