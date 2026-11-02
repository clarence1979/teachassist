// Local database resilience: iOS Safari closes IndexedDB connections when the page is backgrounded
// (e.g. while the file picker is open) — the app must reopen and carry on, not fail with
// "The database connection is closing". Also: another tab upgrading the database, and nothing lost on failure.
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
const reply = (text) => sse([
  { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route('https://claude-files-relay.clarence17.workers.dev/**', (r) => r.fulfill({ status: 503, body: 'the real relay is never used in tests' }));
let n = 0;
await ctx.route('https://api.anthropic.com/**', (route) => {
  if (route.request().method() === 'POST') return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: reply(`Reply ${++n}`) });
  return route.fulfill({ json: { data: [{ id: 'claude-opus-5-5', created_at: '2026-09-01T00:00:00Z' }] } });
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => { if (!localStorage.getItem('teachassist.settings.v1')) { localStorage.setItem('teachassist.settings.v1', JSON.stringify({ provider: 'anthropic', anthropicRelay: 'off', codeTools: false })); localStorage.setItem('teachassist.keys.v1', JSON.stringify({ anthropicKey: 'sk-ant-x', expiresAt: Date.now() + 1e9 })); } });
await page.goto(`${A}/teach-assist.html`);
await page.waitForFunction(() => document.querySelector('#modelSel option'));
const banner = () => page.evaluate(() => document.querySelector('#bannerHost')?.textContent || '');
const sendAndWait = async (text) => {
  const before = await page.evaluate(() => state.messages.length);
  await page.fill('#input', text); await page.click('#sendBtn');
  return page.waitForFunction((b) => state.messages.length >= b + 2 && state.messages.at(-1).status === 'done', before, { timeout: 8000 }).then(() => true, () => false);
};

console.log('\n[1] iOS closes the database connection while the file picker is open');
await page.setInputFiles('#fileInput', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Photosynthesis notes for Year 9') });
await page.waitForFunction(() => state.pending.length && !state.pending[0].parsing);
await page.evaluate(async () => (await openDb()).close()); // what WebKit does to a backgrounded page
const ok1 = await sendAndWait('Make a PDF summary of the attached notes');
const b1 = await banner();
check(!/database connection is closing/i.test(b1), `no "database connection is closing" error${b1 ? ` (banner: ${b1.slice(0, 90)})` : ''}`);
check(ok1, 'the message (with its attachment) was saved and sent, and the reply arrived');
check(await page.evaluate(async () => (await store.all('messages')).some((m) => m.attachments?.[0]?.name === 'notes.txt')), 'the attachment is stored with the message');

console.log('\n[2] Closed again mid-session, repeatedly');
for (let i = 0; i < 3; i++) await page.evaluate(async () => (await openDb()).close());
check(await sendAndWait('And a quiz'), 'still works after the connection is closed again');
await page.evaluate(async () => (await openDb()).close());
await page.reload(); await page.waitForFunction(() => document.querySelector('#modelSel option'));
check((await page.evaluate(() => state.messages.length)) === 4, 'everything is there after a reload');

console.log('\n[3] Another tab upgrades the database');
const other = await ctx.newPage();
await other.goto(`${A}/teach-assist.html`);
const upgraded = await other.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('teachassist-standalone', 99);
  req.onupgradeneeded = () => {};
  req.onsuccess = () => { req.result.close(); resolve('ok'); };
  req.onblocked = () => resolve('blocked');
  req.onerror = () => resolve('error ' + req.error);
  setTimeout(() => resolve('timeout'), 4000);
}));
check(upgraded === 'ok', `the other tab's upgrade isn't blocked by this tab (${upgraded})`);
await other.close();
check(await sendAndWait('Still there?'), 'this tab reopens the upgraded database and keeps working');

console.log('\n[4] If sending fails for another reason, nothing has to be retyped');
await page.evaluate(() => { const orig = store.put; let once = true; store.put = (s, o) => { if (once && s === 'messages') { once = false; return Promise.reject(new Error('Storage is full')); } return orig(s, o); }; });
await page.click('#newChatBtn');
await page.setInputFiles('#fileInput', { name: 'rubric.txt', mimeType: 'text/plain', buffer: Buffer.from('Criteria') });
await page.waitForFunction(() => state.pending.length && !state.pending[0].parsing);
await page.fill('#input', 'Mark this against the rubric');
await page.click('#sendBtn');
await page.waitForFunction(() => /Storage is full/.test(document.querySelector('#bannerHost').textContent));
check((await page.$eval('#input', (e) => e.value)) === 'Mark this against the rubric' && (await page.evaluate(() => state.pending.map((p) => p.name).join())) === 'rubric.txt', 'the message and attachment are put back in the box');
check(errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 200)})`);

await browser.close(); server.close();
console.log(`\n${fails.length ? fails.length + ' FAILED' : 'ALL PASSED'}`);
process.exit(fails.length ? 1 : 0);
