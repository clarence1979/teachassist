/* ═══════════════════════════════════════════════════════════════════════════
   GitHub tools for Claude.
   They run in this browser with the teacher's own token, which goes only to api.github.com
   (never to Anthropic). Reading is automatic; every change (commit, branch, pull request,
   issue, comment, new repository) is shown to the teacher for approval first unless they
   switch that off in Settings or choose "Allow for this chat".
   ═══════════════════════════════════════════════════════════════════════════ */

const GH = { base: 'https://api.github.com', repos: new Map(), user: null };
const GH_REPO = { type: 'string', description: 'Repository as "owner/name" (use github_list_repos if unsure).' };
const GITHUB_TOOLS = [
  { name: 'github_list_repos', title: 'Listing GitHub repositories',
    description: "List repositories the teacher can access (their own, collaborations and organisations), most recently pushed first. Optionally filter by text, or list another user's/organisation's public repositories.",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Only repositories whose name or description contains this text' }, owner: { type: 'string', description: 'Another user or organisation (default: the teacher)' }, limit: { type: 'integer', description: 'Maximum results (default 50)' } } } },
  { name: 'github_list_files', title: 'Listing files on GitHub',
    description: 'List the files and folders of a repository (the whole tree, or under one folder) with sizes. Use it to find your way around before reading or changing files.',
    input_schema: { type: 'object', properties: { repo: GH_REPO, path: { type: 'string', description: 'Folder to list (default: whole repository)' }, ref: { type: 'string', description: 'Branch, tag or commit (default: the default branch)' } }, required: ['repo'] } },
  { name: 'github_read_file', title: 'Reading a file on GitHub',
    description: 'Read a text file from a repository, optionally only a range of lines (1-based, inclusive). Large files: read them in ranges.',
    input_schema: { type: 'object', properties: { repo: GH_REPO, path: { type: 'string' }, ref: { type: 'string', description: 'Branch, tag or commit (default: the default branch)' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['repo', 'path'] } },
  { name: 'github_search_code', title: 'Searching code on GitHub',
    description: 'Search code with GitHub code search, across GitHub or within one repository. Returns matching files.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search terms (GitHub code-search syntax)' }, repo: { type: 'string', description: 'Limit to one repository ("owner/name")' } }, required: ['query'] } },
  { name: 'github_list_commits', title: 'Reading commit history',
    description: 'Recent commits on a branch, optionally only those touching a path.',
    input_schema: { type: 'object', properties: { repo: GH_REPO, ref: { type: 'string', description: 'Branch or commit (default: the default branch)' }, path: { type: 'string' }, limit: { type: 'integer', description: 'Default 20' } }, required: ['repo'] } },
  { name: 'github_list_issues', title: 'Reading issues',
    description: 'List issues (not pull requests) in a repository.',
    input_schema: { type: 'object', properties: { repo: GH_REPO, state: { type: 'string', enum: ['open', 'closed', 'all'] }, labels: { type: 'string', description: 'Comma-separated label names' } }, required: ['repo'] } },
  { name: 'github_list_pull_requests', title: 'Reading pull requests',
    description: 'List pull requests in a repository.',
    input_schema: { type: 'object', properties: { repo: GH_REPO, state: { type: 'string', enum: ['open', 'closed', 'all'] } }, required: ['repo'] } },
  { name: 'github_get_pull_request', title: 'Reading a pull request',
    description: 'One pull request with its description, status and the changed files (with diffs, truncated when long).',
    input_schema: { type: 'object', properties: { repo: GH_REPO, number: { type: 'integer' } }, required: ['repo', 'number'] } },
  { name: 'github_commit_files', title: 'Committing to GitHub', write: true,
    description: 'Create, update or delete one or more files in ONE commit on a branch. If the branch does not exist it is created from base_branch (default: the default branch). For each file give its COMPLETE new text in content (read the file first when changing it; never send a fragment or a diff), or from_file to upload a file from this chat by its file name (a document you generated or a file the teacher attached), or delete: true.',
    input_schema: { type: 'object', properties: {
      repo: GH_REPO,
      branch: { type: 'string', description: 'Branch to commit to (default: the default branch)' },
      message: { type: 'string', description: 'Commit message' },
      files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string', description: 'Complete new text of the file' }, from_file: { type: 'string', description: 'Name of a file from this chat to upload instead of content' }, delete: { type: 'boolean' } }, required: ['path'] } },
      base_branch: { type: 'string', description: 'Branch a new branch starts from (default: the default branch)' },
    }, required: ['repo', 'message', 'files'] } },
  { name: 'github_create_branch', title: 'Creating a branch', write: true,
    description: 'Create a branch from another branch (default: the default branch).',
    input_schema: { type: 'object', properties: { repo: GH_REPO, branch: { type: 'string' }, from: { type: 'string' } }, required: ['repo', 'branch'] } },
  { name: 'github_create_pull_request', title: 'Opening a pull request', write: true,
    description: 'Open a pull request from head into base (default: the default branch).',
    input_schema: { type: 'object', properties: { repo: GH_REPO, title: { type: 'string' }, head: { type: 'string', description: 'Branch with the changes' }, base: { type: 'string' }, body: { type: 'string' }, draft: { type: 'boolean' } }, required: ['repo', 'title', 'head'] } },
  { name: 'github_create_issue', title: 'Opening an issue', write: true,
    description: 'Open an issue.',
    input_schema: { type: 'object', properties: { repo: GH_REPO, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } }, required: ['repo', 'title'] } },
  { name: 'github_comment', title: 'Commenting on GitHub', write: true,
    description: 'Comment on an issue or pull request.',
    input_schema: { type: 'object', properties: { repo: GH_REPO, number: { type: 'integer' }, body: { type: 'string' } }, required: ['repo', 'number', 'body'] } },
  { name: 'github_create_repo', title: 'Creating a repository', write: true,
    description: "Create a new repository in the teacher's account (private unless they ask for public). It starts with a README so files can be committed straight away.",
    input_schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, private: { type: 'boolean', description: 'Default true' } }, required: ['name'] } },
];
const githubToken = () => String(settings.githubToken || '').trim();
function githubToolDefs() { return GITHUB_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })); }
const isGithubTool = (name) => typeof name === 'string' && name.startsWith('github_');
function githubToolMeta(name) { const t = GITHUB_TOOLS.find((x) => x.name === name); return { kind: 'github', title: t?.title || 'GitHub' }; }
function githubToolQuery(name, i = {}) {
  const at = (p) => (p ? `${i.repo || ''}/${String(p).replace(/^\/+/, '')}` : i.repo || '');
  switch (name) {
    case 'github_list_repos': return i.owner || i.query || '';
    case 'github_read_file': return `${at(i.path)}${i.start_line ? ` (lines ${i.start_line}–${i.end_line || ''})` : ''}`;
    case 'github_list_files': return at(i.path);
    case 'github_search_code': return `${i.query || ''}${i.repo ? ` in ${i.repo}` : ''}`;
    case 'github_commit_files': return `${i.repo || ''} · ${(i.files || []).length} file${(i.files || []).length === 1 ? '' : 's'} → ${i.branch || 'default branch'}`;
    case 'github_create_pull_request': return `${i.repo || ''}: ${i.title || ''}`;
    case 'github_get_pull_request': case 'github_comment': return `${i.repo || ''} #${i.number || ''}`;
    case 'github_create_repo': return i.name || '';
    default: return i.repo || '';
  }
}

