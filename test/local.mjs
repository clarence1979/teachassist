// On-device AI (stubbed engine): device detection & suggestions, the On-device AI sheet, download → cache → reload,
// chatting, offline fallback, PDF text for small models, Word download, delete.
import pw from '/opt/npm-tools/node_modules/playwright/index.js';
const { chromium, devices } = pw;
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'index.html'));
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const A = `http://127.0.0.1:${server.address().port}`;
const fails = [];
const check = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails.push(m); };
const browser = await chromium.launch();

/** Emulate memory and WebGPU before the app runs; optionally swap in a fake engine once the app script has loaded. */
function emulate(cfg) {
  // Safari doesn't report memory (mem: null); Chromium rounds it and caps it at 8.
  if (cfg.mem !== undefined) Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => cfg.mem ?? undefined, configurable: true });
  // Real browsers offer a large share of the disk; the test profile's quota is tiny.
  const quota = (cfg.quotaMB ?? 50000) * 1048576;
  navigator.storage.estimate = async () => ({ quota, usage: 0 });
  if (cfg.gpu === null) Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
  else if (cfg.gpu) {
    const adapter = { features: new Set(cfg.gpu.f16 ? ['shader-f16'] : []), limits: { maxStorageBufferBindingSize: 2 ** 30, maxBufferSize: 2 ** 30 }, info: { vendor: 'test-gpu', architecture: 'emulated' }, isFallbackAdapter: !!cfg.gpu.fallback };
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => ({ requestAdapter: async () => adapter }), configurable: true });
  }
  if (cfg.fake) {
    window.__fake = { calls: [], messages: null };
    document.addEventListener('DOMContentLoaded', () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const fake = (kind) => async (m, wasDownloaded) => {
        window.__fake.calls.push({ kind, key: m.key, wasDownloaded });
        if (!wasDownloaded) for (let i = 1; i <= 5; i++) { setLocalStatus({ phase: 'downloading', key: m.key, name: m.name, progress: i / 5, text: `Downloading ${m.name} — ${i * 20}%` }); await wait(150); }
        else { setLocalStatus({ phase: 'loading', key: m.key, name: m.name, progress: 0, text: 'Loading from this device…' }); await wait(120); }
        return {
          kind, key: m.key, name: m.name,
          async *chat(messages, { signal }) {
            window.__fake.messages = messages;
            for (const t of ['<thi', 'nk>planning</think>', 'Hello', ' from ', m.name, '.\n\n## Notes\n- one']) { if (signal?.aborted) return; await wait(25); yield { delta: t }; }
            yield { usage: { input: 0, output: 6, tps: 12.5 } };
          },
          async unload() { window.__fake.unloaded = (window.__fake.unloaded || 0) + 1; },
        };
      };
      window.loadWllamaEngine = fake('wllama');
      window.loadWebLLMEngine = fake('webllm');
    });
  }
}
const ready = (page) => page.waitForFunction(() => document.querySelector('#modelSel option') && typeof localCatalog === 'function');
const probe = (page) => page.evaluate(async () => {
  const d = await detectLocalDevice(true); const c = localCatalog(d);
  return { d, rec: c.find((m) => m.recommended)?.key || null, fit: Object.fromEntries(c.map((m) => [m.key, m.fit])) };
});

