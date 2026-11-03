// Long replies survive dropped connections ("Load failed"), and the spending estimate / limit notices.
import pw from '/opt/npm-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.argv[2] || path.join(here, '..', 'index.html'));
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const A = `http://127.0.0.1:${server.address().port}`;
const fails = [];
const check = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails.push(m); };
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-AU', timezoneId: 'Australia/Melbourne' });
await ctx.route('https://claude-files-relay.clarence17.workers.dev/**', (r) => r.fulfill({ status: 503, body: 'the real relay is never used in tests' }));
// The page's fetch, wrapped so a chosen stream breaks the way Safari reports it.
await ctx.addInitScript(() => {
  window.__drop = [];
  const real = window.fetch;
  window.fetch = async (...args) => {
    const res = await real(...args);
    const url = String(args[0]?.url || args[0]);
    if (window.__drop.length && /\/v1\/(messages|responses)$/.test(url) && res.body) {
      window.__drop.shift();
      const reader = res.body.getReader();
      const body = new ReadableStream({ async pull(c) { const { done, value } = await reader.read(); if (done) c.error(new TypeError('Load failed')); else c.enqueue(value); } });
      return new Response(body, { status: res.status, headers: res.headers });
    }
    return res;
  };
  if (!localStorage.getItem('teachassist.settings.v1')) { localStorage.setItem('teachassist.settings.v1', JSON.stringify({ provider: 'anthropic', anthropicRelay: 'off', codeTools: true, webSearch: false })); localStorage.setItem('teachassist.keys.v1', JSON.stringify({ anthropicKey: 'sk-ant-x', openaiKey: 'sk-x', expiresAt: Date.now() + 1e9 })); }
});
const claude = { bodies: [], script: [] };
await ctx.route('https://api.anthropic.com/**', (route) => {
  const req = route.request();
  if (req.method() !== 'POST') return route.fulfill({ json: { data: [{ id: 'claude-opus-5-5', created_at: '2026-10-05T00:00:00Z' }] } });
  claude.bodies.push(JSON.parse(req.postData()));
  const next = claude.script.shift();
  if (next?.status) return route.fulfill({ status: next.status, json: next.json });
  return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: next || '' });
});
const oai = { posts: [], gets: [], cancels: [] };
await ctx.route('https://api.openai.com/**', (route) => {
  const req = route.request(); const u = new URL(req.url());
  if (u.pathname === '/v1/models') return route.fulfill({ json: { data: [{ id: 'gpt-6-sol', created: 1 }] } });
  if (req.method() === 'POST' && u.pathname === '/v1/responses') {
    oai.posts.push(JSON.parse(req.postData()));
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([
      { type: 'response.created', sequence_number: 0, response: { id: 'resp_bg1', status: 'in_progress', created_at: Math.floor(Date.now() / 1000) } },
      { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item: { id: 'msg_1', type: 'message', role: 'assistant', content: [] } },
      { type: 'response.output_text.delta', sequence_number: 2, output_index: 0, item_id: 'msg_1', delta: 'Hello ' },
    ]) });
  }
  if (req.method() === 'GET' && u.pathname === '/v1/responses/resp_bg1') {
    oai.gets.push(u.search);
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([
      { type: 'response.output_text.delta', sequence_number: 3, output_index: 0, item_id: 'msg_1', delta: 'world.' },
      { type: 'response.output_item.done', sequence_number: 4, output_index: 0, item: { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello world.', annotations: [] }] } },
      { type: 'response.completed', sequence_number: 5, response: { id: 'resp_bg1', status: 'completed', usage: { input_tokens: 100000, output_tokens: 20000, input_tokens_details: { cached_tokens: 0 } } } },
    ]) });
  }
  if (req.method() === 'POST' && /\/cancel$/.test(u.pathname)) { oai.cancels.push(u.pathname); return route.fulfill({ json: { id: 'resp_bg1', status: 'cancelled' } }); }
  return route.fulfill({ json: { data: [] } });
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${A}/teach-assist.html`);
await page.waitForFunction(() => document.querySelector('#modelSel option'));
const sendAndWait = async (text, timeout = 15000) => {
  const before = await page.evaluate(() => state.messages.length);
  await page.fill('#input', text); await page.click('#sendBtn');
  await page.waitForFunction((b) => state.messages.length >= b + 2 && state.messages.at(-1).status === 'done', before, { timeout });
  return page.evaluate(() => state.messages.at(-1));
};
const start = (extra = {}) => ({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'claude-opus-5-5', usage: { input_tokens: 200000, output_tokens: 1 }, ...extra } });
const end = (out = 10000) => [{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: out } }, { type: 'message_stop' }];

console.log('\n[1] Claude: the connection drops halfway through a long job');
claude.script.push(sse([
  start({ container: { id: 'cntr_keep', expires_at: '2026-12-01T00:00:00Z' } }),
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan the booklet.' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Part one done.' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'bash_code_execution', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"command":"python make_pages.py"}' } },
  { type: 'content_block_stop', index: 2 },
  { type: 'content_block_start', index: 3, content_block: { type: 'bash_code_execution_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'bash_code_execution_result', stdout: 'pages 1-20 ok', stderr: '', return_code: 0 } } },
  { type: 'content_block_stop', index: 3 },
  { type: 'content_block_start', index: 4, content_block: { type: 'server_tool_use', id: 'srvtoolu_2', name: 'bash_code_execution', input: {} } },
  { type: 'content_block_delta', index: 4, delta: { type: 'input_json_delta', partial_json: '{"command":"python make_pa' } },
]));
claude.script.push(sse([start(), { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Part two done — booklet finished.' } }, { type: 'content_block_stop', index: 0 }, ...end()]));
await page.evaluate(() => window.__drop.push(1));
const r1 = await sendAndWait('Make the 50-page booklet');
const b2 = claude.bodies.at(-1);
const resent = b2.messages.at(-2), note = b2.messages.at(-1);
check(claude.bodies.length === 2 && !r1.error, `no "Load failed": the reply carried on by itself (${r1.error || 'no error'})`);
check(resent.role === 'assistant' && resent.content.map((b) => b.type).join(',') === 'thinking,text,server_tool_use,bash_code_execution_tool_result' && !resent.content.some((b) => b.id === 'srvtoolu_2'), 'finished steps were resent; the half-written step was dropped');
check(note.role === 'user' && /connection dropped/.test(note.content[0].text) && /don.t repeat|do not repeat/i.test(note.content[0].text), 'Claude was asked to carry on from where it stopped');
check(b2.container?.id === 'cntr_keep', 'the same sandbox was reused, so its files survive');
check(/Part one done\.[\s\S]*Part two done/.test(r1.text) && !/make_pa\b/.test(JSON.stringify(r1.segments.map((s) => s.code || ''))), 'the reply shows both halves and no broken step');
claude.script.push(sse([start(), { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sure.' } }, { type: 'content_block_stop', index: 0 }, ...end()]));
await sendAndWait('Thanks — add a cover');
const roles = claude.bodies.at(-1).messages.map((m) => m.role).join(',');
check(roles === 'user,assistant,user,assistant,user', `the next message replays the conversation in a valid order (${roles})`);

console.log('\n[2] Claude: drops before anything finished → the request is simply repeated');
claude.script.push(sse([start(), { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hal' } }]));
claude.script.push(sse([start(), { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Whole answer.' } }, { type: 'content_block_stop', index: 0 }, ...end()]));
await page.evaluate(() => window.__drop.push(1));
const nBefore = claude.bodies.length;
const r2 = await sendAndWait('Quick one');
check(r2.text === 'Whole answer.' && claude.bodies.length === nBefore + 2 && JSON.stringify(claude.bodies.at(-1).messages) === JSON.stringify(claude.bodies.at(-2).messages), 'repeated with the same messages; only the complete answer shows');

console.log('\n[3] OpenAI: background response, stream re-attached after the drop');
await page.selectOption('#providerSel', 'openai');
await page.click('#newChatBtn');
await page.evaluate(() => window.__drop.push(1));
const r3 = await sendAndWait('Long OpenAI job');
check(oai.posts.at(-1).background === true && oai.posts.at(-1).stream === true, 'the request runs in background mode (it keeps going at OpenAI if the phone drops)');
check(oai.gets.at(-1) === '?stream=true&starting_after=2', `re-attached from the last event seen (${oai.gets.at(-1)})`);
check(r3.text === 'Hello world.' && !r3.error, 'the reply completed: "Hello world."');

console.log('\n[4] Stopping while it reconnects cancels the job at OpenAI');
await page.evaluate(() => window.__drop.push(1));
const nGets = oai.gets.length;
await page.fill('#input', 'Another long one'); await page.click('#sendBtn');
await page.waitForFunction(() => state.messages.at(-1)?.reconnecting === true, null, { timeout: 8000 });
check(await page.waitForSelector('.msg.assistant:last-child .reconnect-note', { timeout: 3000 }).then(async (n) => /connection dropped — reconnecting/i.test(await n.textContent()), () => false), 'the reply says it is reconnecting');
await page.click('#stopBtn');
await page.waitForFunction(() => state.messages.at(-1).status === 'done');
await page.waitForTimeout(1500);
check(oai.cancels.includes('/v1/responses/resp_bg1/cancel') && oai.gets.length === nGets, 'Stop cancels the background response and doesn’t reconnect');

console.log('\n[5] Spending estimate and what is left');
await page.evaluate(() => localStorage.removeItem('teachassist.spend.v1'));
await page.selectOption('#providerSel', 'anthropic');
await page.click('#newChatBtn');
claude.script.push(sse([start(), { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } }, { type: 'content_block_stop', index: 0 }, ...end(10000)]));
const r5 = await sendAndWait('Costed reply');
check(Math.abs(r5.cost - 1.0) < 1e-9, `Opus 5.5: 200k in × $4/M + 10k out × $20/M = ≈ $1.00 (got ${r5.cost})`);
check(/≈ \$1\.00 ·/.test(await page.$eval('.msg.assistant:last-child .usage', (e) => e.textContent)), 'the reply footer shows ≈ $1.00');
await page.click('#settingsBtn'); await page.waitForSelector('#spendSettings');
check(/This month: ≈ \$1\.00 over 1 reply/.test(await page.$eval('#spendSettings .spend-row[data-provider="anthropic"]', (e) => e.textContent)), 'Settings shows this month’s estimate');
await page.fill('#spendSettings .spend-row[data-provider="anthropic"] .spend-amt', '50');
await page.dispatchEvent('#spendSettings .spend-row[data-provider="anthropic"] .spend-amt', 'change');
check(/≈ \$49\.00 left/.test(await page.$eval('#spendSettings .spend-row[data-provider="anthropic"]', (e) => e.textContent)), 'with a $50 monthly limit: ≈ $49.00 left');
await page.selectOption('#spendSettings .spend-row[data-provider="anthropic"] select', 'credit');
await page.fill('#spendSettings .spend-row[data-provider="anthropic"] .spend-amt', '20');
await page.dispatchEvent('#spendSettings .spend-row[data-provider="anthropic"] .spend-amt', 'change');
await page.click('.modal .m-head .btn');
claude.script.push(sse([start(), { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Again.' } }, { type: 'content_block_stop', index: 0 }, ...end(10000)]));
await sendAndWait('Another costed reply');
check(/Claude — ≈ \$19\.00 left/.test(await page.$eval('#providerSel option[value="anthropic"]', (e) => e.textContent)), 'credit mode: $20 entered, one $1 reply later the provider menu says “≈ $19.00 left”');

console.log('\n[6] "You have reached your specified API usage limits"');
claude.script.push({ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.' } } });
const r6 = await sendAndWait('One more');
check(/usage limits/.test(r6.error || ''), 'the error is shown on the reply');
const ban = await page.$eval('#bannerHost', (e) => e.textContent);
check(/reached your account's spending limit until 1 Dec/.test(ban) && !!(await page.$('#bannerHost [data-act="use-openai"]')), 'a notice says when access returns and offers OpenAI');
check(/limit until 1 Dec/.test(await page.$eval('#providerSel option[value="anthropic"]', (e) => e.textContent)), 'the provider menu marks Claude as limited');
await page.click('#bannerHost [data-act="use-openai"]');
check((await page.evaluate(() => settings.provider)) === 'openai', 'one tap switches to OpenAI');
check(errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 200)})`);

await browser.close(); server.close();
console.log(`\n${fails.length ? fails.length + ' FAILED' : 'ALL PASSED'}`);
process.exit(fails.length ? 1 : 0);
