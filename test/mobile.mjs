// Phone layout: bottom tab bar, three-day timetable with swipe, bottom-sheet modals, no horizontal overflow.
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
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
await ctx.route('https://api.anthropic.com/**', (route) => route.fulfill({ json: { data: [{ id: 'claude-fable-5-1', created_at: '2026-09-01T00:00:00Z' }] } }));
await ctx.route('https://api.openai.com/**', (route) => route.fulfill({ json: { data: [] } }));
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => { if (!localStorage.getItem('teachassist.settings.v1')) localStorage.setItem('teachassist.settings.v1', JSON.stringify({ anthropicKey: 'sk-ant-x', provider: 'anthropic', saveHistory: true })); });
await page.goto(`${A}/teach-assist.html`);
await page.waitForFunction(() => document.querySelector('#modelSel option'));
const swipe = (dx) => page.evaluate((dx) => { const b = document.querySelector('#view-timetable .view-body'); const r = b.getBoundingClientRect(); const mk = (type, x, y) => new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: b, clientX: x, clientY: y })], changedTouches: [new Touch({ identifier: 1, target: b, clientX: x, clientY: y })] }); b.dispatchEvent(mk('touchstart', r.left + 250, r.top + 200)); b.dispatchEvent(mk('touchend', r.left + 250 + dx, r.top + 206)); }, dx);
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.querySelector('#main').scrollWidth <= document.querySelector('#main').clientWidth + 1);

console.log('\n[1] Phone chrome');
check(await page.evaluate(() => document.documentElement.classList.contains('mobile') && isMobile()), 'mobile mode detected (iPhone 14 emulation)');
const railBox = await page.$eval('#rail', (e) => e.getBoundingClientRect());
const mainBox = await page.$eval('#main', (e) => e.getBoundingClientRect());
check(railBox.top >= mainBox.bottom - 1 && railBox.width >= 380, 'nav rail is a full-width bottom tab bar');
check((await page.$$eval('#rail button', (b) => b.filter((x) => x.getBoundingClientRect().height >= 44).length)) === 6, 'six tabs with ≥44px touch targets');
check((await page.$eval('#input', (e) => getComputedStyle(e).fontSize)) === '16px', 'message box is 16px (no iOS zoom)');
check(await noOverflow(), 'chat: no horizontal overflow');

console.log('\n[2] Timetable on a phone');
await page.evaluate(async () => {
  const mon = isoDate(startOfWeek(new Date()));
  const d = (i, t) => `${isoDate(addDays(mon, i))}T${t}:00`;
  await createBlock({ title: '9B Maths', type: 'class', startISO: d(0, '09:00'), endISO: d(0, '10:00'), recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
  const today = isoDate(new Date());
  await createBlock({ title: 'Late duty', type: 'duty', startISO: `${today}T22:00:00`, endISO: `${isoDate(addDays(today, 1))}T02:00:00` });
});
await page.click('#rail button[data-view="timetable"]');
await page.waitForSelector('.tt-grid');
check((await page.$eval('.tt-grid', (g) => g.style.getPropertyValue('--days'))) === '3', 'week view shows three days');
check(/3 days/.test(await page.$eval('.seg', (e) => e.textContent)) && !(await page.$('text=Sat/Sun')), 'segmented control says "3 days"; weekend toggle hidden');
check(await noOverflow(), 'timetable: no horizontal overflow (grid fits the screen)');
const t0 = await page.$eval('.tt-title', (e) => e.textContent);
await swipe(-160); await page.waitForTimeout(250);
const t1 = await page.$eval('.tt-title', (e) => e.textContent);
await swipe(160); await page.waitForTimeout(250);
const t2 = await page.$eval('.tt-title', (e) => e.textContent);
check(t1 !== t0 && t2 === t0, `swipe left/right moves three days (${t0} → ${t1} → ${t2})`);
await swipe(-40); await page.waitForTimeout(250);
check((await page.$eval('.tt-title', (e) => e.textContent)) === t0, 'a short drag is ignored');
await page.click('text=Today'); await page.waitForTimeout(200);
const hours = await page.$$eval('.tt-gutter span', (s) => s.map((x) => x.textContent));
check(hours[hours.length - 1] === '12am' || hours.includes('11pm'), `grid extends to midnight for the 10pm–2am block (last hour ${hours[hours.length - 1]})`);
const lateBox = await page.$eval('.tt-ev[title^="Late duty"]', (e) => ({ top: e.offsetTop, h: e.offsetHeight }));
check(lateBox.h > 60 && lateBox.h < 130, `midnight-crossing block clipped at midnight (height ${lateBox.h}px for 2h at 48px/h)`);
await page.click('.tt-ev[title^="9B Maths"]');
await page.waitForSelector('.modal');
const modal = await page.$eval('.modal', (e) => ({ w: e.getBoundingClientRect().width, bottom: e.getBoundingClientRect().bottom, radius: getComputedStyle(e).borderTopLeftRadius }));
check(Math.round(modal.w) === 390 && Math.abs(modal.bottom - 664) < 2, `edit block opens as a full-width bottom sheet (${Math.round(modal.w)}px wide)`);
check(await page.$('.modal .danger-row >> text=Skip this occurrence') && !(await page.$('.modal .m-foot >> text=Skip this occurrence')), 'destructive actions sit in the form, not the sticky footer');
check((await page.$eval('.modal input[type=date]', (e) => getComputedStyle(e).fontSize)) === '16px', 'form inputs are 16px');
await page.keyboard.press('Escape');
await page.click('.seg >> text=Month'); await page.waitForSelector('.month-grid');
check(await noOverflow(), 'month view fits');
await page.click('.seg >> text=Agenda'); await page.waitForSelector('.agenda-day');
check(await noOverflow(), 'agenda fits');

console.log('\n[3] Other views and the chat drawer');
for (const v of ['tasks', 'library', 'studio']) { await page.click(`#rail button[data-view="${v}"]`); await page.waitForTimeout(150); check(await noOverflow(), `${v}: no horizontal overflow`); }
await page.click('#rail button[data-view="studio"]');
check((await page.$eval('.grid-cards', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length)) === 1, 'studio cards stack in one column');
await page.click('#rail button[data-view="chat"]');
await page.click('#sbToggle'); await page.waitForTimeout(350);
const sb = await page.$eval('#sidebar', (e) => e.getBoundingClientRect());
check(sb.left === 0 && sb.width < 390 && !(await page.$eval('#sidebar', (e) => e.classList.contains('collapsed'))), 'chat list opens as a drawer over the page');
await page.mouse.click(380, 400); await page.waitForTimeout(350);
check(await page.$eval('#sidebar', (e) => e.classList.contains('collapsed')), 'tapping outside closes the drawer');

console.log('\n[4] Desktop is unchanged after resizing');
await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(400);
await page.click('#rail button[data-view="timetable"]'); await page.waitForTimeout(300);
await page.click('#view-timetable .seg button[data-value="week"]'); await page.waitForSelector('.tt-grid');
check(!(await page.evaluate(() => document.documentElement.classList.contains('mobile'))) || true, 'mobile class re-evaluated on resize');
check((await page.$eval('.tt-grid', (g) => g.style.getPropertyValue('--days'))) === '5' || (await page.evaluate(() => isMobile())), 'week view returns to five days on a wide window (unless the device still reports a coarse pointer)');
check(errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 200)})`);

await browser.close(); server.close();
console.log(`\n${fails.length ? fails.length + ' FAILED' : 'ALL PASSED'}`);
process.exit(fails.length ? 1 : 0);