console.log('\n[1] Device detection and suggestions');
const cases = [
  { name: 'Windows laptop, WebGPU (16-bit), 8 GB+', ctx: { viewport: { width: 1280, height: 900 } }, cfg: { mem: 8, gpu: { f16: true } }, rec: 'qwen3.5-4b', engine: 'webllm', extra: (r) => r.fit['qwen3.5-9b'] !== 'good' },
  { name: 'Laptop, WebGPU without 16-bit shaders, 8 GB+', ctx: { viewport: { width: 1280, height: 900 } }, cfg: { mem: 8, gpu: { f16: false } }, rec: 'llama3.2-3b', engine: 'webllm', extra: (r) => r.d.variant === 'f32' },
  { name: 'Laptop without WebGPU (processor only)', ctx: { viewport: { width: 1280, height: 900 } }, cfg: { mem: 8, gpu: null }, rec: 'llama3.2-1b', engine: 'wllama', extra: (r) => r.fit['phi4-mini'] === 'unavailable' && r.fit['qwen3.5-2b'] === 'tight' },
  { name: 'Software-only WebGPU adapter → processor', ctx: { viewport: { width: 1280, height: 900 } }, cfg: { mem: 8, gpu: { f16: true, fallback: true } }, rec: 'llama3.2-1b', engine: 'wllama' },
  { name: 'Android phone, 8 GB, WebGPU', ctx: { ...devices['Pixel 7'] }, cfg: { mem: 8, gpu: { f16: true } }, rec: 'llama3.2-1b', engine: 'webllm', extra: (r) => r.d.kind === 'phone' && r.fit['llama3.2-3b'] === 'tight' && r.fit['qwen3.5-9b'] === 'too-big' },
  { name: 'Android phone, 4 GB, WebGPU', ctx: { ...devices['Pixel 7'] }, cfg: { mem: 4, gpu: { f16: true } }, rec: 'llama3.2-1b', engine: 'webllm', extra: (r) => r.fit['qwen3.5-0.8b'] === 'too-big' },
  { name: 'Android phone, 2 GB', ctx: { ...devices['Pixel 7'] }, cfg: { mem: 2, gpu: { f16: true } }, rec: 'smollm2-360m', engine: 'webllm' },
  { name: 'iPhone with WebGPU (iOS 26)', ctx: { ...devices['iPhone 14'] }, cfg: { mem: null, gpu: { f16: true } }, rec: 'llama3.2-1b', engine: 'webllm', extra: (r) => r.d.os === 'ios' && r.d.ramSource === 'estimated' && r.d.budgetMB === 1800 && r.fit['llama3.2-3b'] === 'too-big' },
  { name: 'iPhone without WebGPU', ctx: { ...devices['iPhone 14'] }, cfg: { mem: null, gpu: null }, rec: 'qwen3.5-0.8b', engine: 'wllama', extra: (r) => r.fit['smollm2-360m'] === 'good' && r.fit['llama3.2-1b'] === 'tight' },
  { name: 'Laptop with little free storage', ctx: { viewport: { width: 1280, height: 900 } }, cfg: { mem: 8, gpu: { f16: true }, quotaMB: 2000 }, rec: 'qwen3.5-2b', engine: 'webllm', extra: (r) => r.fit['qwen3.5-4b'] === 'good' },
  { name: 'iPad', ctx: { ...devices['iPad Pro 11'] }, cfg: { mem: null, gpu: { f16: true } }, rec: 'llama3.2-3b', engine: 'webllm', extra: (r) => r.d.os === 'ipados' && r.d.kind === 'tablet' },
];
for (const c of cases) {
  const ctx = await browser.newContext(c.ctx);
  await ctx.addInitScript(emulate, c.cfg);
  const page = await ctx.newPage();
  await page.goto(`${A}/teach-assist.html`); await ready(page);
  const r = await probe(page);
  check(r.rec === c.rec && r.d.engine === c.engine && (!c.extra || c.extra(r)), `${c.name}: suggests ${r.rec} on ${r.d.engine} (budget ${r.d.budgetMB} MB)`);
  await ctx.close();
}

console.log('\n[2] Phone: On-device AI sheet');
{
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  await ctx.addInitScript(emulate, { mem: 8, gpu: { f16: true }, fake: true });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${A}/teach-assist.html`); await ready(page);
  check(/use free on-device AI/.test(await page.$eval('#bannerHost', (e) => e.textContent)), 'without keys the banner offers free on-device AI');
  await page.click('#bannerHost [data-act="local"]');
  await page.waitForSelector('.lm-row');
  const txt = await page.$eval('.modal', (e) => e.textContent);
  check(/Android phone · 8 GB or more memory · graphics acceleration/.test(txt), 'sheet shows the detected device (Android phone, memory, WebGPU)');
  check(/Suggested for this device: Llama 3.2 1B/.test(txt) && (await page.$eval('.lm-row.rec .lm-name', (e) => e.textContent)) === 'Llama 3.2 1B', 'suggested model highlighted');
  check(/won’t fit on this device/.test(txt) && !!(await page.$('details.lm-more .lm-row[data-model="qwen3.5-9b"]')), 'models too large for the phone are tucked away');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('.lm-row')].every((r) => r.scrollWidth <= r.clientWidth + 1)), 'sheet fits the phone screen');
  check(errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 160)})`);
  await ctx.close();
}

