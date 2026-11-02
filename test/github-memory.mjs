// GitHub tools for Claude (mocked GitHub REST API) and saved memory that persists until deliberately cleared.
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
const A = `http://127.0.0.1:${server.address().port}`;
const fails = [];
const check = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails.push(m); };
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const toolTurn = (id, name, input) => sse([
  { type: 'message_start', message: { id: `msg_${id}`, type: 'message', role: 'assistant', content: [], model: 'claude-fable-5-1', usage: { input_tokens: 100, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }, { type: 'message_stop' }]);
const textTurn = (text) => sse([
  { type: 'message_start', message: { id: 'msg_t', type: 'message', role: 'assistant', content: [], model: 'claude-fable-5-1', usage: { input_tokens: 100, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } }, { type: 'message_stop' }]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
await ctx.route('https://claude-files-relay.clarence17.workers.dev/**', (r) => r.fulfill({ status: 503, body: 'the real relay is never used in tests' }));
// Claude: a script of replies per request.
const claude = { script: [], bodies: [] };
await ctx.route('https://api.anthropic.com/**', (route) => {
  const req = route.request();
  if (req.method() === 'POST' && req.url().includes('/v1/messages')) {
    claude.bodies.push(JSON.parse(req.postData()));
    const next = claude.script.shift() || textTurn('Done.');
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: next });
  }
  return route.fulfill({ json: { data: [{ id: 'claude-fable-5-1', created_at: '2026-09-01T00:00:00Z' }] } });
});
await ctx.route('https://api.openai.com/**', (route) => route.fulfill({ json: { data: [] } }));
// GitHub: a small in-memory repository.
const gh = { calls: [], refs: { main: 'c0ffee1' }, empty: false };
await ctx.route('https://api.github.com/**', async (route) => {
  const req = route.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method();
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  gh.calls.push({ m, p, body, auth: req.headers().authorization });
  const json = (o, status = 200) => route.fulfill({ status, json: o });
  if (req.headers().authorization !== 'Bearer ghp_test123') return json({ message: 'Bad credentials' }, 401);
  if (p === '/user') return json({ login: 'clarence1979', name: 'Clarence' });
  if (p === '/user/repos' && m === 'GET') return json([{ full_name: 'clarence1979/teachassist', private: false, default_branch: 'main', description: 'Teach Assist', pushed_at: '2026-11-02T00:00:00Z', has_pages: true, html_url: 'https://github.com/clarence1979/teachassist' }, { full_name: 'clarence1979/blender-lessons', private: true, default_branch: 'main', description: 'Blender labs', pushed_at: '2026-10-30T00:00:00Z', html_url: 'x' }]);
  if (p === '/user/repos' && m === 'POST') return json({ full_name: `clarence1979/${body.name}`, default_branch: 'main', html_url: `https://github.com/clarence1979/${body.name}` }, 201);
  const repo = p.match(/^\/repos\/clarence1979\/(teachassist|empty-repo)(\/.*)?$/);
  if (!repo) return json({ message: 'Not Found' }, 404);
  const rest = repo[2] || '';
  if (!rest) return json({ full_name: `clarence1979/${repo[1]}`, default_branch: 'main', has_pages: repo[1] === 'teachassist' });
  if (repo[1] === 'empty-repo') {
    if (rest.startsWith('/git/ref/')) return json({ message: 'Git Repository is empty.' }, 409);
    if (rest.startsWith('/contents/') && m === 'PUT') return json({ commit: { sha: 'e1', html_url: 'https://github.com/clarence1979/empty-repo/commit/e1' } }, 201);
  }
  if (rest === '/git/trees/main') return json({ truncated: false, tree: [{ path: 'index.html', type: 'blob', size: 1200 }, { path: 'src', type: 'tree' }, { path: 'src/app.js', type: 'blob', size: 50000 }] });
  if (rest === '/contents/index.html') return json({ type: 'file', size: 26, sha: 'abc', encoding: 'base64', content: Buffer.from('<h1>Teach Assist</h1>\nline2').toString('base64') });
  const ref = rest.match(/^\/git\/ref\/heads\/(.+)$/);
  if (ref) { const b = decodeURIComponent(ref[1]); return gh.refs[b] ? json({ object: { sha: gh.refs[b] } }) : json({ message: 'Not Found' }, 404); }
  if (rest.startsWith('/git/commits/') && m === 'GET') return json({ sha: rest.split('/').pop(), tree: { sha: 'tree0' } });
  if (rest === '/git/blobs') return json({ sha: `blob${gh.calls.filter((c) => c.p.endsWith('/git/blobs')).length}` }, 201);
  if (rest === '/git/trees' && m === 'POST') return json({ sha: 'tree1' }, 201);
  if (rest === '/git/commits' && m === 'POST') return json({ sha: 'newc0mmit9' }, 201);
  const patch = rest.match(/^\/git\/refs\/heads\/(.+)$/);
  if (patch && m === 'PATCH') { gh.refs[decodeURIComponent(patch[1])] = body.sha; return json({ object: { sha: body.sha } }); }
  if (rest === '/git/refs' && m === 'POST') { gh.refs[body.ref.replace('refs/heads/', '')] = body.sha; return json({ ref: body.ref }, 201); }
  if (rest === '/pulls' && m === 'POST') return json({ number: 7, html_url: 'https://github.com/clarence1979/teachassist/pull/7' }, 201);
  return json({ message: `unmocked ${m} ${rest}` }, 404);
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => { if (!localStorage.getItem('teachassist.settings.v1')) { localStorage.setItem('teachassist.settings.v1', JSON.stringify({ provider: 'anthropic', saveHistory: true })); localStorage.setItem('teachassist.keys.v1', JSON.stringify({ anthropicKey: 'sk-ant-x', expiresAt: Date.now() + 1e9 })); } });
await page.goto(`${A}/teach-assist.html`);
await page.waitForFunction(() => document.querySelector('#modelSel option'));
const lastDone = async (n) => { try { await page.waitForFunction((n) => state.messages.length >= n && state.messages.at(-1).status === 'done', n, { timeout: 20000 }); } catch (e) { console.log('    state:', JSON.stringify(await page.evaluate(() => state.messages.slice(-2).map((m) => ({ role: m.role, status: m.status, error: m.error, text: (m.text || '').slice(0, 80), segs: (m.segments || []).map((s) => `${s.type}:${s.status || ''}:${(s.output || '').slice(0, 120)}`) }))))); throw e; } };
const send = async (text) => { const n = await page.evaluate(() => state.messages.length); await page.fill('#input', text); await page.click('#sendBtn'); return n + 2; };

console.log('\n[1] GitHub token in Settings');
check(!(await page.$eval('#tglGithub', (e) => e.classList.contains('hidden'))) && !(await page.$eval('#tglGithub', (e) => e.classList.contains('on'))), 'GitHub button shows for Claude, off while there is no token');
await page.click('#tglGithub');
await page.waitForSelector('#ghSettings');
check(await page.evaluate(() => document.activeElement === document.querySelector('#ghSettings input[type=password]')), 'pressing it without a token opens Settings at the GitHub section');
await page.fill('#ghSettings input[type=password]', 'ghp_test123');
await page.click('#ghSettings >> text=Test');
await page.waitForFunction(() => /Connected as @clarence1979/.test(document.querySelector('#ghSettings').textContent));
check(true, 'Test shows "Connected as @clarence1979 (Clarence)"');
const stored = await page.evaluate(() => ({ keys: JSON.parse(localStorage.getItem('teachassist.keys.v1')), blob: localStorage.getItem('teachassist.settings.v1') }));
check(stored.keys.githubToken === 'ghp_test123' && !stored.blob.includes('ghp_test123'), 'token kept with the API keys (Remember me), never in the settings blob');
await page.click('.modal .m-head .btn');
check(await page.$eval('#tglGithub', (e) => e.classList.contains('on')), 'adding a token switches GitHub on');
await page.selectOption('#providerSel', 'openai');
check(await page.$eval('#tglGithub', (e) => e.classList.contains('hidden')), 'GitHub button hidden for OpenAI');
await page.selectOption('#providerSel', 'anthropic');

console.log('\n[2] Reading: Claude lists repositories through the tool');
await page.click('#newChatBtn');
claude.script.push(toolTurn('toolu_r1', 'github_list_repos', { query: 'teach' }), textTurn('You have clarence1979/teachassist.'));
await lastDone(await send('Which of my repos is Teach Assist?'));
const b0 = claude.bodies.at(-2), b1 = claude.bodies.at(-1);
check(b0.tools.some((t) => t.name === 'github_commit_files') && /# GitHub/.test(b0.system), 'GitHub tools offered to Claude and explained in the system prompt');
const tr1 = b1.messages.at(-1).content[0];
check(tr1.type === 'tool_result' && /clarence1979\/teachassist/.test(tr1.content) && !/blender-lessons/.test(tr1.content), 'tool result returned to Claude (filtered by the query)');
check(gh.calls.every((c) => c.auth === 'Bearer ghp_test123'), 'the token only goes to api.github.com, as a Bearer header');
check(/Listing GitHub repositories/.test(await page.$eval('.msg.assistant:last-child', (e) => e.textContent)), 'the tool call shows as a card in the reply');

console.log('\n[3] Writing needs approval: one commit with text and a generated file');
await page.evaluate(async () => {
  const c = activeConv(); const key = 'inline:test:quiz.docx';
  await cacheFileBlob(key, new Blob([new Uint8Array([80, 75, 3, 4, 1, 2, 3])], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'quiz.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const m = { id: 'gen1', conversationId: c.id, role: 'assistant', createdAt: Date.now() - 1, text: 'Here is the quiz.', segments: [{ type: 'text', text: 'Here is the quiz.' }], files: [{ key, name: 'quiz.docx', status: 'ready', provider: 'inline', size: 7 }], provider: 'anthropic', status: 'done' };
  await store.put('messages', m); state.messages.push(m);
});
claude.script.push(toolTurn('toolu_c1', 'github_commit_files', { repo: 'clarence1979/teachassist', branch: 'main', message: 'Add quiz page', files: [{ path: 'quiz/index.html', content: '<h1>Quiz ✓</h1>' }, { path: 'quiz/quiz.docx', from_file: 'quiz.docx' }] }), textTurn('Committed.'));
let target = await send('Put the quiz page and the docx in the repo');
await page.waitForSelector('.gh-confirm');
const ask = await page.$eval('.modal', (e) => e.textContent);
check(/Commit 2 files to clarence1979\/teachassist → main/.test(ask) && /quiz\/quiz\.docx \(7 B from “quiz\.docx”\)/.test(ask) && /Add quiz page/.test(ask), 'approval sheet lists the repo, branch, message and each file');
check(!gh.calls.some((c) => c.p.endsWith('/git/blobs')), 'nothing written before approval');
await page.click('.modal button:text-is("Allow")');
await lastDone(target);
const blobs = gh.calls.filter((c) => c.p.endsWith('/git/blobs')).map((c) => c.body);
check(blobs[0].encoding === 'utf-8' && blobs[0].content === '<h1>Quiz ✓</h1>' && blobs[1].encoding === 'base64' && Buffer.from(blobs[1].content, 'base64')[0] === 80, 'text sent as UTF-8; the generated .docx uploaded byte-for-byte (base64)');
const tree = gh.calls.find((c) => c.p.endsWith('/git/trees') && c.m === 'POST').body;
check(tree.base_tree === 'tree0' && tree.tree.map((t) => t.path).join(',') === 'quiz/index.html,quiz/quiz.docx', 'one tree on top of the current commit');
check(gh.refs.main === 'newc0mmit9', 'branch moved to the new commit');
const tr2 = claude.bodies.at(-1).messages.at(-1).content[0];
check(/"ok":true/.test(tr2.content) && /commit\/newc0mmit9/.test(tr2.content) && /GitHub Pages/.test(tr2.content), 'Claude gets the commit link (and a GitHub Pages note)');

console.log('\n[4] Declining, and "Allow for this chat"');
const blobCount = () => gh.calls.filter((c) => c.p.endsWith('/git/blobs')).length;
const before = blobCount();
claude.script.push(toolTurn('toolu_c2', 'github_commit_files', { repo: 'clarence1979/teachassist', message: 'Delete readme', files: [{ path: 'README.md', delete: true }] }), textTurn('OK, I left it.'));
target = await send('Clean up');
await page.waitForSelector('.gh-confirm');
await page.click('.modal button:text-is("Don’t allow")');
await lastDone(target);
const tr3 = claude.bodies.at(-1).messages.at(-1).content[0];
check(tr3.is_error && /declined/.test(tr3.content) && gh.calls.filter((c) => c.p.endsWith('/git/trees') && c.m === 'POST').length === 1, 'declining sends Claude an error and changes nothing');
claude.script.push(toolTurn('toolu_b1', 'github_create_branch', { repo: 'clarence1979/teachassist', branch: 'feature/quiz' }), toolTurn('toolu_p1', 'github_create_pull_request', { repo: 'clarence1979/teachassist', title: 'Quiz', head: 'feature/quiz' }), textTurn('PR opened.'));
target = await send('Make a branch and a PR');
await page.waitForSelector('.gh-confirm');
await page.click('.modal button:text-is("Allow for this chat")');
await lastDone(target);
check(gh.refs['feature/quiz'] === 'newc0mmit9' && gh.calls.some((c) => c.p.endsWith('/pulls') && c.m === 'POST' && c.body.base === 'main'), 'branch created from main, then the pull request opened without asking again');
check(blobCount() === before, 'the declined commit never uploaded anything');

console.log('\n[5] New branch on commit, and a first commit to an empty repository');
claude.script.push(toolTurn('toolu_c3', 'github_commit_files', { repo: 'clarence1979/teachassist', branch: 'fix/typo', message: 'Fix typo', files: [{ path: 'index.html', content: '<h1>Teach Assist</h1>' }] }), toolTurn('toolu_c4', 'github_commit_files', { repo: 'clarence1979/empty-repo', message: 'First commit', files: [{ path: 'index.html', content: 'Hello' }] }), textTurn('Both done.'));
await lastDone(await send('Two more'));
check(gh.calls.some((c) => c.p.endsWith('/git/refs') && c.m === 'POST' && c.body.ref === 'refs/heads/fix/typo'), 'a missing branch is created from the default branch');
const put = gh.calls.find((c) => c.m === 'PUT' && c.p.includes('/empty-repo/contents/index.html'));
check(put && Buffer.from(put.body.content, 'base64').toString() === 'Hello' && put.body.branch === 'main', 'an empty repository gets its first file through the contents API');

console.log('\n[6] Saved memory: Claude saves, a new chat knows');
claude.script.push(toolTurn('toolu_m1', 'memory_save', { notes: [{ text: 'Teaches VCE Software Development', topic: 'profile', pinned: true }, { text: 'Prefers structured questions over report tasks', topic: 'preferences' }] }), textTurn('Saved.'));
await page.click('#newChatBtn');
await lastDone(await send('Remember: I teach VCE Software Development and prefer structured questions over reports.'));
check(claude.bodies.at(-2).tools.some((t) => t.name === 'memory_save') && /You DO have long-term memory/.test(claude.bodies.at(-2).system), 'memory tools offered and the prompt says memory persists');
const notes = await page.evaluate(async () => (await memoryAll()).map((n) => `${n.topic}|${n.pinned}|${n.text}`));
check(notes.includes('profile|true|Teaches VCE Software Development') && notes.length === 2, 'notes saved on the device (pinned flag kept)');
await page.click('#newChatBtn');
await lastDone(await send('Make me a practice task'));
check(/Teaches VCE Software Development/.test(claude.bodies.at(-1).system) && /Prefers structured questions/.test(claude.bodies.at(-1).system), 'the next new chat gets the notes in its system prompt');

console.log('\n[7] Survives reloads and clearing all chats/sessions; OpenAI and on-device get it too');
await page.evaluate(() => clearAllSessions());
await page.reload(); await page.waitForFunction(() => document.querySelector('#modelSel option'));
check((await page.evaluate(async () => (await memoryAll()).length)) === 2, 'notes survive a reload and "clear all sessions"');
const oai = await page.evaluate(() => clientToolDefs({ imageTool: false }).map((t) => t.name));
check(oai.includes('memory_save') && oai.includes('memory_search') && !oai.includes('github_commit_files'), 'OpenAI gets the memory tools too (GitHub stays Claude-only)');
const local = await page.evaluate(async () => { const conv = { notesSnapshot: await memoryPromptBlock() }; return (await buildLocalMessages(conv, [{ role: 'user', text: 'hi' }]))[0].content; });
check(/Teaches VCE Software Development/.test(local), 'on-device models get the notes too');

console.log('\n[8] Memory manager: pin, edit, import with sections to untick, forget');
await page.click('#rail button[data-view="chat"]');
await page.evaluate(() => openMemorySheet());
await page.waitForSelector('.mem-row');
check((await page.$$('.mem-row')).length === 2 && /2 notes · 2 go with every new chat/.test(await page.$eval('.mem-sheet', (e) => e.textContent)), 'manager lists notes and says which go with every chat');
await page.click('.modal >> text=Import notes…');
await page.waitForSelector('.mem-import');
await page.fill('.mem-import', `---\nname: profile\ndescription: who\n---\n- [stated] Name: Clarence Goh\n- [stated] Runs Digital Vector\n\n## people/son\n- [stated] Son Christopher has NDIS support\n\n## areas/blender-lessons\n- Blender labs are single-file HTML pages\n- Kept in a GitHub repo\n`);
await page.waitForFunction(() => /5 notes/.test(document.querySelector('.mem-preview').textContent));
const rows = await page.$$eval('.mem-topic-row', (r) => r.map((x) => x.textContent));
check(rows.length === 3 && rows.some((r) => /people: son/.test(r) && /personal/.test(r)), 'import groups notes by section and marks personal ones');
await page.click('.mem-topic-row:has-text("people: son") input');
await page.click('.modal >> text=/Import 4 notes/');
await page.waitForSelector('.mem-sheet');
const after = await page.evaluate(async () => (await memoryAll()).map((n) => `${n.topic}|${n.pinned}|${n.text}`));
check(after.length === 6 && after.includes('profile|true|Name: Clarence Goh') && !after.some((n) => /NDIS/.test(n)) && after.includes('areas: blender-lessons|false|Kept in a GitHub repo'), 'imported 4 notes (unticked section left out; profile pinned; "[stated]" tags stripped)');
await page.click('.mem-row:has-text("Kept in a GitHub repo") .mem-pin');
await page.waitForFunction(async () => (await memoryAll()).find((n) => n.text === 'Kept in a GitHub repo')?.pinned === true);
check(true, 'pin toggles from the list');
page.once('dialog', (d) => d.accept());
await page.click('.modal >> text=Forget everything');
await page.waitForFunction(async () => (await memoryAll()).length === 0);
check(true, '"Forget everything" (confirmed) clears memory');
await page.click('.modal .m-head .btn');
await page.evaluate(() => saveSettings({ savedMemory: false }));
check(!(await page.evaluate(() => clientToolDefs({ imageTool: false }).some((t) => t.name.startsWith('memory_')))), 'with memory switched off, no memory tools are offered');

console.log('\n[9] About me (JSON) next to the API keys, sent with every request');
await page.evaluate(() => saveSettings({ savedMemory: true }));
await page.click('#settingsBtn');
await page.waitForSelector('.about-json');
await page.fill('.about-json', '{ "name": "Clarence", "school": "PVCC", }');
await page.waitForFunction(() => /Not valid JSON/.test(document.querySelector('.about-field').textContent));
check(/line 1, column/.test(await page.$eval('.about-field', (e) => e.textContent)), 'invalid JSON is flagged with where the problem is, and not saved');
await page.fill('.about-json', '{ "name": "Clarence", "school": "PVCC", "instructions": ["Use Australian spelling"] }');
await page.waitForFunction(() => /Valid JSON/.test(document.querySelector('.about-field').textContent));
await page.click('.about-field >> text=Format');
check((await page.$eval('.about-json', (e) => e.value)).includes('\n  "name": "Clarence"'), 'Format pretty-prints it');
await page.click('.modal .m-head .btn');
const st = await page.evaluate(() => ({ ls: localStorage.getItem('teachassist.aboutme.v1'), blob: localStorage.getItem('teachassist.settings.v1'), keys: localStorage.getItem('teachassist.keys.v1') }));
check(JSON.parse(st.ls).school === 'PVCC' && !st.blob.includes('PVCC') && !st.keys.includes('PVCC'), 'saved in the browser next to the keys (its own entry, so it never expires with them)');
await page.click('#newChatBtn');
await lastDone(await send('Write a note home'));
check(claude.bodies.at(-1).system.includes('# About me (from the teacher)') && claude.bodies.at(-1).system.includes('{"name":"Clarence","school":"PVCC","instructions":["Use Australian spelling"]}'), 'sent with the Claude request (compact JSON in the system prompt)');
check(await page.evaluate(() => buildSystemPrompt('openai', { conv: activeConv() }).includes('"school":"PVCC"')), 'and in the OpenAI instructions');
await page.reload(); await page.waitForFunction(() => document.querySelector('#modelSel option'));
check(await page.evaluate(() => JSON.parse(settings.aboutMe).name === 'Clarence'), 'still there after a reload');
await page.click('#settingsBtn'); await page.waitForSelector('.about-json');
await page.click('.modal label.check:has-text("Remember me") input');
await page.click('.modal .m-head .btn');
check(await page.evaluate(() => !localStorage.getItem('teachassist.aboutme.v1') && JSON.parse(sessionStorage.getItem('teachassist.aboutme.v1')).name === 'Clarence'), 'with Remember me off it moves to this tab only, like the keys');
check(errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 200)})`);

await browser.close(); server.close();
console.log(`\n${fails.length ? fails.length + ' FAILED' : 'ALL PASSED'}`);
process.exit(fails.length ? 1 : 0);
