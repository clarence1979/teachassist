// Real on-device run (no stubs): downloads SmolLM2-360M through wllama (CPU / WebAssembly), chats with it,
// then goes OFFLINE and reloads — the app opens from the service worker, the model and runtime load from
// this device's storage (nothing downloaded again), and it still answers.
import pw from '/opt/npm-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'index.html'));
const sw = readFileSync(path.join(here, '..', 'sw.js'));
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/sw.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(sw); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const A = `http://localhost:${server.address().port}`;
const fails = [];
const check = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails.push(m); };
const secs = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => {
  window.TA_FORCE_SW = true; // register the service worker on this http://localhost test server
  Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }); // CPU path (wllama)
  window.__phases = [];
  document.addEventListener('DOMContentLoaded', () => { const orig = window.setLocalStatus; window.setLocalStatus = (st) => { window.__phases.push(st.phase + ':' + (st.text || '')); return orig(st); }; });
});
const net = { hf: 0, hfBytes: 0, cdn: 0 };
ctx.on('requestfinished', async (r) => {
  const u = r.url();
  if (/huggingface\.co|hf\.co|xethub|cdn-lfs/.test(u)) { net.hf++; try { const s = await r.sizes(); net.hfBytes += s.responseBodySize; } catch { /* ignore */ } }
  if (/cdn\.jsdelivr\.net\/npm\/@wllama/.test(u)) net.cdn++;
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
page.on('console', (m) => { if (m.type() === 'error') console.log('    [console]', m.text().slice(0, 200)); });
const ready = (p) => p.waitForFunction(() => document.querySelector('#modelSel option') && typeof localCatalog === 'function', null, { timeout: 60000 });

console.log('\n[1] App shell cached by the service worker');
await page.goto(`${A}/teach-assist.html`); await ready(page);
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20000 });
await page.reload(); await ready(page); // second load fills the shell cache (page + CDN libraries)
const shell = await page.evaluate(async () => { const c = await caches.open('teach-assist-shell-v1'); return (await c.keys()).map((r) => r.url); });
check(shell.some((u) => u.endsWith('/teach-assist.html')) && shell.some((u) => /marked/.test(u)), `service worker saved the page and its libraries (${shell.length} files)`);

console.log('\n[2] First use: download SmolLM2-360M (≈271 MB) and load it');
await page.evaluate(() => saveSettings({ maxTokens: 48 }));
await page.selectOption('#providerSel', 'local');
await page.waitForSelector('.lm-row[data-model="smollm2-360m"]');
const devTxt = await page.$eval('.lm-device', (e) => e.textContent);
check(/runs on the processor|no WebGPU/.test(devTxt), 'no WebGPU → processor engine (wllama)');
let t0 = Date.now();
await page.click('.lm-row[data-model="smollm2-360m"] .lm-actions .btn');
await page.waitForFunction(() => LOCAL.status.phase === 'ready' || LOCAL.status.phase === 'error', null, { timeout: 15 * 60000, polling: 1000 });
const st1 = await page.evaluate(() => LOCAL.status);
check(st1.phase === 'ready', `model ready after ${secs(t0)} (${st1.text})`);
const phases1 = await page.evaluate(() => window.__phases);
check(phases1.some((p) => p.startsWith('downloading:Downloading SmolLM2 360M')), 'progress was reported while downloading');
check(net.hfBytes > 200e6, `≈${Math.round(net.hfBytes / 1e6)} MB fetched from Hugging Face the first time`);
check(await page.evaluate(() => verifyLocalDownloaded('smollm2-360m')), 'model file is in the browser’s private file storage (OPFS)');
const rt = await page.evaluate(async () => (await (await caches.open(LOCAL_RT.cache)).keys()).map((r) => r.url.split('/').pop()));
check(rt.includes('index.js') && rt.includes('wllama.wasm'), `runtime cached in Cache Storage (${rt.join(', ')})`);
await page.click('.modal .m-head .btn');

console.log('\n[3] Chat on the device');
const ask = async (p, q) => {
  const n = await p.evaluate(() => state.messages.length);
  await p.fill('#input', q); await p.click('#sendBtn');
  await p.waitForFunction((n) => state.messages.length >= n + 2 && state.messages.at(-1).status === 'done', n, { timeout: 5 * 60000, polling: 500 });
  return p.evaluate(() => state.messages.at(-1));
};
t0 = Date.now();
const r1 = await ask(page, 'What is the capital of France? Answer in one word.');
console.log(`    reply (${secs(t0)}): ${JSON.stringify(r1.text.slice(0, 120))} · ${r1.usage?.tps?.toFixed(1)} tokens/s`);
check(r1.provider === 'local' && !r1.error && r1.text.trim().length > 0, 'SmolLM2 answered on the device');
check(/paris/i.test(r1.text), 'answer is sensible (mentions Paris)');

console.log('\n[4] Offline: reload — loads from the device, nothing downloaded');
await ctx.route(/huggingface\.co|hf\.co|cdn\.jsdelivr\.net\/npm\/@wllama/, (route) => { net.blocked = (net.blocked || 0) + 1; route.abort(); });
const hfBefore = net.hf;
await ctx.setOffline(true);
t0 = Date.now();
await page.reload(); await ready(page);
check(await page.evaluate(() => navigator.onLine === false), 'browser is offline and the app still opened (service worker)');
await page.waitForFunction(() => LOCAL.status.phase === 'ready' || LOCAL.status.phase === 'error', null, { timeout: 5 * 60000, polling: 500 });
const st2 = await page.evaluate(() => LOCAL.status);
const phases2 = await page.evaluate(() => window.__phases);
check(st2.phase === 'ready', `model loaded from this device in ${secs(t0)} (${st2.text})`);
check(phases2[0]?.startsWith('loading:Loading from this device') && !phases2.some((p) => p.startsWith('downloading')), `no download step (${phases2.map((p) => p.split(':')[0]).join(' → ')})`);
check(net.hf === hfBefore, 'no requests reached Hugging Face');
t0 = Date.now();
const r2 = await ask(page, 'Name one colour of the rainbow. One word.');
console.log(`    offline reply (${secs(t0)}): ${JSON.stringify(r2.text.slice(0, 120))}`);
check(r2.provider === 'local' && !r2.error && r2.text.trim().length > 0, 'answers while offline');
check(errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 200)})`);

await browser.close(); server.close();
console.log(`\n${fails.length ? fails.length + ' FAILED' : 'ALL PASSED'}`);
process.exit(fails.length ? 1 : 0);