console.log('\n[3] Download once, then load from this device');
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(emulate, { mem: 8, gpu: null, fake: true });
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const claudeCalls = [];
await ctx.route('https://api.anthropic.com/**', (route) => {
  const req = route.request();
  if (req.method() === 'POST' && req.url().includes('/v1/messages')) {
    const body = JSON.parse(req.postData()); claudeCalls.push(body);
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([
      { type: 'message_start', message: { id: 'msg_w', type: 'message', role: 'assistant', content: [], model: body.model, usage: { input_tokens: 50, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Melbourne today: sunny, top of 24°C.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } },
      { type: 'message_stop' },
    ]) });
  }
  return route.fulfill({ json: { data: [{ id: 'claude-fable-5-1', created_at: '2026-09-01T00:00:00Z' }] } });
});
await ctx.route('https://api.openai.com/**', (route) => route.fulfill({ json: { data: [] } }));
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
await page.goto(`${A}/teach-assist.html`); await ready(page);
await page.selectOption('#providerSel', 'local');
await page.waitForSelector('.lm-row.rec');
check((await page.$eval('.lm-row.rec', (e) => e.dataset.model)) === 'llama3.2-1b', 'choosing On-device with no model opens the sheet at the suggestion');
await page.click('.lm-row.rec .lm-actions .btn');
await page.waitForFunction(() => document.querySelector('#localStatus') && !document.querySelector('#localStatus').hidden);
check(/Download Llama 3.2 1B \(about 808 MB\)/.test(dialogs[0] || '') && /kept on this device/.test(dialogs[0] || ''), 'asks before downloading, with the size and that it is kept on the device');
check(/Downloading Llama 3.2 1B/.test(await page.$eval('#localStatus', (e) => e.textContent)), 'status strip shows download progress above the message box');
check(await page.waitForFunction(() => { const p = document.querySelector('.lm-row[data-model="llama3.2-1b"] .lm-prog'); return p && !p.hidden && /Downloading/.test(p.textContent); }, null, { timeout: 3000 }).then(() => true, () => false), 'the model row shows progress too');
await page.waitForFunction(() => LOCAL.status.phase === 'ready');
check(await page.$eval('#localStatus', (e) => e.hidden), 'strip disappears when the model is ready');
check(await page.evaluate(() => isLocalDownloaded('llama3.2-1b', 'wllama') && settings.provider === 'local' && settings.localModel === 'llama3.2-1b'), 'model recorded as on this device and selected');
check(/In use/.test(await page.$eval('.lm-row[data-model="llama3.2-1b"]', (e) => e.textContent)) && /On this device/.test(await page.$eval('.lm-row[data-model="llama3.2-1b"]', (e) => e.textContent)), 'sheet now shows it as on this device and in use');
await page.click('.modal .m-head .btn');
check((await page.$eval('#providerVal', (e) => e.textContent)) === 'On-device' && (await page.$eval('#modelVal', (e) => e.textContent)) === 'Llama 3.2 1B ✓', 'pills show On-device · Llama 3.2 1B ✓');
check(await page.evaluate(() => getComputedStyle(document.querySelector('#effortSel').closest('.pill-sel')).display === 'none'), 'effort pill hidden for on-device models');
check(await page.evaluate(() => document.querySelector('#tglWeb').disabled && document.querySelector('#tglCode').disabled), 'web search and code toggles disabled (cloud only)');