/* ───────────── HTTP ───────────── */
async function ghFetch(path, { method = 'GET', body, accept, raw = false } = {}) {
  const tok = githubToken();
  if (!tok) throw new Error('No GitHub token yet — add one in Settings → GitHub.');
  const res = await fetch(path.startsWith('http') ? path : GH.base + path, {
    method,
    headers: { Authorization: `Bearer ${tok}`, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await ghError(res, path);
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}
async function ghError(res, path) {
  let msg = '';
  try { const j = await res.json(); msg = j.message || ''; if (j.errors?.length) msg += ' — ' + j.errors.map((e) => e.message || e.code || JSON.stringify(e)).join('; '); } catch { /* not JSON */ }
  const where = path.split('?')[0];
  if (res.status === 401) return new Error('GitHub rejected the token (401 Bad credentials). Check or replace it in Settings → GitHub.');
  if (res.status === 403 && /rate limit/i.test(msg)) return new Error(`GitHub's rate limit was reached — wait a few minutes. (${msg})`);
  if (res.status === 403) return new Error(`GitHub refused (403) for ${where}: ${msg || 'the token lacks permission'}. A fine-grained token needs this repository selected and the matching permission (Contents, Issues or Pull requests: read and write).`);
  if (res.status === 404) return new Error(`Not found on GitHub (404): ${where}. Check the owner/name and path — or the token can't see this repository.`);
  if (res.status === 409 && /empty/i.test(msg)) return Object.assign(new Error('The repository is empty (no commits yet).'), { empty: true });
  if (res.status === 422) return new Error(`GitHub couldn't do that (422): ${msg}`);
  return new Error(`GitHub error ${res.status} for ${where}: ${msg || res.statusText}`);
}
function repoName(repo) {
  const r = String(repo || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '').split('/').slice(0, 2).join('/');
  if (!/^[\w.-]+\/[\w.-]+$/.test(r)) throw new Error(`repo must be "owner/name" (got "${repo || ''}")`);
  return r;
}
const ghPath = (p) => String(p || '').replace(/^\/+|\/+$/g, '').split('/').map(encodeURIComponent).join('/');
async function ghRepo(repo) {
  if (!GH.repos.has(repo)) GH.repos.set(repo, ghFetch(`/repos/${repo}`).catch((e) => { GH.repos.delete(repo); throw e; }));
  return GH.repos.get(repo);
}
function b64ToBytes(b64) { const s = atob(b64.replace(/\s/g, '')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
/** A file from this chat (generated or attached), by name — including files from the reply in progress. */
async function chatFileBlob(name, msg) {
  const want = String(name || '').split('/').pop();
  const msgs = [msg, ...[...state.messages].reverse()].filter(Boolean);
  for (const m of msgs) {
    for (const f of m.files || []) {
      if (f.name !== want && f.name !== name && f.fileId !== name) continue;
      if (f.status === 'ready' && f.key) { const rec = await getCachedFile(f.key); if (rec?.blob) return rec.blob; }
      if (f._blob) return f._blob;
      if (f.provider === 'anthropic' && f.fileId && relayBase()) return anthropicFileContent(keyFor('anthropic'), f.fileId);
    }
    for (const a of m.attachments || []) if (a.name === want || a.name === name) { const b = await getAttachmentBlob(a); if (b) return b; }
  }
  const names = [...new Set(msgs.flatMap((m) => [...(m.files || []).map((f) => f.name), ...(m.attachments || []).map((a) => a.name)]).filter(Boolean))];
  throw new Error(`No file called "${name}" in this chat${names.length ? ` (available: ${names.slice(0, 12).join(', ')})` : ''}.`);
}

/* ───────────── Approval for changes ───────────── */
function confirmGithubChange(title, lines) {
  const conv = activeConv();
  if (settings.githubConfirm === false || conv?.githubAllowAll) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const host = $('#modalHost');
    let done = false, obs = null;
    const finish = (ok, forChat) => {
      if (done) return; done = true; obs?.disconnect(); close();
      if (!ok) return reject(new Error('The teacher declined this GitHub change. Nothing was changed — ask what they would like instead.'));
      if (forChat && conv) { conv.githubAllowAll = true; store.put('conversations', conv).catch(() => {}); }
      resolve();
    };
    const close = openModal('Allow this GitHub change?', [
      el('div', { class: 'gh-confirm' },
        el('div', { class: 'gh-ttl', text: title }),
        el('ul', {}, ...lines.filter(Boolean).map((l) => el('li', { text: l }))),
        el('div', { class: 'help', text: 'Claude asked to make this change with your GitHub token. Nothing happens unless you allow it.' })),
    ], [
      el('button', { class: 'btn', text: 'Don’t allow', onclick: () => finish(false) }),
      el('button', { class: 'btn', text: 'Allow for this chat', onclick: () => finish(true, true) }),
      el('button', { class: 'btn primary', text: 'Allow', onclick: () => finish(true) }),
    ]);
    // Closing the sheet any other way (×, Esc, tapping outside) means "don't allow".
    obs = new MutationObserver(() => { if (!host.querySelector('.gh-confirm')) finish(false); });
    obs.observe(host, { childList: true });
  });
}

/* ───────────── Running the tools ───────────── */
async function executeGithubTool(name, input = {}, ctx = {}) {
  const i = input || {};
  switch (name) {
    case 'github_list_repos': {
      const limit = Math.min(Math.max(+i.limit || 50, 1), 200);
      const owner = String(i.owner || '').trim();
      let list = [];
      if (owner) {
        try { list = await ghFetch(`/users/${encodeURIComponent(owner)}/repos?sort=pushed&per_page=100`); }
        catch { list = await ghFetch(`/orgs/${encodeURIComponent(owner)}/repos?sort=pushed&per_page=100`); }
      } else {
        for (let page = 1; page <= 3 && list.length < 300; page++) {
          const batch = await ghFetch(`/user/repos?sort=pushed&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`);
          list.push(...batch); if (batch.length < 100) break;
        }
      }
      const q = String(i.query || '').toLowerCase();
      if (q) list = list.filter((r) => `${r.full_name} ${r.description || ''}`.toLowerCase().includes(q));
      const rows = list.slice(0, limit).map((r) => ({ repo: r.full_name, private: r.private, default_branch: r.default_branch, description: r.description || '', pushed: (r.pushed_at || '').slice(0, 10), pages: !!r.has_pages, url: r.html_url }));
      return { content: { count: list.length, shown: rows.length, repositories: rows }, summary: `${list.length} repositor${list.length === 1 ? 'y' : 'ies'}` };
    }
    case 'github_list_files': {
      const repo = repoName(i.repo); const info = await ghRepo(repo);
      const ref = String(i.ref || info.default_branch);
      let tree;
      try { tree = await ghFetch(`/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`); }
      catch (e) { if (e.empty) return { content: `${repo} is empty — it has no commits yet.`, summary: 'empty repository' }; throw e; }
      const prefix = String(i.path || '').replace(/^\/+|\/+$/g, '');
      const items = tree.tree.filter((t) => !prefix || t.path === prefix || t.path.startsWith(prefix + '/'));
      const MAX = 800;
      const lines = items.slice(0, MAX).map((t) => (t.type === 'tree' ? `${t.path}/` : `${t.path}  (${fmtBytes(t.size || 0)})`));
      return { content: `${repo} @ ${ref}${prefix ? ` — ${prefix}/` : ''}: ${items.length} entries${tree.truncated ? ' (GitHub truncated this listing; list a sub-folder for the rest)' : ''}${items.length > MAX ? `, first ${MAX} shown` : ''}\n${lines.join('\n')}`, summary: `${items.length} entries` };
    }
    case 'github_read_file': {
      const repo = repoName(i.repo); const path = String(i.path || '').replace(/^\/+/, '');
      if (!path) throw new Error('path is required');
      const q = i.ref ? `?ref=${encodeURIComponent(i.ref)}` : '';
      const meta = await ghFetch(`/repos/${repo}/contents/${ghPath(path)}${q}`);
      if (Array.isArray(meta)) return { content: `"${path}" is a folder: ${meta.map((x) => x.name + (x.type === 'dir' ? '/' : '')).join(', ')}`, summary: 'folder' };
      if (meta.type !== 'file') throw new Error(`${path} is a ${meta.type}, not a file`);
      let bytes;
      if (meta.content && meta.encoding === 'base64') bytes = b64ToBytes(meta.content);
      else { const res = await ghFetch(`/repos/${repo}/contents/${ghPath(path)}${q}`, { accept: 'application/vnd.github.raw+json', raw: true }); bytes = new Uint8Array(await res.arrayBuffer()); }
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { return { content: `${path} is a binary file (${fmtBytes(meta.size)}), so it can't be shown as text.`, summary: 'binary file' }; }
      const all = text.split('\n');
      const from = Math.max(1, +i.start_line || 1), to = Math.min(all.length, +i.end_line || all.length);
      let body = all.slice(from - 1, to).join('\n');
      const CAP = 120000;
      const cut = body.length > CAP;
      if (cut) body = body.slice(0, CAP);
      const range = from > 1 || to < all.length ? ` — lines ${from}–${to} of ${all.length}` : ` — ${all.length} lines`;
      return { content: `${repo}/${path}${i.ref ? ` @ ${i.ref}` : ''} (${fmtBytes(meta.size)}${range})${cut ? ' [truncated — read the rest with start_line]' : ''}\n\n${body}`, summary: `${path}${range}` };
    }
    case 'github_search_code': {
      const q = `${String(i.query || '').trim()}${i.repo ? ` repo:${repoName(i.repo)}` : ''}`;
      if (!q.trim()) throw new Error('query is required');
      const r = await ghFetch(`/search/code?q=${encodeURIComponent(q)}&per_page=30`);
      const rows = (r.items || []).map((x) => ({ repo: x.repository?.full_name, path: x.path, url: x.html_url }));
      return { content: { total: r.total_count, results: rows }, summary: `${r.total_count} match${r.total_count === 1 ? '' : 'es'}` };
    }
    case 'github_list_commits': {
      const repo = repoName(i.repo);
      const p = new URLSearchParams({ per_page: String(Math.min(+i.limit || 20, 100)) });
      if (i.ref) p.set('sha', i.ref); if (i.path) p.set('path', i.path);
      const r = await ghFetch(`/repos/${repo}/commits?${p}`);
      return { content: r.map((c) => ({ sha: c.sha.slice(0, 7), date: c.commit?.author?.date, author: c.commit?.author?.name, message: (c.commit?.message || '').split('\n')[0], url: c.html_url })), summary: `${r.length} commits` };
    }
    case 'github_list_issues': {
      const repo = repoName(i.repo);
      const p = new URLSearchParams({ state: i.state || 'open', per_page: '50' }); if (i.labels) p.set('labels', i.labels);
      const r = (await ghFetch(`/repos/${repo}/issues?${p}`)).filter((x) => !x.pull_request);
      return { content: r.map((x) => ({ number: x.number, title: x.title, state: x.state, labels: (x.labels || []).map((l) => l.name), comments: x.comments, updated: (x.updated_at || '').slice(0, 10), body: (x.body || '').slice(0, 400) })), summary: `${r.length} issues` };
    }
    case 'github_list_pull_requests': {
      const repo = repoName(i.repo);
      const r = await ghFetch(`/repos/${repo}/pulls?state=${encodeURIComponent(i.state || 'open')}&per_page=50`);
      return { content: r.map((x) => ({ number: x.number, title: x.title, state: x.state, draft: x.draft, head: x.head?.ref, base: x.base?.ref, author: x.user?.login, updated: (x.updated_at || '').slice(0, 10), url: x.html_url })), summary: `${r.length} pull requests` };
    }
    case 'github_get_pull_request': {
      const repo = repoName(i.repo); const n = +i.number;
      const [pr, files] = await Promise.all([ghFetch(`/repos/${repo}/pulls/${n}`), ghFetch(`/repos/${repo}/pulls/${n}/files?per_page=100`)]);
      let budget = 60000;
      const changed = files.map((f) => { const patch = (f.patch || '').slice(0, Math.max(0, Math.min(8000, budget))); budget -= patch.length; return { file: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: patch || undefined }; });
      return { content: { number: pr.number, title: pr.title, state: pr.state, merged: pr.merged, draft: pr.draft, head: pr.head?.ref, base: pr.base?.ref, author: pr.user?.login, body: pr.body || '', mergeable: pr.mergeable, url: pr.html_url, files: changed }, summary: `#${n}: ${files.length} files` };
    }
    case 'github_commit_files': return githubCommitFiles(i, ctx);
    case 'github_create_branch': {
      const repo = repoName(i.repo); const info = await ghRepo(repo);
      const branch = String(i.branch || '').trim(); if (!branch) throw new Error('branch is required');
      const from = String(i.from || info.default_branch);
      await confirmGithubChange(`Create branch “${branch}” in ${repo}`, [`From: ${from}`]);
      const base = await ghFetch(`/repos/${repo}/git/ref/heads/${ghPath(from)}`);
      await ghFetch(`/repos/${repo}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: base.object.sha } });
      return { content: { ok: true, branch, from, url: `https://github.com/${repo}/tree/${encodeURIComponent(branch)}` }, summary: `${branch} created` };
    }
    case 'github_create_pull_request': {
      const repo = repoName(i.repo); const info = await ghRepo(repo);
      const base = String(i.base || info.default_branch);
      await confirmGithubChange(`Open a pull request in ${repo}`, [`“${i.title}”`, `${i.head} → ${base}${i.draft ? ' (draft)' : ''}`, i.body ? `Description: ${String(i.body).slice(0, 200)}${String(i.body).length > 200 ? '…' : ''}` : '']);
      const pr = await ghFetch(`/repos/${repo}/pulls`, { method: 'POST', body: { title: i.title, head: i.head, base, body: i.body || '', draft: !!i.draft } });
      return { content: { ok: true, number: pr.number, url: pr.html_url }, summary: `#${pr.number} opened` };
    }
    case 'github_create_issue': {
      const repo = repoName(i.repo);
      await confirmGithubChange(`Open an issue in ${repo}`, [`“${i.title}”`, i.labels?.length ? `Labels: ${i.labels.join(', ')}` : '', i.body ? String(i.body).slice(0, 200) : '']);
      const r = await ghFetch(`/repos/${repo}/issues`, { method: 'POST', body: { title: i.title, body: i.body || '', ...(i.labels?.length ? { labels: i.labels } : {}) } });
      return { content: { ok: true, number: r.number, url: r.html_url }, summary: `#${r.number} opened` };
    }
    case 'github_comment': {
      const repo = repoName(i.repo);
      await confirmGithubChange(`Comment on ${repo} #${i.number}`, [String(i.body || '').slice(0, 300)]);
      const r = await ghFetch(`/repos/${repo}/issues/${+i.number}/comments`, { method: 'POST', body: { body: i.body || '' } });
      return { content: { ok: true, url: r.html_url }, summary: 'comment posted' };
    }
    case 'github_create_repo': {
      const nm = String(i.name || '').trim(); if (!/^[\w.-]+$/.test(nm)) throw new Error('name may only contain letters, numbers, ".", "-" and "_"');
      const priv = i.private !== false;
      await confirmGithubChange(`Create a new ${priv ? 'private' : 'public'} repository “${nm}”`, [i.description ? `Description: ${i.description}` : '', 'Starts with a README.']);
      const r = await ghFetch('/user/repos', { method: 'POST', body: { name: nm, description: i.description || '', private: priv, auto_init: true } });
      return { content: { ok: true, repo: r.full_name, default_branch: r.default_branch, url: r.html_url }, summary: `${r.full_name} created` };
    }
    default: throw new Error(`Unknown GitHub tool ${name}`);
  }
}
/** Several files in one commit (Git data API); an empty repository gets its first files through the contents API. */
async function githubCommitFiles(i, ctx) {
  const repo = repoName(i.repo); const info = await ghRepo(repo);
  const message = String(i.message || '').trim(); if (!message) throw new Error('message is required');
  const files = (Array.isArray(i.files) ? i.files : []).map((f) => ({ ...f, path: String(f?.path || '').replace(/^\/+/, '') })).filter((f) => f.path);
  if (!files.length) throw new Error('files is empty');
  if (files.length > 100) throw new Error('At most 100 files per commit');
  for (const f of files) if (!f.delete && f.content === undefined && !f.from_file) throw new Error(`${f.path}: give content, from_file or delete`);
  const branch = String(i.branch || info.default_branch);
  // Load uploads before asking, so the approval shows real sizes.
  const blobs = new Map();
  for (const f of files) if (f.from_file) blobs.set(f.path, await chatFileBlob(f.from_file, ctx.msg));
  const sizeOf = (f) => (f.delete ? 'delete' : f.from_file ? `${fmtBytes(blobs.get(f.path).size)} from “${f.from_file}”` : fmtBytes(new Blob([f.content || '']).size));
  await confirmGithubChange(`Commit ${files.length} file${files.length === 1 ? '' : 's'} to ${repo} → ${branch}`, [`Message: ${message}`, ...files.slice(0, 15).map((f) => `${f.delete ? '− ' : ''}${f.path} (${sizeOf(f)})`), files.length > 15 ? `…and ${files.length - 15} more` : '']);

  let baseSha = null, newBranch = false;
  try { baseSha = (await ghFetch(`/repos/${repo}/git/ref/heads/${ghPath(branch)}`)).object.sha; }
  catch (e) {
    if (e.empty) return commitToEmptyRepo(repo, branch, message, files, blobs);
    if (!/404/.test(e.message)) throw e;
    const from = String(i.base_branch || info.default_branch);
    try { baseSha = (await ghFetch(`/repos/${repo}/git/ref/heads/${ghPath(from)}`)).object.sha; }
    catch (e2) { if (e2.empty) return commitToEmptyRepo(repo, branch, message, files, blobs); throw e2; }
    newBranch = true;
  }
  const baseCommit = await ghFetch(`/repos/${repo}/git/commits/${baseSha}`);
  const tree = [];
  for (const f of files) {
    if (f.delete) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
    const body = f.from_file ? { content: arrayBufferToBase64(await blobs.get(f.path).arrayBuffer()), encoding: 'base64' } : { content: String(f.content ?? ''), encoding: 'utf-8' };
    const blob = await ghFetch(`/repos/${repo}/git/blobs`, { method: 'POST', body });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await ghFetch(`/repos/${repo}/git/trees`, { method: 'POST', body: { base_tree: baseCommit.tree.sha, tree } });
  const commit = await ghFetch(`/repos/${repo}/git/commits`, { method: 'POST', body: { message, tree: newTree.sha, parents: [baseSha] } });
  if (newBranch) await ghFetch(`/repos/${repo}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
  else await ghFetch(`/repos/${repo}/git/refs/heads/${ghPath(branch)}`, { method: 'PATCH', body: { sha: commit.sha } });
  return {
    content: { ok: true, commit: commit.sha, branch, created_branch: newBranch, url: `https://github.com/${repo}/commit/${commit.sha}`, files: files.map((f) => ({ path: f.path, action: f.delete ? 'deleted' : 'written' })), pages_hint: info.has_pages ? `GitHub Pages will republish this repository in a minute or two.` : undefined },
    summary: `${files.length} file${files.length === 1 ? '' : 's'} → ${branch} (${commit.sha.slice(0, 7)})`,
  };
}
async function commitToEmptyRepo(repo, branch, message, files, blobs) {
  let last = null;
  for (const f of files) {
    if (f.delete) continue;
    const content = f.from_file ? arrayBufferToBase64(await blobs.get(f.path).arrayBuffer()) : btoa(String.fromCharCode(...new TextEncoder().encode(String(f.content ?? ''))));
    last = await ghFetch(`/repos/${repo}/contents/${ghPath(f.path)}`, { method: 'PUT', body: { message, content, branch } });
  }
  GH.repos.delete(repo);
  return { content: { ok: true, branch, commit: last?.commit?.sha, url: last?.commit?.html_url, note: 'The repository was empty, so each file went in as its own commit.' }, summary: `${files.length} file(s) → ${branch}` };
}
/** Settings → Test: who the token belongs to and what it can reach. */
async function githubWhoAmI() {
  const u = await ghFetch('/user');
  GH.user = u;
  return u;
}
