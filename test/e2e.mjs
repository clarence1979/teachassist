// End-to-end test of dist/teach-assist.html in headless Chromium with mocked provider APIs.
import pw from '/opt/npm-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'index.html'));
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}/teach-assist.html`;

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const fails = [];
const check = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.log('  ✗', msg); fails.push(msg); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message));

// ───── Mock state ─────
const seen = { anthropic: [], openai: [], relay: [], openaiFiles: [] };
const DOCX_BYTES = Buffer.from('PK\u0003\u0004fake-docx-bytes-for-test-' + 'x'.repeat(200), 'latin1');
let anthropicScenario = 'turn1';
let openaiScenario = 'turn1';

await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  const url = req.url();
  if (url.includes('/v1/models')) {
    return route.fulfill({ json: { data: [{ id: 'claude-fable-5-1', created_at: '2026-09-01T00:00:00Z' }, { id: 'claude-opus-5-5', created_at: '2026-07-01T00:00:00Z' }, { id: 'claude-haiku-5-5', created_at: '2026-06-01T00:00:00Z' }], has_more: false } });
  }
  if (url.endsWith('/v1/messages')) {
    const body = JSON.parse(req.postData());
    seen.anthropic.push(body);
    if (anthropicScenario === 'turn1') {
      const events = [
        { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: body.model, usage: { input_tokens: 1200, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'The teacher wants a quiz as a Word file. I will search, then build it with the docx skill.' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIGNATURE123' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query": "VCAA Year 9 digital tech' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ' loops"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://vcaa.vic.edu.au/x', title: 'VCAA Digital Technologies', encrypted_content: 'ENC', page_age: 'May 1, 2026' }] } },
        { type: 'content_block_stop', index: 2 },
        { type: 'content_block_start', index: 3, content_block: { type: 'server_tool_use', id: 'srvtoolu_2', name: 'bash_code_execution', input: {} } },
        { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"command": "python make_quiz.py && cp quiz.docx \\"$OUTPUT_DIR/\\" && ls $OUTPUT_DIR"}' } },
        { type: 'content_block_stop', index: 3 },
        { type: 'content_block_start', index: 4, content_block: { type: 'bash_code_execution_tool_result', tool_use_id: 'srvtoolu_2', content: { type: 'bash_code_execution_result', stdout: 'quiz.docx\n', stderr: '', return_code: 0, content: [{ type: 'bash_code_execution_output', file_id: 'file_quiz1' }] } } },
        { type: 'content_block_stop', index: 4 },
        { type: 'content_block_start', index: 5, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 5, delta: { type: 'text_delta', text: 'Done — **Year 9 Python Loops Quiz** (10 questions + answer key) is attached.\n\nThe energy formula $E = mc^2$ renders inline, and display maths:\n\n$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$\n\n```python\nfor i in range(3):\n    print(i)\n```\n\n| Q | Topic |\n|---|---|\n| 1 | for loops |\n' } },
        { type: 'content_block_delta', index: 5, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://vcaa.vic.edu.au/x', title: 'VCAA Digital Technologies', encrypted_index: 'IDX', cited_text: 'x' } } },
        { type: 'content_block_stop', index: 5 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null, container: { id: 'container_abc', expires_at: '2026-11-30T00:00:00Z' } }, usage: { output_tokens: 850, server_tool_use: { web_search_requests: 1, code_execution_requests: 1 } } },
        { type: 'message_stop' },
      ];
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(events) });
    }
    if (anthropicScenario === 'turn2') {
      const events = [
        { type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', content: [], model: body.model, usage: { input_tokens: 3000, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Second turn reply.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } },
        { type: 'message_stop' },
      ];
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(events) });
    }
    if (anthropicScenario === 'inline') {
      const b64 = DOCX_BYTES.toString('base64');
      const events = [
        { type: 'message_start', message: { id: 'msg_3', type: 'message', role: 'assistant', content: [], model: body.model, usage: { input_tokens: 100, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_9', name: 'bash_code_execution', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command": "base64 -w0 plan.docx"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'bash_code_execution_tool_result', tool_use_id: 'srvtoolu_9', content: { type: 'bash_code_execution_result', stdout: `-----BEGIN FILE plan.docx ${DOCX_BYTES.length}-----\n${b64}\n-----END FILE-----\n`, stderr: '', return_code: 0, content: [] } } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Here is your lesson plan.' } },
        { type: 'content_block_stop', index: 2 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } },
        { type: 'message_stop' },
      ];
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(events) });
    }
    if (anthropicScenario === 'dangling') {
      const events = [
        { type: 'message_start', message: { id: 'msg_d', type: 'message', role: 'assistant', content: [], model: body.model, usage: { input_tokens: 10, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'partial…' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Starting the build…' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'server_tool_use', id: 'srvtoolu_x', name: 'bash_code_execution', input: {} } },
        { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"command": "pyth' } },
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      ];
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(events) });
    }
    if (anthropicScenario === 'heal') {
      // First call: reject max_tokens; second: reject display; third: OK
      const n = seen.anthropic.filter((b) => b._scenario === 'heal').length; body._scenario = 'heal'; seen.anthropic[seen.anthropic.length - 1] = body;
      if (n === 0) return route.fulfill({ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: 64000 > 32000, which is the maximum allowed number of output tokens for claude-test' } } });
      if (n === 1) return route.fulfill({ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'thinking.display: Extra inputs are not permitted' } } });
      const events = [
        { type: 'message_start', message: { id: 'msg_4', type: 'message', role: 'assistant', content: [], model: body.model, usage: { input_tokens: 10, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'healed' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ];
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(events) });
    }
  }
  return route.fulfill({ status: 404, body: 'unmocked ' + url });
});

await page.route('https://relay.test/**', async (route) => {
  const url = route.request().url();
  seen.relay.push({ method: route.request().method(), url, headers: route.request().headers() });
  if (url.endsWith('/v1/files/file_quiz1/content')) return route.fulfill({ status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, body: DOCX_BYTES });
  if (url.endsWith('/v1/files/file_quiz1')) return route.fulfill({ json: { id: 'file_quiz1', type: 'file', filename: 'quiz.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: DOCX_BYTES.length, downloadable: true } });
  if (url.endsWith('/v1/files') && route.request().method() === 'POST') return route.fulfill({ json: { id: 'file_up_' + seen.relay.length, type: 'file', filename: 'upload', mime_type: 'application/octet-stream', size_bytes: 10, downloadable: false } });
  if (url.includes('/v1/files?limit=1')) return route.fulfill({ json: { data: [], has_more: false } });
  return route.fulfill({ status: 404, body: 'unmocked relay ' + url });
});

await page.route('https://api.openai.com/**', async (route) => {
  const req = route.request(); const url = req.url();
  if (url.endsWith('/v1/models')) return route.fulfill({ json: { data: [{ id: 'gpt-6-astra', created: 1756000000 }, { id: 'gpt-6.1-terra', created: 1761000000 }, { id: 'gpt-6-luna', created: 1756000001 }, { id: 'gpt-4o-audio-preview', created: 1 }, { id: 'o3', created: 2 }] } });
  if (url.endsWith('/v1/files') && req.method() === 'POST') { seen.openaiFiles.push(req.headers()); return route.fulfill({ json: { id: 'file-up' + seen.openaiFiles.length, object: 'file', bytes: 123, filename: 'x', purpose: 'user_data' } }); }
  if (url.includes('/v1/containers/cntr_1/files/cfile_1/content')) return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: DOCX_BYTES });
  if (url.includes('/v1/containers/cntr_1/files/cfile_2/content')) return route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
  if (url.includes('/v1/containers/cntr_1/files')) return route.fulfill({ json: { object: 'list', data: [
    { id: 'cfile_1', object: 'container.file', path: '/mnt/data/markbook.xlsx', bytes: DOCX_BYTES.length, container_id: 'cntr_1', source: 'assistant', created_at: Math.floor(Date.now() / 1000) },
    { id: 'cfile_2', object: 'container.file', path: '/mnt/data/chart.png', bytes: 70, container_id: 'cntr_1', source: 'assistant', created_at: Math.floor(Date.now() / 1000) },
    { id: 'cfile_u', object: 'container.file', path: '/mnt/data/input.csv', bytes: 10, container_id: 'cntr_1', source: 'user', created_at: Math.floor(Date.now() / 1000) },
  ], has_more: false } });
  if (url.endsWith('/v1/responses')) {
    const body = JSON.parse(req.postData());
    seen.openai.push(body);
    const rid = 'resp_' + seen.openai.length;
    const events = [
      { type: 'response.created', response: { id: rid, status: 'in_progress' }, sequence_number: 0 },
      { type: 'response.output_item.added', output_index: 0, item: { id: 'rs_1', type: 'reasoning', summary: [] } },
      { type: 'response.reasoning_summary_text.delta', item_id: 'rs_1', output_index: 0, summary_index: 0, delta: 'Planning the markbook structure…' },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Planning the markbook structure with weighted totals.' }] } },
      { type: 'response.output_item.added', output_index: 1, item: { id: 'ci_1', type: 'code_interpreter_call', status: 'in_progress', container_id: 'cntr_1', code: '' } },
      { type: 'response.code_interpreter_call_code.delta', item_id: 'ci_1', output_index: 1, delta: 'import openpyxl\n' },
      { type: 'response.code_interpreter_call_code.done', item_id: 'ci_1', output_index: 1, code: 'import openpyxl\nwb.save("/mnt/data/markbook.xlsx")' },
      { type: 'response.output_item.done', output_index: 1, item: { id: 'ci_1', type: 'code_interpreter_call', status: 'completed', container_id: 'cntr_1', code: 'import openpyxl\nwb.save("/mnt/data/markbook.xlsx")', outputs: [{ type: 'logs', logs: 'saved' }] } },
      { type: 'response.output_item.added', output_index: 2, item: { id: 'msg_1', type: 'message', role: 'assistant', status: 'in_progress', content: [] } },
      { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 2, content_index: 0, delta: 'Your markbook is ready: [markbook.xlsx](sandbox:/mnt/data/markbook.xlsx).' },
      { type: 'response.output_text.annotation.added', item_id: 'msg_1', output_index: 2, content_index: 0, annotation_index: 0, annotation: { type: 'container_file_citation', container_id: 'cntr_1', file_id: 'cfile_1', filename: 'markbook.xlsx', start_index: 0, end_index: 0 } },
      { type: 'response.output_item.done', output_index: 2, item: { id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Your markbook is ready: [markbook.xlsx](sandbox:/mnt/data/markbook.xlsx).', annotations: [{ type: 'container_file_citation', container_id: 'cntr_1', file_id: 'cfile_1', filename: 'markbook.xlsx', start_index: 0, end_index: 0 }] }] } },
      { type: 'response.completed', response: { id: rid, status: 'completed', usage: { input_tokens: 500, output_tokens: 400, output_tokens_details: { reasoning_tokens: 120 }, input_tokens_details: { cached_tokens: 0 } } } },
    ];
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(events) });
  }
  return route.fulfill({ status: 404, body: 'unmocked ' + url });
});

// ───── Seed settings before load ─────
await page.addInitScript(() => {
  if (localStorage.getItem('teachassist.settings.v1')) return;
  localStorage.setItem('teachassist.settings.v1', JSON.stringify({
    anthropicKey: 'sk-ant-test', openaiKey: 'sk-test', anthropicRelay: 'https://relay.test', provider: 'anthropic',
    effort: 'high', maxTokens: 64000, webSearch: true, codeTools: true, imageGen: true, showThinking: true, theme: 'dark', userName: 'Clarence', timezone: 'Australia/Melbourne',
  }));
});
await page.goto(BASE);
await page.waitForFunction(() => document.querySelector('#modelSel option'));

console.log('\n[1] Startup & model catalog');
check((await page.$eval('#modelSel', (s) => s.value)) === 'claude-fable-5-1', 'default Claude model is claude-fable-5-1');
check((await page.$$eval('#modelSel option', (o) => o.length)) === 3, 'live Anthropic catalog loaded (3 models)');

console.log('\n[2] Anthropic turn with thinking, search, code exec, file via relay');
await page.fill('#input', 'Make a 10-question Year 9 quiz on Python loops as a Word document');
await page.click('#sendBtn');
await page.waitForSelector('.file-card:not(.pending)', { timeout: 15000 });
await page.waitForFunction(() => !document.querySelector('.msg.assistant .cursor') && document.querySelector('.msg.assistant .actions'));
const body1 = seen.anthropic[0];
check(body1.model === 'claude-fable-5-1' && body1.stream === true, 'request uses selected model, streaming');
check(body1.thinking?.type === 'adaptive' && body1.thinking.display === 'summarized', 'adaptive thinking with summarized display');
check(body1.output_config?.effort === 'high', 'output_config.effort = high');
check(body1.temperature === undefined, 'no temperature sent');
check(Array.isArray(body1.container?.skills) && body1.container.skills.length === 4 && body1.container.skills[0].type === 'anthropic', 'container.skills has the 4 Anthropic document skills');
check(body1.tools.some((t) => t.type === 'code_execution_20260521') && body1.tools.some((t) => t.type === 'web_search_20260318') && body1.tools.some((t) => t.type === 'web_fetch_20260318'), 'tools: code execution + web search + web fetch (current versions)');
check(body1.tools.some((t) => t.name === 'generate_image' && t.input_schema), 'client generate_image tool offered (OpenAI key present)');
check(body1.tools.find((t) => t.name === 'web_search').user_location?.country === 'AU' && body1.tools.find((t) => t.name === 'web_search').user_location.city === 'Melbourne', 'web search user_location derived from timezone');
check(body1.messages.length === 1 && body1.messages[0].role === 'user' && body1.messages[0].content.at(-1).type === 'text', 'single user turn with text block');
check(/Today's date/.test(body1.system) && !/\d\d:\d\d/.test(body1.system) && /Skills attached/.test(body1.system) && /\$OUTPUT_DIR/.test(body1.system), 'system prompt: date-only, skills + $OUTPUT_DIR instructions (relay mode)');
check(await page.$('.card.thinking'), 'thinking card rendered');
check((await page.$$eval('.card:not(.thinking) summary', (els) => els.map((e) => e.textContent))).some((t) => /Searching the web.*VCAA/.test(t)), 'web search card with query');
check((await page.$$eval('.card:not(.thinking) summary', (els) => els.map((e) => e.textContent))).some((t) => /Running a command/.test(t)), 'bash code card');
check(await page.$('.prose .katex'), 'KaTeX rendered inline math');
check(await page.$('.prose .katex-display'), 'KaTeX rendered display math');
check(await page.$('.prose .codeblock .hljs'), 'highlighted code block');
check(await page.$('.prose table'), 'markdown table rendered');
check((await page.$eval('.file-card .nm', (e) => e.textContent)) === 'quiz.docx', 'file card shows quiz.docx from relay metadata');
check(seen.relay.some((r) => r.url.endsWith('/v1/files/file_quiz1/content') && r.headers['x-api-key'] === 'sk-ant-test'), 'file content fetched through relay with x-api-key');
check((await page.$$eval('.sources a', (a) => a.length)) === 1, 'sources list shows the citation');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.file-card .dl')]);
check(dl.suggestedFilename() === 'quiz.docx', 'download has correct filename');
const usageTxt = await page.$eval('.msg.assistant .usage', (e) => e.textContent);
check(/1.2k in/.test(usageTxt) && /1 search/.test(usageTxt), `usage line: ${usageTxt}`);

console.log('\n[3] Second Anthropic turn replays native blocks + container id');
anthropicScenario = 'turn2';
await page.fill('#input', 'Now add 5 harder questions');
await page.click('#sendBtn');
await page.waitForFunction(() => document.querySelectorAll('.msg.assistant').length === 2 && !document.querySelector('.msg.assistant .cursor') && document.querySelectorAll('.msg.assistant .actions').length === 2);
const body2 = seen.anthropic[1];
check(body2.container?.id === 'container_abc', 'container id reused');
check(body2.messages.length === 3 && body2.messages[1].role === 'assistant', 'history: user, assistant, user');
const replay = body2.messages[1].content;
check(replay[0].type === 'thinking' && replay[0].signature === 'SIGNATURE123', 'thinking block replayed with signature');
check(replay.some((b) => b.type === 'server_tool_use' && b.name === 'web_search' && b.input.query.includes('loops')) && replay.some((b) => b.type === 'web_search_tool_result' && b.content[0].encrypted_content === 'ENC'), 'server tool use + encrypted result replayed verbatim');
check(replay.some((b) => b.type === 'bash_code_execution_tool_result'), 'code execution result replayed');
check(body2.system === body1.system, 'system prompt byte-identical across turns');

console.log('\n[4] Attachments: PDF (native document), CSV (text document + container_upload), PNG (image)');
anthropicScenario = 'turn2';
await page.click('#newChatBtn');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
await page.setInputFiles('#fileInput', [
  { name: 'syllabus.pdf', mimeType: 'application/pdf', buffer: pdf },
  { name: 'marks.csv', mimeType: 'text/csv', buffer: Buffer.from('name,score\nAmy,91\nBen,77\n') },
  { name: 'diagram.png', mimeType: 'image/png', buffer: png },
]);
await page.waitForFunction(() => document.querySelectorAll('#attachBar .att-pill').length === 3 && !document.querySelector('#attachBar .parsing'));
await page.fill('#input', 'Summarise these');
await page.click('#sendBtn');
await page.waitForFunction(() => document.querySelectorAll('.msg.assistant').length === 1 && !document.querySelector('.msg.assistant .cursor') && document.querySelector('.msg.assistant .actions'));
const body3 = seen.anthropic[2];
const c3 = body3.messages[0].content;
check(c3.some((b) => b.type === 'document' && b.source.type === 'file' && b.title === 'syllabus.pdf'), 'PDF uploaded via relay and sent as document file reference');
check(c3.some((b) => b.type === 'document' && b.source.type === 'text' && b.source.data.includes('Amy,91')), 'CSV sent as plain-text document');
check(c3.filter((b) => b.type === 'container_upload').length === 2, 'PDF + CSV also provided to the sandbox via container_upload');
check(c3.some((b) => b.type === 'image' && b.source.media_type === 'image/png'), 'PNG sent as image block');
check(/Attached PDF: syllabus.pdf \(.*1 pages\)/.test(c3.at(-1).text), 'attachment description notes page count');
check(seen.relay.filter((r) => r.method === 'POST').length === 2, 'two uploads went through the relay');

console.log('\n[5] Anthropic without relay: inline base64 file transfer');
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('teachassist.settings.v1')); s.anthropicRelay = ''; localStorage.setItem('teachassist.settings.v1', JSON.stringify(s)); });
await page.reload();
await page.waitForFunction(() => document.querySelector('#modelSel option'));
await page.click('#newChatBtn');
anthropicScenario = 'inline';
await page.fill('#input', 'Give me a lesson plan');
await page.click('#sendBtn');
try { await page.waitForSelector('.file-card:not(.pending)', { timeout: 15000 }); } catch (e) { console.log('DEBUG assistant:', await page.$eval('.msg.assistant', (x) => x.innerText).catch(() => 'none'), 'scenario', anthropicScenario, 'calls', seen.anthropic.length);
  const st = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('teachassist-standalone'); r.onsuccess = () => { const tx = r.result.transaction('messages'); tx.objectStore('messages').getAll().onsuccess = (e) => res(e.target.result); }; }));
  const am = st.filter((m) => m.role === 'assistant').sort((a,b)=>b.createdAt-a.createdAt)[0];
  console.log('DEBUG files', JSON.stringify(am.files), 'stdout', JSON.stringify(am.native?.turns?.[0]?.content?.find((b)=>b.type==='bash_code_execution_tool_result')?.content?.stdout?.slice(0,120)), 'system has FT', /FILE TRANSFER/.test(seen.anthropic[3].system), 'relay', JSON.stringify(seen.anthropic[3].system.match(/Files the user attached[^\n]*/)?.[0]));
  throw e; }
await page.waitForFunction(() => !document.querySelector('.msg.assistant .cursor') && document.querySelector('.msg.assistant .actions'));
const body5 = seen.anthropic[3];
check(/FILE TRANSFER/.test(body5.system) && /base64 -w0/.test(body5.system), 'no-relay system prompt asks for base64 inline transfer');
check((await page.$eval('.file-card .nm', (e) => e.textContent)) === 'plan.docx', 'inline file extracted as plan.docx');
const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('teachassist-standalone'); r.onsuccess = () => { const tx = r.result.transaction('messages'); tx.objectStore('messages').getAll().onsuccess = (e) => res(e.target.result); }; }));
const inlineMsg = stored.find((m) => m.role === 'assistant' && m.files?.some((f) => f.name === 'plan.docx'));
const stdout = inlineMsg.native.turns[0].content.find((b) => b.type === 'bash_code_execution_tool_result').content.stdout;
check(/file transferred to the user: plan.docx/.test(stdout) && !/BEGIN FILE/.test(stdout), 'base64 payload scrubbed from stored history');
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('.file-card .dl')]);
check(dl2.suggestedFilename() === 'plan.docx', 'inline file downloads');

console.log('\n[6] Self-healing of 400 validation errors');
await page.click('#newChatBtn');
anthropicScenario = 'heal';
await page.fill('#input', 'heal test');
await page.click('#sendBtn');
await page.waitForFunction(() => document.querySelectorAll('.msg.assistant').length === 1 && !document.querySelector('.msg.assistant .cursor') && document.querySelector('.msg.assistant .actions'));
const heals = seen.anthropic.filter((b) => b._scenario === 'heal');
check(heals.length === 3 && heals[1].max_tokens === 32000 && heals[2].thinking.display === undefined, 'max_tokens lowered to 32000, then display dropped, then success');
check((await page.$eval('.msg.assistant .prose', (e) => e.textContent.trim())) === 'healed', 'healed response rendered');

console.log('\n[6b] Errored turn is pruned before replay; system updates arrive as mid-conversation system notes');
anthropicScenario = 'dangling';
await page.click('#newChatBtn');
await page.fill('#input', 'build something');
await page.click('#sendBtn');
await page.waitForFunction(() => document.querySelector('.msg.assistant .err'));
check(/Overloaded/.test(await page.$eval('.msg.assistant .err', (e) => e.textContent)), 'stream error surfaced to the user');
// Change the profile between turns (simulates editing Settings / the date rolling over)
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('teachassist.settings.v1')); s.profile = 'I teach Year 12 Physics.'; localStorage.setItem('teachassist.settings.v1', JSON.stringify(s)); });
await page.reload();
await page.waitForFunction(() => document.querySelector('#modelSel option') && document.querySelectorAll('.msg').length >= 2 && /claude-fable-5-1/.test(document.querySelector('#hintLabel').textContent));
anthropicScenario = 'turn2';
await page.fill('#input', 'try again please');
await page.click('#sendBtn');
await page.waitForFunction(() => document.querySelectorAll('.msg.assistant').length === 2 && document.querySelectorAll('.msg.assistant .actions').length === 2);
const bodyD = seen.anthropic[seen.anthropic.length - 1];
const bodyD0 = seen.anthropic[seen.anthropic.length - 2];
check(bodyD.system === bodyD0.system && /Melbourne secondary school/.test(bodyD.system), 'top-level system prompt frozen (old profile) despite the settings change');
const roles = bodyD.messages.map((m) => m.role);

check(JSON.stringify(roles) === JSON.stringify(['user', 'assistant', 'user', 'system']), `messages: user, assistant(pruned text), user, system-note — got ${JSON.stringify(roles)}`);
check(/Year 12 Physics/.test(bodyD.messages[3].content) && /Context update/.test(bodyD.messages[3].content), 'mid-conversation system note carries only the changed section');
const prunedTurn = bodyD.messages[1].content;
check(prunedTurn.length === 1 && prunedTurn[0].type === 'text' && prunedTurn[0].text === 'Starting the build…', 'unsigned thinking and result-less server_tool_use pruned; text kept');
check(!JSON.stringify(bodyD).includes('_json') && !JSON.stringify(bodyD).includes('_legacy'), 'no private bookkeeping fields leak into the request');

console.log('\n[7] OpenAI Responses API turn with reasoning, code interpreter, container file + chaining');
await page.selectOption('#providerSel', 'openai');
await page.waitForFunction(() => document.querySelector('#modelSel').value.startsWith('gpt'));
check((await page.$eval('#modelSel', (s) => s.value)) === 'gpt-6-astra', 'default OpenAI model prefers gpt-6-astra');
check(!(await page.$$eval('#modelSel option', (o) => o.map((x) => x.value))).includes('gpt-4o-audio-preview'), 'non-chat models filtered out');
await page.click('#newChatBtn');
await page.setInputFiles('#fileInput', [{ name: 'input.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') }]);
await page.waitForFunction(() => document.querySelectorAll('#attachBar .att-pill').length === 1 && !document.querySelector('#attachBar .parsing'));
await page.fill('#input', 'Build a markbook spreadsheet');
await page.click('#sendBtn');
await page.waitForSelector('.file-card:not(.pending)', { timeout: 15000 });
await page.waitForFunction(() => !document.querySelector('.msg.assistant .cursor') && document.querySelector('.msg.assistant .actions'));
const ob1 = seen.openai[0];
check(ob1.model === 'gpt-6-astra' && ob1.stream && ob1.store === true, 'Responses API request with store + stream');
check(ob1.reasoning?.effort === 'high' && ob1.reasoning.summary === 'auto', 'reasoning effort high with summaries');
check(ob1.tools.some((t) => t.type === 'web_search' && t.user_location?.country === 'AU') && ob1.tools.some((t) => t.type === 'code_interpreter' && t.container.type === 'auto' && t.container.file_ids?.length === 1) && ob1.tools.some((t) => t.type === 'image_generation'), 'tools: web_search (AU), code_interpreter with uploaded file, image_generation');
check(ob1.input[0].content.some((c) => c.type === 'input_file' && c.file_id === 'file-up1'), 'CSV uploaded to Files API and referenced as input_file');
check(ob1.include?.includes('code_interpreter_call.outputs'), 'include code interpreter outputs');
check(ob1.temperature === undefined, 'no temperature for reasoning model');
check(/python tool/.test(ob1.instructions) && /\/mnt\/data/.test(ob1.instructions), 'OpenAI instructions mention the python tool and /mnt/data');
const names = await page.$$eval('.file-card .nm', (e) => e.map((x) => x.textContent));
check(names.includes('markbook.xlsx'), 'cited container file markbook.xlsx delivered');
check(await page.$('img.gen-img'), 'uncited chart.png discovered via container file list and shown inline');
check(await page.$('.card.thinking'), 'reasoning summary shown as thought process');
check((await page.$$eval('.card:not(.thinking) summary', (els) => els.map((e) => e.textContent))).some((t) => /Running Python/.test(t)), 'code interpreter card');
check(await page.$('.prose a[href^="#file:"]'), 'sandbox:/mnt/data link rewritten to a download link');
const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('.prose a[href^="#file:"]')]);
check(dl3.suggestedFilename() === 'markbook.xlsx', 'clicking the sandbox link downloads the file');
await page.fill('#input', 'Add a weighted average column');
await page.click('#sendBtn');
await page.waitForFunction(() => document.querySelectorAll('.msg.assistant').length === 2 && !document.querySelector('.msg.assistant .cursor') && document.querySelectorAll('.msg.assistant .actions').length === 2);
const ob2 = seen.openai[1];
check(ob2.previous_response_id === 'resp_1' && ob2.input.length === 1 && ob2.input[0].role === 'user', 'second turn chains with previous_response_id and sends only the new user turn');
check(ob2.instructions === ob1.instructions, 'instructions re-sent each turn');

console.log('\n[8] Persistence across reload');
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.conv-item').length >= 4);
check((await page.$$eval('.conv-item', (e) => e.length)) >= 4, 'conversations persisted');
check((await page.$$eval('.file-card', (e) => e.length)) >= 1, 'generated files persisted and re-rendered');

console.log('\n[9] Console errors');
const realErrors = consoleErrors.filter((e) => !/favicon|net::ERR_FAILED|Failed to load resource|Overloaded/.test(e));
check(realErrors.length === 0, realErrors.length ? 'console errors: ' + realErrors.join(' | ') : 'no console errors');

await page.screenshot({ path: path.join(here, 'screenshot.png'), fullPage: false });
await browser.close();
server.close();
console.log(`\n${fails.length ? fails.length + ' FAILED' : 'ALL PASSED'}`);
process.exit(fails.length ? 1 : 0);