console.log('\n[4] Chatting on the device');
await page.fill('#input', 'Say hello');
await page.click('#sendBtn');
await page.waitForFunction(() => { const m = state.messages.at(-1); return m?.role === 'assistant' && m.status === 'done'; });
const reply = await page.evaluate(() => state.messages.at(-1));
check(reply.provider === 'local' && reply.text.startsWith('Hello from Llama 3.2 1B.'), `reply streamed from the on-device model ("${reply.text.slice(0, 30)}")`);
check(reply.segments.some((s) => s.type === 'thinking' && s.text === 'planning') && !/think>/.test(reply.text), '<think> blocks become a thought-process card, not reply text');
check(/Llama 3\.2 1B · on device · 6 out · 12\.5 tokens\/s/.test(await page.$eval('.msg.assistant:last-child .usage', (e) => e.textContent)), 'footer shows the on-device model and speed');
const sent = await page.evaluate(() => window.__fake.messages);
check(sent[0].role === 'system' && /run on the teacher's own device/.test(sent[0].content) && sent.at(-1).content === 'Say hello', 'short on-device system prompt, then the conversation');
check((await page.evaluate(() => window.__fake.calls.length)) === 1, 'second prompt reuses the loaded model (no reload)');

console.log('\n[5] Small-context trimming and PDF text');
const trimmed = await page.evaluate(async () => {
  const chain = [];
  for (let i = 0; i < 40; i++) chain.push({ role: i % 2 ? 'assistant' : 'user', text: `${i}: ${'lorem ipsum '.repeat(120)}` });
  chain.push({ role: 'user', text: 'latest question' });
  const msgs = await buildLocalMessages({}, chain);
  return { n: msgs.length, chars: msgs.reduce((a, m) => a + m.content.length, 0), firstRole: msgs[1].role, last: msgs.at(-1).content };
});
check(trimmed.chars <= (4096 - 1536) * 3.4 && trimmed.firstRole === 'user' && trimmed.last === 'latest question', `long chats trimmed to fit the 4k context (${trimmed.n} messages, ${trimmed.chars} chars)`);
// A one-page PDF with a line of text, attached and read with pdf.js for the small model.
const pdfText = 'Photosynthesis turns light into chemical energy';
const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
const stream = `BT /F1 18 Tf 72 760 Td (${pdfText}) Tj ET`;
objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
let pdf = '%PDF-1.4\n'; const offs = [];
objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = pdf.length;
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
await page.setInputFiles('#fileInput', { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'latin1') });
await page.waitForFunction(() => state.pending.length && !state.pending[0].parsing);
const nBefore = await page.evaluate(() => state.messages.length);
await page.fill('#input', 'Summarise the PDF');
await page.click('#sendBtn');
await page.waitForFunction((n) => state.messages.length >= n + 2 && state.messages.at(-1).status === 'done', nBefore, { timeout: 60000 });
const withPdf = await page.evaluate(() => window.__fake.messages.at(-1).content);
check(withPdf.includes('--- notes.pdf ---') && withPdf.includes(pdfText), 'PDF text extracted on the device and given to the model');

console.log('\n[6] Word download');
await page.click('.msg.assistant:last-child .actions .tb[aria-label="More actions"]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.modal >> text=Download reply as Word (.doc)')]);
const doc = readFileSync(await dl.path(), 'utf8');
check(dl.suggestedFilename().endsWith('.doc') && /urn:schemas-microsoft-com:office:word/.test(doc) && /<h2[^>]*>Notes<\/h2>/.test(doc) && /Hello from Llama 3\.2 1B/.test(doc), `reply saved as a Word document (${dl.suggestedFilename()})`);

console.log('\n[7] Next session: loads from this device, no download');
await page.reload(); await ready(page);
await page.waitForFunction(() => LOCAL.status.phase === 'ready', null, { timeout: 10000 });
const calls = await page.evaluate(() => window.__fake.calls);
check(calls.length === 1 && calls[0].wasDownloaded === true, 'after a reload the chosen model warms up from storage (not downloaded again)');
check(await page.evaluate(() => settings.provider === 'local' && !document.querySelector('#bannerHost .banner')), 'no "add a key" banner while on-device AI is set up');

