/* ═══════════════════════════════════════════════════════════════════════════
   Spending — what each reply costs (estimated) and how much of your limit or credit is left.
   Neither Anthropic nor OpenAI lets an API key read the account balance, so the app adds up each
   reply's token use at list prices and compares it with the limit or credit the teacher enters.
   It also notices "usage limit reached" errors and shows when access returns.
   ═══════════════════════════════════════════════════════════════════════════ */
const SPEND_KEY = 'teachassist.spend.v1';
const SPEND_PRICES_AS_OF = 'November 2026';
// US$ per million tokens [input, output]. Claude cache writes cost 1.25× input, cache reads 0.1×;
// OpenAI cached input 0.1×. Web searches ≈ $10 per 1,000. Unknown models show no estimate.
const MODEL_PRICES = [
  [/fable-5|mythos/i, 10, 50],
  [/opus-5-5/i, 4, 20],
  [/opus-5(?![-.]5)|opus-4-[5-9]|opus-4\.[5-9]/i, 5, 25],
  [/opus-4|opus-3/i, 15, 75],
  [/sonnet-5/i, 2, 10],
  [/sonnet-4|sonnet-3/i, 3, 15],
  [/haiku-5/i, 0.10, 0.50],
  [/haiku-4/i, 1, 5],
  [/gpt-6(\.\d+)?-astra/i, 10, 50],
  [/gpt-6(\.\d+)?-sol/i, 2, 10],
  [/gpt-6(\.\d+)?-luna/i, 0.10, 0.50],
];
const SEARCH_USD = 0.01;
const spendBlank = () => ({ budget: 0, mode: 'monthly', creditSetAt: 0, sinceCredit: 0, limitUntil: null, limitNote: '', months: {} });
function spendState() {
  const s = parseJsonLoose(lsGet(SPEND_KEY)) || {};
  s.providers = s.providers || {};
  for (const p of ['anthropic', 'openai']) s.providers[p] = { ...spendBlank(), ...(s.providers[p] || {}) };
  return s;
}
function saveSpend(s) { try { localStorage.setItem(SPEND_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
function modelPrice(model) { const m = String(model || ''); const hit = MODEL_PRICES.find(([re]) => re.test(m)); return hit ? { input: hit[1], output: hit[2] } : null; }
/** Estimated US$ for one reply's usage (null when the model's price isn't known). */
function estimateCost(provider, model, u) {
  const p = modelPrice(model); if (!p || !u) return null;
  const M = 1e6;
  let usd;
  if (provider === 'anthropic') usd = ((u.input || 0) * p.input + (u.cacheWrite || 0) * p.input * 1.25 + (u.cacheRead || 0) * p.input * 0.1 + (u.output || 0) * p.output) / M;
  else usd = (Math.max(0, (u.input || 0) - (u.cacheRead || 0)) * p.input + (u.cacheRead || 0) * p.input * 0.1 + (u.output || 0) * p.output) / M;
  return usd + (u.searches || 0) * SEARCH_USD;
}
function recordSpend(provider, model, usage, msg) {
  if (provider !== 'anthropic' && provider !== 'openai') return null;
  const u = { ...usage };
  if (provider === 'openai' && !u.searches && msg?.segments) u.searches = msg.segments.filter((x) => x.type === 'tool' && x.kind === 'search' && x.status === 'done').length;
  const usd = estimateCost(provider, model, u);
  const s = spendState(); const p = s.providers[provider];
  const mk = monthKey();
  const b = p.months[mk] = p.months[mk] || { usd: 0, replies: 0, unpriced: 0 };
  b.replies++;
  if (usd === null) b.unpriced++; else { b.usd += usd; p.sinceCredit += usd; }
  if (p.limitUntil && Date.now() > Date.parse(p.limitUntil)) { p.limitUntil = null; p.limitNote = ''; }
  else if (p.limitUntil && usd !== null) { p.limitUntil = null; p.limitNote = ''; } // a reply went through, so the limit is lifted
  saveSpend(s);
  if (typeof renderModelSelect === 'function') renderModelSelect();
  return usd;
}
/** Remember "you have reached your usage limit / quota" errors so the app can say so up front. */
function noteProviderError(provider, e) {
  const t = `${e?.message || ''} ${e?.detail || ''}`;
  const limited = /usage limits?|spend(ing)? limit|exceeded your current quota|insufficient_quota|credit balance is too low|billing/i.test(t);
  if (!limited) return;
  const s = spendState(); const p = s.providers[provider];
  const when = t.match(/regain access on (\d{4}-\d{2}-\d{2})(?: at (\d{2}:\d{2}))?/i);
  p.limitUntil = when ? `${when[1]}T${when[2] || '00:00'}:00Z` : new Date(Date.now() + 365 * 864e5).toISOString();
  p.limitNote = when ? 'monthly limit' : /quota|credit/i.test(t) ? 'out of credit' : 'limit reached';
  saveSpend(s);
  const other = provider === 'anthropic' ? 'openai' : 'anthropic';
  const until = when ? ` until ${new Date(p.limitUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : '';
  showBanner('warn', `${providerName(provider)} has reached your account's ${p.limitNote === 'out of credit' ? 'credit' : 'spending'} limit${until}. Raise it in the ${provider === 'anthropic' ? '<a href="https://console.anthropic.com/settings/limits" target="_blank" rel="noopener">Anthropic console</a>' : '<a href="https://platform.openai.com/settings/organization/limits" target="_blank" rel="noopener">OpenAI dashboard</a>'}${keyFor(other) ? `, or <a href="#" data-act="use-${other}">switch to ${providerName(other)}</a>` : ''}.`);
  if (typeof renderModelSelect === 'function') renderModelSelect();
}
/** This month's estimate, and what's left of the limit or credit the teacher entered. */
function spendSummary(provider) {
  const s = spendState(); const p = s.providers[provider];
  const m = p.months[monthKey()] || { usd: 0, replies: 0, unpriced: 0 };
  const used = p.mode === 'credit' ? p.sinceCredit : m.usd;
  const limited = p.limitUntil && Date.now() < Date.parse(p.limitUntil);
  return { month: m.usd, replies: m.replies, unpriced: m.unpriced, budget: +p.budget || 0, mode: p.mode, left: p.budget ? Math.max(0, p.budget - used) : null, used, limited, limitUntil: limited ? p.limitUntil : null, limitNote: p.limitNote };
}
const usd = (n) => (n == null ? '' : n < 0.01 && n > 0 ? '< $0.01' : `$${n.toFixed(2)}`);
/** Short label for menus: "≈ $12.40 left" / "limit until 1 Dec" / "" */
function spendBadge(provider) {
  const x = spendSummary(provider);
  if (x.limited) return x.limitNote === 'out of credit' ? 'out of credit' : `limit until ${new Date(x.limitUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  if (x.left !== null) return `≈ ${usd(x.left)} left`;
  return '';
}
/** Settings → Spending: per provider, this month's estimate and the limit or credit to compare with. */
function spendSection() {
  const wrap = el('div', { class: 'm-section', id: 'spendSettings' }, el('h3', { text: 'Spending (estimate)' }),
    el('div', { class: 'help', style: { fontSize: '12.5px', color: 'var(--text-dim)', margin: '6px 0 8px' }, html: `Anthropic and OpenAI don't let an API key read your account balance, so Teach Assist estimates it: each reply's tokens × list prices (${SPEND_PRICES_AS_OF}) plus web searches. Enter your monthly limit or your current credit to see roughly what's left. For exact figures see the <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener">Anthropic console</a> or the <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener">OpenAI dashboard</a>.` }));
  for (const provider of ['anthropic', 'openai']) {
    const row = el('div', { class: 'spend-row', 'data-provider': provider });
    const paint = () => {
      const x = spendSummary(provider);
      const st = spendState().providers[provider];
      const amount = el('input', { type: 'number', min: '0', step: '1', placeholder: '0.00', value: st.budget ? String(st.budget) : '', class: 'spend-amt', 'aria-label': `${providerName(provider)} limit or credit in US dollars` });
      const mode = el('select', { class: 'sel', 'aria-label': 'What the amount is' }, el('option', { value: 'monthly', text: 'monthly limit' }), el('option', { value: 'credit', text: 'credit balance now' }));
      mode.value = st.mode;
      const commit = () => {
        const s = spendState(); const p = s.providers[provider];
        const v = Math.max(0, parseFloat(amount.value) || 0);
        const modeChanged = p.mode !== mode.value; const amountChanged = v !== (+p.budget || 0);
        p.budget = v; p.mode = mode.value;
        if (p.mode === 'credit' && (modeChanged || amountChanged)) { p.creditSetAt = Date.now(); p.sinceCredit = 0; } // the balance entered is "as of now"
        saveSpend(s); paint(); renderModelSelect();
      };
      amount.addEventListener('change', commit); mode.addEventListener('change', commit);
      row.innerHTML = '';
      row.append(
        el('div', { class: 'spend-h' }, el('b', { text: providerName(provider) }), x.limited ? el('span', { class: 'lm-chip fit-too-big', text: x.limitNote === 'out of credit' ? 'Out of credit' : `Limit reached until ${new Date(x.limitUntil).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}` }) : null),
        el('div', { class: 'spend-line', text: `This month: ≈ ${usd(x.month) || '$0.00'} over ${x.replies} repl${x.replies === 1 ? 'y' : 'ies'}${x.unpriced ? ` (${x.unpriced} with a model whose price isn't known)` : ''}${x.mode === 'credit' && x.budget ? ` · since you entered the credit: ≈ ${usd(x.used)}` : ''}` }),
        el('div', { class: 'spend-edit' }, el('span', { text: 'US$' }), amount, mode,
          x.left !== null ? el('span', { class: `spend-left${x.limited || x.left < Math.max(1, x.budget * 0.1) ? ' low' : ''}`, text: x.limited ? `≈ ${usd(x.left)} left by this estimate — but ${providerName(provider)} says the limit is reached` : `≈ ${usd(x.left)} left` }) : el('span', { class: 'help', text: 'Enter an amount to see what’s left.' }),
          el('button', { class: 'btn sm ghost', type: 'button', text: 'Reset', title: 'Clear this month’s estimate and any limit notice', onclick: () => { if (!confirm(`Reset ${providerName(provider)}'s spending estimate?`)) return; const s = spendState(); s.providers[provider] = { ...spendBlank(), budget: s.providers[provider].budget, mode: s.providers[provider].mode, creditSetAt: Date.now() }; saveSpend(s); paint(); renderModelSelect(); } })));
    };
    paint();
    wrap.append(row);
  }
  return wrap;
}