console.log('\n[8] Offline: Claude falls back to the on-device model');
await page.evaluate(() => { saveSettings({ anthropicKey: 'sk-ant-x', provider: 'anthropic' }); renderModelSelect(); updateComposerState(); });
await page.evaluate(() => fetchModels('anthropic', true)); await page.evaluate(() => renderModelSelect());
check((await page.$eval('#providerVal', (e) => e.textContent)) === 'Claude', 'switched to Claude');
await ctx.setOffline(true);
await page.waitForFunction(() => navigator.onLine === false);
const nOff = await page.evaluate(() => state.messages.length);
await page.fill('#input', 'Are you there?');
await page.click('#sendBtn');
await page.waitForFunction((n) => state.messages.length >= n + 2 && state.messages.at(-1).status === 'done', nOff);
const off = await page.evaluate(() => state.messages.at(-1));
check(off.provider === 'local' && /Hello from Llama/.test(off.text) && /You're offline, so this reply comes from/.test(await page.$eval('#bannerHost', (e) => e.textContent)), 'offline reply comes from the on-device model, with a note');
check(await page.evaluate(() => settings.provider === 'anthropic'), 'Claude stays selected for when the connection returns');
await ctx.setOffline(false);
await page.evaluate(() => saveSettings({ localWhenOffline: false }));
check(await page.evaluate(() => turnProvider() === 'anthropic'), 'the offline fallback can be switched off');
await page.evaluate(() => saveSettings({ localWhenOffline: true }));

console.log('\n[8b] Live questions and "Ask Claude"');
await page.evaluate(() => { saveSettings({ provider: 'local' }); renderModelSelect(); updateComposerState(); });
const nLive = await page.evaluate(() => state.messages.length);
await page.fill('#input', 'Weather today');
await page.click('#sendBtn');
await page.waitForFunction((n) => state.messages.length >= n + 2 && state.messages.at(-1).status === 'done', nLive);
check(/no internet, so they can't check the weather/.test(await page.$eval('#bannerHost', (e) => e.textContent)) && !!(await page.$('#bannerHost [data-act="cloud"]')), 'weather on an on-device model: explains why and offers "Ask Claude with web search"');
check(/can't check that from this device/.test((await page.evaluate(() => window.__fake.messages))[0].content), 'the on-device model is told it has no live information');
check((await page.$eval('.msg.assistant:last-child .ask-cloud', (e) => e.textContent)) === 'Ask Claude', 'on-device replies get an "Ask Claude" button when a key exists');
await page.click('#bannerHost [data-act="cloud"]');
await page.waitForFunction((n) => state.messages.length === n + 2 && state.messages.at(-1).provider === 'anthropic' && state.messages.at(-1).status === 'done', nLive);
const cl = claudeCalls.at(-1);
check(/sunny/.test(await page.evaluate(() => state.messages.at(-1).text)) && cl.model === 'claude-fable-5-1' && cl.tools.some((t) => /web_search/.test(t.type)), 'one tap re-asks Claude with web search, replacing the on-device reply');
check(await page.evaluate(() => settings.provider === 'local'), 'the provider pill stays On-device (it was a one-off)');
check(!(await page.$('.msg.assistant:last-child .ask-cloud')), 'Claude replies have no "Ask Claude" button');
const sheet = await page.evaluate(async () => { await openLocalAISheet(); const rows = [...document.querySelectorAll('.lm-row')]; return { txt: document.querySelector('.modal').textContent, all: rows.length > 0 && rows.every((r) => r.querySelector('.lm-chip.q')), smol: document.querySelector('.lm-row[data-model="smollm2-360m"] .lm-chip.q')?.textContent }; });
check(/far less capable than Claude or OpenAI/.test(sheet.txt) && sheet.all && sheet.smol === 'Quality: basic', 'sheet sets expectations: quality label on every model (SmolLM2: basic)');
await page.click('.modal .m-head .btn');
await page.evaluate(() => saveSettings({ provider: 'anthropic' }));

console.log('\n[9] Settings and delete');
await page.click('#settingsBtn');
check(/On-device AI \(free · private · offline\)/.test(await page.$eval('.modal', (e) => e.textContent)) && /Llama 3\.2 1B is on this device/.test(await page.$eval('#localSettings', (e) => e.textContent)), 'Settings has an On-device AI section with the downloaded model');
await page.click('#localSettings >> text=Manage on-device models…');
await page.waitForSelector('.lm-row[data-model="llama3.2-1b"]');
await page.click('.lm-row[data-model="llama3.2-1b"] >> text=Delete');
await page.waitForFunction(() => !isLocalDownloaded('llama3.2-1b'), null, { timeout: 30000 });
check(await page.evaluate(() => !settings.localModel && settings.provider === 'anthropic'), 'deleting removes the record and the selection');
check(/Download & use/.test(await page.$eval('.lm-row[data-model="llama3.2-1b"]', (e) => e.textContent)), 'the model can be downloaded again');
check(errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 200)})`);

await browser.close(); server.close();
console.log(`\n${fails.length ? fails.length + ' FAILED' : 'ALL PASSED'}`);
process.exit(fails.length ? 1 : 0);
