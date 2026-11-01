/* ═══════════════════════════════════════════════════════════════════════════
   On-device AI — models that run in the browser, no API key, works offline once downloaded.
     • GPU (WebGPU): WebLLM (MLC) — fast; Chrome/Edge desktop, Chrome Android 12+, Safari/iOS 26+.
     • CPU fallback: wllama (llama.cpp in WebAssembly) — slower, works without WebGPU.
   Model weights are cached by the runtime (WebLLM: Cache Storage; wllama: Origin Private File
   System). The runtime libraries themselves are cached in this app's own Cache Storage, so
   after the first download everything loads from the device — including offline.
   ═══════════════════════════════════════════════════════════════════════════ */

const LOCAL_RT = {
  webllm: 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/lib/index.js',
  wllama: 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/index.js',
  wllamaWasm: 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/wasm/wllama.wasm',
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.4.299/pdf.min.mjs',
  pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.4.299/pdf.worker.min.mjs',
  cache: 'teach-assist-local-runtime',
};
const LOCAL_STATE_KEY = 'teachassist.local.v1';
const LOCAL_CTX = 4096;            // context window used for every local model
const LOCAL_MAX_OUT = 1536;        // max new tokens per reply

/* Catalogue, smallest → largest. vram = WebLLM's own vram_required_MB (0.2.86) for the q4f16 / q4f32
   builds; dl = approximate download in MB; gguf = CPU build (Q4_K_M) for wllama, where one fits. */
const LOCAL_MODELS = [
  { key: 'smollm2-360m', name: 'SmolLM2 360M', params: '0.36B', blurb: 'Tiny and fast but basic — it often misunderstands. Only for very old or low-memory phones.', quality: 'Basic', low: true, temp: 0.3,
    webllm: { f16: 'SmolLM2-360M-Instruct-q4f16_1-MLC', f32: 'SmolLM2-360M-Instruct-q4f32_1-MLC' }, vram: { f16: 376, f32: 580 }, dl: { f16: 270, f32: 300 }, f16Required: true,
    gguf: { url: 'https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf', mb: 271 } },
  { key: 'qwen3.5-0.8b', name: 'Qwen3.5 0.8B', params: '0.8B', blurb: 'Small and multilingual. Short explanations and simple drafts; check its facts.', quality: 'Fair', low: true, temp: 0.4,
    webllm: { f16: 'Qwen3.5-0.8B-q4f16_1-MLC', f32: 'Qwen3.5-0.8B-q4f32_1-MLC' }, vram: { f16: 1629, f32: 1894 }, dl: { f16: 560, f32: 620 },
    gguf: { url: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf', mb: 533 } },
  { key: 'llama3.2-1b', name: 'Llama 3.2 1B', params: '1B', blurb: 'Dependable for short explanations, emails and simple quiz questions; check its facts.', quality: 'Fair', low: true, temp: 0.5,
    webllm: { f16: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', f32: 'Llama-3.2-1B-Instruct-q4f32_1-MLC' }, vram: { f16: 879, f32: 1129 }, dl: { f16: 710, f32: 760 },
    gguf: { url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf', mb: 808 } },
  { key: 'qwen3.5-2b', name: 'Qwen3.5 2B', params: '2B', blurb: 'Noticeably better writing and reasoning; needs a recent phone or a laptop.', quality: 'Good', low: false,
    webllm: { f16: 'Qwen3.5-2B-q4f16_1-MLC', f32: 'Qwen3.5-2B-q4f32_1-MLC' }, vram: { f16: 2245, f32: 2592 }, dl: { f16: 1300, f32: 1400 },
    gguf: { url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf', mb: 1280 } },
  { key: 'llama3.2-3b', name: 'Llama 3.2 3B', params: '3B', blurb: 'Strong general model that still fits iPads and high-end phones.', quality: 'Good', low: true,
    webllm: { f16: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', f32: 'Llama-3.2-3B-Instruct-q4f32_1-MLC' }, vram: { f16: 2264, f32: 2952 }, dl: { f16: 1800, f32: 1900 }, gguf: null },
  { key: 'phi4-mini', name: 'Phi-4 mini', params: '3.8B', blurb: 'Good at maths and step-by-step reasoning. Laptops and desktops.', quality: 'Very good', low: false,
    webllm: { f16: 'Phi-4-mini-instruct-q4f16_1-MLC', f32: 'Phi-4-mini-instruct-q4f32_1-MLC' }, vram: { f16: 3438, f32: 4221 }, dl: { f16: 2200, f32: 2300 }, gguf: null },
  { key: 'qwen3.5-4b', name: 'Qwen3.5 4B', params: '4B', blurb: 'Best quality that runs well on most laptops with 8 GB+ memory.', quality: 'Very good', low: false,
    webllm: { f16: 'Qwen3.5-4B-q4f16_1-MLC', f32: 'Qwen3.5-4B-q4f32_1-MLC' }, vram: { f16: 3868, f32: 4680 }, dl: { f16: 2500, f32: 2600 }, gguf: null },
  { key: 'qwen3.5-9b', name: 'Qwen3.5 9B', params: '9B', blurb: 'Closest to the cloud models. Needs 16 GB+ memory and a strong GPU.', quality: 'Best', low: false,
    webllm: { f16: 'Qwen3.5-9B-q4f16_1-MLC', f32: 'Qwen3.5-9B-q4f32_1-MLC' }, vram: { f16: 6433, f32: 7545 }, dl: { f16: 5300, f32: 5500 }, gguf: null },
];
const LOCAL = { device: null, deviceP: null, engine: null, loading: null, libs: {}, blobUrls: {}, pdfText: new Map(), status: { phase: 'idle' } };
const localModel = (key) => LOCAL_MODELS.find((m) => m.key === key) || null;
const fmtMB = (mb) => (mb >= 1000 ? `${(mb / 1000).toFixed(mb >= 10000 ? 0 : 1)} GB` : `${Math.round(mb)} MB`);

/* ───────────── Saved state (which models are on this device) ───────────── */
function localState() { const s = parseJsonLoose(lsGet(LOCAL_STATE_KEY)) || {}; s.models = s.models || {}; return s; }
function saveLocalState(s) { try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
function isLocalDownloaded(key, engine) { const r = localState().models[key]; return !!r && (!engine || r.engine === engine); }
function markLocalDownloaded(key, info) { const s = localState(); s.models[key] = { ...(s.models[key] || {}), ...info, savedAt: Date.now() }; saveLocalState(s); }
function unmarkLocalDownloaded(key) { const s = localState(); delete s.models[key]; saveLocalState(s); }

/* ───────────── Runtime libraries, cached in our own Cache Storage ───────────── */
async function cachedBlobUrl(url, type) {
  if (!cacheStorageOk()) return url; // file:// — the browser's HTTP cache is all we have
  if (!LOCAL.blobUrls[url]) LOCAL.blobUrls[url] = cachedBlobUrlInner(url, type).catch((e) => { delete LOCAL.blobUrls[url]; throw e; });
  return LOCAL.blobUrls[url];
}
async function cachedBlobUrlInner(url, type) {
  const c = await caches.open(LOCAL_RT.cache);
  let res = await c.match(url);
  if (!res) {
    const fresh = await fetch(url, { mode: 'cors' });
    if (!fresh.ok) throw new Error(`Could not download ${url.split('/').pop()} (${fresh.status})`);
    await c.put(url, fresh.clone());
    res = fresh;
  }
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
}
async function loadLocalLib(name) {
  if (!LOCAL.libs[name]) LOCAL.libs[name] = (async () => import(await cachedBlobUrl(LOCAL_RT[name], 'text/javascript')))().catch((e) => { delete LOCAL.libs[name]; throw e; });
  return LOCAL.libs[name];
}

/* ───────────── What this device can run ───────────── */
async function probeWebGPU() {
  if (!navigator.gpu?.requestAdapter) return null;
  try {
    const adapter = await Promise.race([navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), new Promise((r) => setTimeout(() => r(null), 4000))]);
    if (!adapter) return null;
    let info = adapter.info || null;
    if (!info && adapter.requestAdapterInfo) { try { info = await adapter.requestAdapterInfo(); } catch { /* ignore */ } }
    return {
      f16: adapter.features?.has?.('shader-f16') || false,
      maxStorageMB: Math.round((adapter.limits?.maxStorageBufferBindingSize || 0) / 1048576),
      maxBufferMB: Math.round((adapter.limits?.maxBufferSize || 0) / 1048576),
      vendor: info?.vendor || '', architecture: info?.architecture || '', description: info?.description || '',
      fallback: !!(adapter.isFallbackAdapter || info?.isFallbackAdapter),
    };
  } catch { return null; }
}
/** Device check: platform, memory (reported by Chromium, estimated elsewhere), WebGPU, storage → memory budget. */
async function detectLocalDevice(force = false) {
  if (LOCAL.device && !force) return LOCAL.device;
  if (LOCAL.deviceP && !force) return LOCAL.deviceP;
  LOCAL.deviceP = (async () => {
    const ua = navigator.userAgent || '';
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const os = /iPhone|iPod/.test(ua) ? 'ios' : (/iPad/.test(ua) || iPadOS) ? 'ipados' : /Android/.test(ua) ? 'android' : /Mac OS X|Macintosh/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : /CrOS/.test(ua) ? 'chromeos' : /Linux/.test(ua) ? 'linux' : 'other';
    const shortSide = Math.min(screen.width || 0, screen.height || 0);
    const kind = os === 'ios' ? 'phone' : os === 'ipados' ? 'tablet' : os === 'android' ? (shortSide >= 600 ? 'tablet' : 'phone') : 'computer';
    const reported = typeof navigator.deviceMemory === 'number' && navigator.deviceMemory > 0 ? navigator.deviceMemory : null;
    // Chromium rounds memory to a power of two and caps it at 8 GB; Safari and Firefox don't report it.
    const ramGB = reported || (kind === 'phone' ? (os === 'ios' ? 6 : 4) : 8);
    const gpu = await probeWebGPU();
    let storageFreeMB = null, persisted = null;
    try { const e = await navigator.storage?.estimate?.(); if (e?.quota) storageFreeMB = Math.round((e.quota - (e.usage || 0)) / 1048576); } catch { /* ignore */ }
    try { persisted = await navigator.storage?.persisted?.(); } catch { /* ignore */ }
    const engine = gpu && !gpu.fallback ? 'webllm' : 'wllama';
    // How much memory one model may use without the browser closing the tab.
    let budgetMB;
    if (os === 'ios') budgetMB = 1800;                         // iOS caps a tab's memory, whatever the phone has
    else if (os === 'ipados') budgetMB = 3500;
    else if (kind === 'phone') budgetMB = ramGB * 1024 * 0.3;   // Android shares memory with the GPU and other apps
    else if (kind === 'tablet') budgetMB = ramGB * 1024 * 0.45;
    else budgetMB = Math.min(ramGB * 1024 * (reported && reported >= 8 ? 0.6 : 0.55), 9000);
    // No WebGPU: models run on the processor (one thread on GitHub Pages), so keep them small enough to be usable.
    if (engine === 'wllama') budgetMB = Math.min(budgetMB, kind === 'computer' ? 2000 : kind === 'tablet' ? 1600 : 1400);
    const saveData = !!navigator.connection?.saveData;
    const metered = /^(slow-2g|2g|3g)$/.test(navigator.connection?.effectiveType || '') || navigator.connection?.type === 'cellular';
    LOCAL.device = { os, kind, ramGB, ramSource: reported ? 'reported' : 'estimated', gpu, engine, variant: gpu?.f16 ? 'f16' : 'f32', cores: navigator.hardwareConcurrency || null, storageFreeMB, persisted, budgetMB: Math.round(budgetMB), saveData, metered };
    return LOCAL.device;
  })();
  return LOCAL.deviceP;
}
/** Catalogue annotated for this device: engine, memory need, download size, fit and recommendation. */
function localCatalog(dev) {
  const out = LOCAL_MODELS.map((m) => {
    const engine = dev.engine;
    const available = engine === 'webllm' ? !(m.f16Required && dev.variant !== 'f16' && !m.webllm.f32) : !!m.gguf;
    const variant = engine === 'webllm' ? (m.f16Required && dev.variant !== 'f16' ? 'f32' : dev.variant) : 'gguf';
    const needMB = engine === 'webllm' ? m.vram[variant] : Math.round((m.gguf?.mb || 0) * 1.3 + 250);
    const downloadMB = engine === 'webllm' ? m.dl[variant] : m.gguf?.mb || 0;
    let fit = !available ? 'unavailable' : needMB <= dev.budgetMB * 0.8 ? 'good' : needMB <= dev.budgetMB ? 'tight' : 'too-big';
    if (fit === 'good' && dev.kind === 'phone' && engine === 'webllm' && !m.low) fit = 'tight';
    const noSpace = dev.storageFreeMB != null && downloadMB > dev.storageFreeMB - 300;
    return { ...m, engine, variant, needMB, downloadMB, fit, noSpace, runId: engine === 'webllm' ? m.webllm[variant] : m.gguf?.url, downloaded: isLocalDownloaded(m.key, engine) };
  });
  // Suggest the most capable model that fits comfortably — but never the "basic" one if anything better fits at all.
  const ok = (m) => !m.noSpace && m.quality !== 'Basic';
  const good = out.filter((m) => m.fit === 'good' && ok(m));
  const rec = good.at(-1) || out.find((m) => m.fit === 'tight' && ok(m)) || out.find((m) => (m.fit === 'good' || m.fit === 'tight') && !m.noSpace) || null;
  if (rec) rec.recommended = true;
  return out;
}
function localFitLabel(m) {
  return { good: 'Good fit', tight: 'May be slow', 'too-big': 'Too large for this device', unavailable: 'Needs a GPU (WebGPU)' }[m.fit] || '';
}
function deviceSummary(dev) {
  const where = { ios: 'iPhone', ipados: 'iPad', android: dev.kind === 'tablet' ? 'Android tablet' : 'Android phone', mac: 'Mac', windows: 'Windows PC', chromeos: 'Chromebook', linux: 'Linux PC' }[dev.os] || 'This device';
  const mem = dev.ramSource === 'reported' ? `${dev.ramGB >= 8 ? '8 GB or more' : `${dev.ramGB} GB`} memory` : `memory not reported${dev.os === 'ios' ? ' (iPhones limit each browser tab, so smaller models are safest)' : ''}`;
  const gpu = dev.engine === 'webllm' ? `graphics acceleration (WebGPU${dev.variant === 'f16' ? ', fast 16-bit' : ''})` : 'no WebGPU, so models run on the processor (slower)';
  return `${where} · ${mem} · ${gpu}${dev.storageFreeMB != null ? ` · ${fmtMB(dev.storageFreeMB)} free storage` : ''}`;
}

/* ───────────── Engine: load (download or cache), chat, unload ───────────── */
function setLocalStatus(st) { LOCAL.status = st; if (typeof renderLocalStatus === 'function') renderLocalStatus(); }
async function requestPersistentStorage() { try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* ignore */ } }
/** Make sure the chosen model is loaded. Downloads it the first time; afterwards it loads from the device. */
async function ensureLocalEngine(key) {
  const dev = await detectLocalDevice();
  const m = localCatalog(dev).find((x) => x.key === key);
  if (!m) throw new Error('Unknown on-device model.');
  if (m.fit === 'unavailable') throw new Error(`${m.name} needs WebGPU, which this browser doesn't offer. Pick one of the smaller models, which run on the processor.`);
  if (LOCAL.engine?.key === key) return LOCAL.engine;
  if (LOCAL.loading?.key === key) return LOCAL.loading.promise;
  const promise = (async () => {
    if (LOCAL.engine) { try { await LOCAL.engine.unload(); } catch { /* ignore */ } LOCAL.engine = null; }
    const wasDownloaded = isLocalDownloaded(key, m.engine);
    setLocalStatus({ phase: wasDownloaded ? 'loading' : 'downloading', key, name: m.name, progress: 0, text: wasDownloaded ? 'Loading from this device…' : 'Preparing download…' });
    if (!wasDownloaded) requestPersistentStorage();
    let engine;
    try {
      engine = m.engine === 'webllm' ? await loadWebLLMEngine(m, wasDownloaded) : await loadWllamaEngine(m, wasDownloaded);
    } catch (e) {
      // WebGPU drivers vary; if the GPU engine fails and a CPU build exists, fall back to it.
      if (m.engine === 'webllm' && m.gguf && !/abort|memory|storage|download|internet/i.test(e?.message || '')) {
        console.warn('[local] WebLLM failed, trying the CPU engine', e);
        setLocalStatus({ phase: 'downloading', key, name: m.name, progress: 0, text: 'Graphics engine failed — switching to the processor engine…' });
        engine = await loadWllamaEngine({ ...m, engine: 'wllama', runId: m.gguf.url, downloadMB: m.gguf.mb }, isLocalDownloaded(key, 'wllama'));
      } else throw e;
    }
    markLocalDownloaded(key, { engine: engine.kind, variant: engine.kind === 'webllm' ? m.variant : 'gguf', mb: engine.kind === 'webllm' ? m.downloadMB : m.gguf?.mb });
    LOCAL.engine = engine;
    setLocalStatus({ phase: 'ready', key, name: m.name, progress: 1, text: `${m.name} is ready — running on this device.` });
    return engine;
  })();
  LOCAL.loading = { key, promise };
  try { return await promise; } catch (e) { setLocalStatus({ phase: 'error', key, name: m.name, text: e.message || String(e) }); throw e; } finally { if (LOCAL.loading?.promise === promise) LOCAL.loading = null; }
}
async function loadWebLLMEngine(m, wasDownloaded) {
  const webllm = await loadLocalLib('webllm');
  const appConfig = webllm.prebuiltAppConfig;
  if (!appConfig.model_list.some((r) => r.model_id === m.runId)) throw new Error(`${m.name} isn't available in this version of the on-device engine.`);
  const initProgressCallback = (r) => {
    const fetching = /^Fetching/i.test(r.text || ''); // "Fetching param cache[…]" = downloading; "Loading model from cache[…]" = from the device
    setLocalStatus({ phase: fetching ? 'downloading' : 'loading', key: m.key, name: m.name, progress: r.progress || 0, text: fetching ? `Downloading ${m.name} — ${Math.round((r.progress || 0) * 100)}% of about ${fmtMB(m.downloadMB)}` : (wasDownloaded ? 'Loading from this device…' : (r.text || 'Preparing…').replace(/\[.*?\]/g, '').slice(0, 90)) });
  };
  const chatOpts = { context_window_size: LOCAL_CTX };
  let engine;
  try {
    // A worker keeps the page responsive while the model runs.
    const libUrl = await cachedBlobUrl(LOCAL_RT.webllm, 'text/javascript');
    const src = `import * as webllm from ${JSON.stringify(libUrl)};\nconst h = new webllm.WebWorkerMLCEngineHandler();\nself.onmessage = (msg) => h.onmessage(msg);`;
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
    engine = await webllm.CreateWebWorkerMLCEngine(worker, m.runId, { appConfig, initProgressCallback }, chatOpts);
    engine._worker = worker;
  } catch (e) {
    if (/memory|device (was )?lost|out of memory|quota/i.test(e?.message || '')) throw friendlyLocalError(e, m);
    console.warn('[local] worker engine failed, using the main thread', e);
    try { engine = await webllm.CreateMLCEngine(m.runId, { appConfig, initProgressCallback }, chatOpts); } catch (e2) { throw friendlyLocalError(e2, m); }
  }
  return {
    kind: 'webllm', key: m.key, name: m.name, id: m.runId,
    async *chat(messages, { maxTokens, signal }) {
      // A light repetition penalty stops small models looping on the same sentence.
      const req = { messages, stream: true, stream_options: { include_usage: true }, temperature: m.temp ?? 0.6, top_p: 0.9, repetition_penalty: 1.1, max_tokens: maxTokens };
      if (/^Qwen3/i.test(m.runId)) req.extra_body = { enable_thinking: false };
      const onAbort = () => { try { engine.interruptGenerate(); } catch { /* ignore */ } };
      signal?.addEventListener('abort', onAbort);
      try {
        const stream = await engine.chat.completions.create(req);
        for await (const chunk of stream) {
          const d = chunk.choices?.[0]?.delta?.content;
          if (d) yield { delta: d };
          if (chunk.usage) yield { usage: { input: chunk.usage.prompt_tokens || 0, output: chunk.usage.completion_tokens || 0, tps: chunk.usage.extra?.decode_tokens_per_s || null } };
        }
      } finally { signal?.removeEventListener('abort', onAbort); }
    },
    async unload() { try { await engine.unload(); } catch { /* ignore */ } try { engine._worker?.terminate(); } catch { /* ignore */ } },
  };
}
async function loadWllamaEngine(m, wasDownloaded) {
  const lib = await loadLocalLib('wllama');
  const wasm = await cachedBlobUrl(LOCAL_RT.wllamaWasm, 'application/wasm');
  const quiet = { debug() {}, log() {}, warn: (...a) => console.warn('[wllama]', ...a), error: (...a) => console.error('[wllama]', ...a) };
  const w = new lib.Wllama({ default: wasm }, { allowOffline: true, parallelDownloads: 3, logger: quiet, suppressNativeLog: true });
  // Already in this browser's private storage? Then this is a load, not a download (whatever our record says).
  let cached = false;
  try { const b = await w.cacheManager.open(m.gguf.url); cached = !!b && b.size > 0; } catch { /* not cached */ }
  if (!cached && wasDownloaded) console.info('[local] the browser cleared the saved model; downloading it again');
  setLocalStatus({ phase: cached ? 'loading' : 'downloading', key: m.key, name: m.name, progress: 0, text: cached ? 'Loading from this device…' : `Downloading ${m.name}…` });
  try {
    await w.loadModelFromUrl(m.gguf.url, {
      useCache: true, n_ctx: LOCAL_CTX,
      progressCallback: ({ loaded, total }) => {
        const p = total ? loaded / total : 0;
        if (cached) setLocalStatus({ phase: 'loading', key: m.key, name: m.name, progress: p, text: `Loading ${m.name} from this device — ${Math.round(p * 100)}%` });
        else setLocalStatus({ phase: 'downloading', key: m.key, name: m.name, progress: p, text: `Downloading ${m.name} — ${Math.round(p * 100)}% (${fmtMB(loaded / 1048576)} of ${fmtMB((total || m.gguf.mb * 1048576) / 1048576)})` });
        if (p >= 1) setLocalStatus({ phase: 'loading', key: m.key, name: m.name, progress: 1, text: 'Loading into memory…' });
      },
    });
  } catch (e) { throw friendlyLocalError(e, m); }
  return {
    kind: 'wllama', key: m.key, name: m.name, id: m.gguf.url,
    async *chat(messages, { maxTokens, signal }) {
      let n = 0, tFirst = 0, timings = null;
      const iter = await w.createChatCompletion({
        messages, stream: true, max_tokens: maxTokens, temperature: m.temp ?? 0.6, top_p: 0.9, min_p: 0.05, penalty_repeat: 1.1, penalty_last_n: 256, abortSignal: signal,
        cache_prompt: true, // reuse the processed system prompt and history between turns
        ...(/^qwen3/i.test(m.key) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      });
      for await (const chunk of iter) {
        const d = chunk.choices?.[0]?.delta?.content;
        if (d) { if (!tFirst) tFirst = performance.now(); n++; yield { delta: d }; }
        if (chunk.timings) timings = chunk.timings;
      }
      const secs = tFirst ? (performance.now() - tFirst) / 1000 : 0;
      yield { usage: { input: timings?.prompt_n || 0, output: timings?.predicted_n || n, tps: timings?.predicted_per_second || (secs > 0 && n > 1 ? (n - 1) / secs : null) } };
    },
    async unload() { try { await w.exit(); } catch { /* ignore */ } },
    wllama: w,
  };
}
function friendlyLocalError(e, m) {
  const msg = e?.message || String(e);
  if (/out of memory|device (was )?lost|allocation|memory/i.test(msg)) return new Error(`${m.name} ran out of memory on this device. Choose a smaller model in On-device AI.`);
  if (/quota|storage|NoModificationAllowed|disk/i.test(msg)) return new Error(`There isn't enough free storage to keep ${m.name} on this device. Free some space or choose a smaller model.`);
  if (/fetch|network|Failed to load|offline|NetworkError/i.test(msg)) return new Error(`Couldn't download ${m.name} — check your internet connection and try again. (Once downloaded, it works offline.)`);
  return new Error(`${m.name} couldn't start: ${msg}`);
}
async function unloadLocalEngine() { if (LOCAL.engine) { const e = LOCAL.engine; LOCAL.engine = null; await e.unload(); } setLocalStatus({ phase: 'idle' }); }
/** Remove a model's files from this device. */
async function deleteLocalModel(key) {
  const rec = localState().models[key];
  const m = localModel(key); if (!m) return;
  if (LOCAL.engine?.key === key) await unloadLocalEngine();
  const engine = rec?.engine || (await detectLocalDevice()).engine;
  if (engine === 'webllm') {
    const webllm = await loadLocalLib('webllm');
    for (const id of new Set(Object.values(m.webllm))) { try { await webllm.deleteModelAllInfoInCache(id, webllm.prebuiltAppConfig); } catch { /* not cached */ } }
  }
  if (m.gguf) {
    try {
      const lib = await loadLocalLib('wllama');
      const w = new lib.Wllama({ default: await cachedBlobUrl(LOCAL_RT.wllamaWasm, 'application/wasm') }, { logger: { debug() {}, log() {}, warn() {}, error() {} } });
      await w.cacheManager.delete(m.gguf.url);
    } catch { /* not cached */ }
  }
  unmarkLocalDownloaded(key);
}
/** Ask the runtime whether a model is really still on the device (browsers can evict storage). */
async function verifyLocalDownloaded(key) {
  const rec = localState().models[key]; const m = localModel(key); if (!rec || !m) return false;
  try {
    if (rec.engine === 'webllm') { const webllm = await loadLocalLib('webllm'); const ok = await webllm.hasModelInCache(m.webllm[rec.variant] || m.webllm.f16, webllm.prebuiltAppConfig); if (!ok) unmarkLocalDownloaded(key); return ok; }
    if (rec.engine === 'wllama' && m.gguf) { const lib = await loadLocalLib('wllama'); const w = new lib.Wllama({ default: await cachedBlobUrl(LOCAL_RT.wllamaWasm, 'application/wasm') }, { logger: { debug() {}, log() {}, warn() {}, error() {} } }); const b = await w.cacheManager.open(m.gguf.url); const ok = !!b && b.size > 0; if (!ok) unmarkLocalDownloaded(key); return ok; }
  } catch { /* runtime unavailable offline: trust the record */ }
  return true;
}

/* ───────────── Reading attachments for small models (text only) ───────────── */
async function extractPdfText(att, maxPages = 30) {
  const ck = att.blobKey || att.id;
  if (LOCAL.pdfText.has(ck)) return LOCAL.pdfText.get(ck);
  const blob = await getAttachmentBlob(att); if (!blob) return '';
  const pdfjs = await loadLocalLib('pdfjs');
  pdfjs.GlobalWorkerOptions.workerSrc = await cachedBlobUrl(LOCAL_RT.pdfjsWorker, 'text/javascript');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const parts = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    parts.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n').trim());
  }
  const text = parts.join('\n\n').trim() + (doc.numPages > maxPages ? `\n\n[…only the first ${maxPages} of ${doc.numPages} pages were read]` : '');
  try { await doc.destroy(); } catch { /* ignore */ }
  LOCAL.pdfText.set(ck, text);
  return text;
}
async function attachmentTextForLocal(a) {
  try {
    if (a.text) return a.text;
    if (a.kind === 'pdf') return await extractPdfText(a);
  } catch (e) { console.warn('[local] could not read', a.name, e); }
  return '';
}

/* ───────────── One assistant turn on the device ───────────── */
function localSystemPrompt(conv) {
  const name = settings.userName?.trim();
  // Kept short: on a phone or a processor every prompt token costs time.
  const cpu = LOCAL.engine?.kind === 'wllama';
  const profile = (settings.profile || '').trim().slice(0, cpu ? 300 : 600);
  const mem = conv?.memory && conv.memorySnapshot ? `\nSummaries of the teacher's earlier chats (use only if relevant):\n${conv.memorySnapshot.slice(0, cpu ? 600 : 1200)}` : '';
  return `You are Teach Assist, a helpful assistant for a teacher${name ? ` named ${name}` : ''}. Today is ${todayContext(settings.timezone)}.${profile ? `\nAbout the teacher: ${profile}` : ''}
Answer accurately and clearly in Markdown; say so if you are unsure. For teaching resources write the complete content, with an answer key.
You run on the teacher's own device with no internet, so you cannot browse or create files; write documents out in full here. You cannot know the weather, news, prices or anything else live — if asked, say you can't check that from this device.${mem}`;
}
/** Newest-first history that fits the small context window (≈3.5 characters per token). */
async function buildLocalMessages(conv, chain) {
  const budget = Math.floor((LOCAL_CTX - LOCAL_MAX_OUT - 300) * 3.4);
  const system = localSystemPrompt(conv);
  let used = system.length;
  const out = [];
  const msgs = chain.filter((m) => m.role === 'user' || (m.role === 'assistant' && (m.text || '').trim()));
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    let content = m.text || '';
    if (m.role === 'user' && m.attachments?.length) {
      const newest = i === msgs.length - 1;
      const parts = [];
      for (const a of m.attachments) {
        if (a.kind === 'image') { parts.push(`[Image attached: ${a.name} — this on-device model can't see images]`); continue; }
        const t = await attachmentTextForLocal(a);
        if (t) { const cap = newest ? Math.max(1500, budget - used - content.length - 800) : 1200; parts.push(`--- ${a.name} ---\n${t.length > cap ? t.slice(0, cap) + '\n[…truncated to fit the on-device model]' : t}`); }
        else parts.push(`[Attached: ${a.name} — its contents couldn't be read on this device]`);
      }
      content = `${content}\n\n${parts.join('\n\n')}`.trim();
    }
    if (!content) continue;
    if (used + content.length > budget) {
      if (!out.length) { content = content.slice(0, Math.max(500, budget - used)); out.unshift({ role: m.role, content }); }
      break;
    }
    used += content.length;
    out.unshift({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return [{ role: 'system', content: system }, ...out];
}
async function runLocal({ conv, chain, msg, signal, onProgress }) {
  const key = settings.localModel;
  const m = localModel(key);
  if (!m) throw new Error('Choose an on-device model first (Settings → On-device AI).');
  msg.model = `${m.name} · on device`;
  msg.segments = [];
  const loadNote = { type: 'tool', kind: 'other', title: isLocalDownloaded(key) ? `Loading ${m.name} from this device` : `Downloading ${m.name}`, status: 'running', output: '' };
  const needsLoad = LOCAL.engine?.key !== key;
  if (needsLoad) { msg.segments.push(loadNote); onProgress(); }
  const watch = needsLoad ? setInterval(() => { loadNote.output = LOCAL.status.text || ''; loadNote.title = LOCAL.status.phase === 'downloading' ? `Downloading ${m.name} (first time only)` : `Loading ${m.name} from this device`; onProgress(); }, 400) : null;
  let engine;
  try { engine = await ensureLocalEngine(key); }
  finally { if (watch) clearInterval(watch); }
  if (needsLoad) { loadNote.status = 'done'; loadNote.output = `${m.name} ready (${engine.kind === 'webllm' ? 'graphics' : 'processor'} engine)`; }
  if (signal.aborted) return;
  const messages = await buildLocalMessages(conv, chain);
  let text = '', thinking = null, inThink = false, buf = '';
  const textSeg = { type: 'text', text: '', citations: [] };
  msg.segments.push(textSeg);
  const push = (s) => {
    buf += s;
    for (;;) {
      if (!inThink) {
        const i = buf.indexOf('<think>');
        if (i === -1) { const keep = buf.endsWith('<') ? 1 : (buf.match(/<t?h?i?n?k?$/)?.[0].length || 0); text += buf.slice(0, buf.length - keep); buf = buf.slice(buf.length - keep); break; }
        text += buf.slice(0, i); buf = buf.slice(i + 7); inThink = true;
        if (!thinking) { thinking = { type: 'thinking', text: '' }; msg.segments.splice(msg.segments.indexOf(textSeg), 0, thinking); }
      } else {
        const j = buf.indexOf('</think>');
        if (j === -1) { thinking.text += buf; buf = ''; break; }
        thinking.text += buf.slice(0, j); buf = buf.slice(j + 8); inThink = false;
      }
    }
    textSeg.text = text.replace(/^\s+/, '');
    if (thinking && !thinking.text.trim()) { msg.segments.splice(msg.segments.indexOf(thinking), 1); thinking = null; }
  };
  for await (const ev of engine.chat(messages, { maxTokens: Math.min(LOCAL_MAX_OUT, settings.maxTokens || LOCAL_MAX_OUT), signal })) {
    if (ev.delta) { push(ev.delta); onProgress(); }
    if (ev.usage) msg.usage = { input: ev.usage.input, output: ev.usage.output, local: true, tps: ev.usage.tps };
    if (signal.aborted) break;
  }
  if (buf && !inThink) { text += buf; textSeg.text = text.trim(); }
  msg.stopReason = signal.aborted ? 'stopped' : 'end_turn';
}
/** Short non-streaming completion (used by "Prioritise with AI"). */
async function localComplete({ system, prompt, maxTokens = 800 }) {
  const engine = await ensureLocalEngine(settings.localModel);
  let out = '';
  for await (const ev of engine.chat([{ role: 'system', content: system }, { role: 'user', content: prompt }], { maxTokens })) if (ev.delta) out += ev.delta;
  return out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/* ───────────── Choosing a model, the On-device AI sheet and the status strip ───────────── */
function localModelName(key) { return localModel(key)?.name || 'On-device model'; }
/** Offline and a downloaded model is available → that model answers instead of the cloud provider. */
function turnProvider() {
  const p = settings.provider;
  if (p !== 'local' && !navigator.onLine && settings.localWhenOffline !== false && settings.localModel && isLocalDownloaded(settings.localModel)) return 'local';
  return p;
}
/** Select an on-device model; downloads it the first time, otherwise loads it from this device. */
async function useLocalModel(key, { ask = true } = {}) {
  const dev = await detectLocalDevice();
  const m = localCatalog(dev).find((x) => x.key === key); if (!m) return false;
  if (m.fit === 'unavailable') { toast(`${m.name} needs WebGPU, which this browser doesn't have.`); return false; }
  if (!m.downloaded && ask) {
    const warn = [];
    if (m.fit === 'too-big') warn.push(`It needs about ${fmtMB(m.needMB)} of memory, more than this device can comfortably spare — the tab may close or the device may slow down.`);
    if (m.noSpace) warn.push(`This browser reports only ${fmtMB(dev.storageFreeMB)} of free storage.`);
    if (dev.metered || dev.saveData) warn.push('You seem to be on mobile data or data saver — Wi-Fi is better for a download this size.');
    if (!confirm(`Download ${m.name} (about ${fmtMB(m.downloadMB)}) to this device?\n\nIt's downloaded once and kept on this device, so next time it loads straight from storage — even offline.${warn.length ? `\n\n${warn.join('\n')}` : ''}`)) return false;
  }
  saveSettings({ provider: 'local', localModel: key });
  renderModelSelect(); updateComposerState();
  if (/API key|on-device model first/.test($('#bannerHost')?.textContent || '')) $('#bannerHost').innerHTML = '';
  try { await ensureLocalEngine(key); return true; }
  catch (e) { console.warn('[local]', e); return false; }
}
/** Status strip above the message box while a model downloads or loads (and for errors). */
function renderLocalStatus() {
  const st = LOCAL.status;
  const show = st.phase === 'downloading' || st.phase === 'loading' || st.phase === 'error';
  let strip = $('#localStatus');
  if (!strip && show && $('#composerBox')) { strip = el('div', { id: 'localStatus' }); $('#composerBox').before(strip); }
  // Screen readers hear each change of phase (downloading → loading → ready), not every percent.
  if (st.phase !== LOCAL_UI.lastPhase) {
    let live = $('#localLive');
    if (!live) { live = el('div', { id: 'localLive', class: 'sr-only', role: 'status', 'aria-live': 'polite' }); document.body.append(live); }
    live.textContent = st.phase === 'idle' ? '' : st.text || '';
  }
  if (strip) {
    strip.hidden = !show;
    strip.className = `local-strip ${st.phase}`;
    if (show) {
      const pct = Math.round((st.progress || 0) * 100);
      strip.innerHTML = '';
      strip.append(
        el('span', { class: 'ls-ic', html: icon('chip') }),
        el('div', { class: 'ls-main' }, el('div', { class: 'ls-text', text: st.text || '' }),
          st.phase === 'error' ? null : el('div', { class: 'ls-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, el('i', { style: { width: `${st.phase === 'loading' && !st.progress ? 100 : pct}%` }, class: st.phase === 'loading' && !st.progress ? 'indet' : '' }))),
        st.phase === 'error' ? el('button', { class: 'x', html: '×', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => setLocalStatus({ phase: 'idle' }) }) : '');
    }
  }
  LOCAL_UI.repaint?.();
  if (settings.provider === 'local' && $('#hintLabel')) {
    if (st.phase !== LOCAL_UI.lastPhase) renderModelSelect(); // ✓ appears once a model is on the device
    updateComposerState();
  }
  LOCAL_UI.lastPhase = st.phase;
}
const LOCAL_UI = { repaint: null, lastPhase: 'idle' };
const ENGINE_LABEL = { webllm: 'runs on the graphics chip (WebGPU)', wllama: 'runs on the processor' };
async function openLocalAISheet() {
  const body = el('div', { class: 'local-sheet' }, el('div', { class: 'help', text: 'Checking what this device can run…' }));
  openModal('On-device AI', [body], null, { wide: true });
  const dev = await detectLocalDevice();
  let usage = null;
  const refreshUsage = async () => { try { const e = await navigator.storage?.estimate?.(); usage = e?.usage ?? null; dev.persisted = await navigator.storage?.persisted?.(); } catch { /* ignore */ } };
  await refreshUsage();
  const rows = new Map();
  let lastPhase = null;
  const chip = (cls, text) => el('span', { class: `lm-chip ${cls}`, text });
  const row = (m) => {
    const inUse = settings.provider === 'local' && settings.localModel === m.key;
    const busy = LOCAL.loading?.key === m.key;
    const bar = el('i');
    const prog = el('div', { class: 'lm-prog', hidden: !busy }, el('div', { class: 'ls-bar' }, bar), el('div', { class: 'lm-ptext' }));
    const setProg = () => {
      const on = LOCAL.loading?.key === m.key && (LOCAL.status.phase === 'downloading' || LOCAL.status.phase === 'loading');
      prog.hidden = !on; if (!on) return;
      bar.style.width = `${Math.round((LOCAL.status.progress || 0) * 100)}%`;
      prog.lastChild.textContent = LOCAL.status.text || '';
    };
    setProg();
    const actions = el('div', { class: 'lm-actions' });
    if (busy) actions.append(el('button', { class: 'btn sm', disabled: true, text: LOCAL.status.phase === 'downloading' ? 'Downloading…' : 'Loading…' }));
    else if (m.downloaded) {
      actions.append(inUse
        ? el('button', { class: 'btn sm', disabled: true, html: `${svgIcon('check')} In use` })
        : el('button', { class: 'btn sm primary', text: 'Use', onclick: () => useLocalModel(m.key) }));
      actions.append(el('button', { class: 'btn sm ghost danger-txt', text: 'Delete', title: `Remove ${m.name} from this device`, onclick: async () => {
        if (!confirm(`Remove ${m.name} from this device? You can download it again later.`)) return;
        await deleteLocalModel(m.key);
        if (settings.localModel === m.key) saveSettings({ localModel: '' });
        if (settings.provider === 'local' && !settings.localModel) { ensureUsableProvider(); }
        renderModelSelect(); updateComposerState(); await refreshUsage(); paint();
        toast(`${m.name} removed from this device.`);
      } }));
    } else if (m.fit !== 'unavailable') {
      actions.append(el('button', { class: `btn sm${m.recommended ? ' primary' : ''}`, text: `Download & use · ${fmtMB(m.downloadMB)}`, onclick: () => useLocalModel(m.key) }));
    }
    const node = el('div', { class: `lm-row${m.recommended ? ' rec' : ''}${inUse ? ' using' : ''}`, 'data-model': m.key },
      el('div', { class: 'lm-head' }, el('span', { class: 'lm-name', text: m.name }), el('span', { class: 'lm-params', text: m.params }),
        m.recommended ? chip('rec', 'Recommended') : null,
        m.downloaded ? chip('dl', 'On this device') : null,
        chip(`q q-${m.quality.toLowerCase().replace(' ', '-')}`, `Quality: ${m.quality.toLowerCase()}`),
        chip(`fit-${m.fit}`, localFitLabel(m))),
      el('div', { class: 'lm-blurb', text: m.blurb }),
      el('div', { class: 'lm-meta', text: `${m.downloaded ? 'Downloaded — loads from this device' : `Download ≈ ${fmtMB(m.downloadMB)}, once`} · needs ≈ ${fmtMB(m.needMB)} memory · ${ENGINE_LABEL[m.engine]}${m.noSpace && !m.downloaded ? ' · not enough free storage' : ''}` }),
      prog, actions);
    rows.set(m.key, { node, setProg });
    return node;
  };
  const paint = () => {
    lastPhase = LOCAL.status.phase;
    rows.clear();
    const cat = localCatalog(dev);
    const rec = cat.find((m) => m.recommended);
    // The suggestion first, then smallest → largest.
    const fits = cat.filter((m) => m.fit === 'good' || m.fit === 'tight' || m.downloaded).sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
    const big = cat.filter((m) => !fits.includes(m) && m.fit === 'too-big');
    const offline = el('input', { type: 'checkbox' }); offline.checked = settings.localWhenOffline !== false;
    offline.addEventListener('change', () => saveSettings({ localWhenOffline: offline.checked }));
    const cloud = ['anthropic', 'openai'].find((p) => keyFor(p));
    body.innerHTML = '';
    body.append(
      el('div', { class: 'help lm-intro', html: 'On-device models run <b>entirely on this device</b> — free, private (nothing leaves the device) and they keep working <b>offline</b>. Each model downloads <b>once</b>; after that it loads from this device’s storage for every session and prompt. They are <b>far less capable than Claude or OpenAI</b> — fine for short drafts and explanations, but expect mistakes, and no web search, live information (weather, news), file creation or image reading. On-device replies have an <b>Ask Claude/OpenAI</b> button when you have a key.' }),
      el('div', { class: 'm-section lm-device' }, el('h3', { text: 'This device' }),
        el('div', { class: 'lm-dev', html: `${icon('chip')}<span>${escapeHtml(deviceSummary(dev))}</span>` }),
        rec ? el('div', { class: 'lm-recline', html: `Suggested for this device: <b>${escapeHtml(rec.name)}</b> — the most capable model that fits comfortably in its memory.` })
          : el('div', { class: 'lm-recline warn', text: 'This device doesn’t have enough free memory or storage for on-device models. Claude or OpenAI (with an API key) will work much better here.' }),
        dev.engine === 'wllama' ? el('div', { class: 'help', text: 'This browser has no WebGPU, so models run on the processor — slower, and limited to the smaller models. For faster on-device AI use Chrome or Edge on a computer, Chrome on Android, or Safari on iOS / macOS 26 or later.' }) : null,
        (dev.os === 'ios' || dev.os === 'ipados') && dev.engine === 'wllama' ? el('div', { class: 'lm-recline warn', text: 'This browser isn’t giving the app access to the graphics chip, so only small, slower models are offered. For faster and smarter on-device models, open Teach Assist in Safari (iOS 26 or later) — other iPhone browsers may not offer WebGPU yet.' }) : null,
        dev.os === 'ios' ? el('div', { class: 'help', text: 'iPhones limit how much memory one browser tab may use, so the larger models are hidden here even on phones with lots of memory.' }) : null,
        dev.metered || dev.saveData ? el('div', { class: 'help', style: { color: 'var(--amber)' }, text: 'You seem to be on mobile data — downloads are large, so Wi-Fi is best.' }) : null),
      el('div', { class: 'm-section' }, el('h3', { text: 'Models for this device' }),
        ...(fits.length ? fits.map(row) : [el('div', { class: 'help', text: 'None of the models fit on this device.' })]),
        big.length ? el('details', { class: 'lm-more' }, el('summary', { text: `${big.length} larger model${big.length === 1 ? '' : 's'} won’t fit on this device` }), ...big.map(row)) : null),
      el('div', { class: 'm-section' }, el('h3', { text: 'Storage & offline' }),
        el('div', { class: 'help', text: `${usage != null ? `This app is using ${fmtMB(usage / 1048576)} of this browser’s storage (models included). ` : ''}${dev.persisted ? 'Storage is marked persistent, so the browser won’t clear the models to free space.' : 'The browser may clear downloaded models if the device runs very low on space; they would then download again when next used.'}` }),
        el('label', { class: 'check', style: { marginTop: '10px' } }, offline, el('span', {}, 'Use on-device AI automatically when offline', el('span', { class: 'help', text: 'If you lose your connection while using Claude or OpenAI, replies come from your downloaded model instead.' }))),
        settings.provider === 'local' && cloud ? el('button', { class: 'btn sm', style: { marginTop: '8px' }, text: `Switch back to ${providerName(cloud)}`, onclick: async () => { saveSettings({ provider: cloud }); if (!state.models[cloud]?.live) await fetchModels(cloud); renderModelSelect(); updateComposerState(); paint(); } }) : null));
  };
  LOCAL_UI.repaint = () => {
    if (!body.isConnected) { LOCAL_UI.repaint = null; return; }
    if (LOCAL.status.phase !== lastPhase) { refreshUsage().then(paint); lastPhase = LOCAL.status.phase; return; }
    rows.get(LOCAL.status.key)?.setProg();
  };
  paint();
}
/** After a reload: if on-device AI is selected, load it from storage in the background so the first reply is quick. */
async function warmLocalOnBoot() {
  if (settings.provider !== 'local' || !settings.localModel) return;
  if (!isLocalDownloaded(settings.localModel)) return;
  try { await ensureLocalEngine(settings.localModel); } catch (e) { console.warn('[local] warm-up failed', e); }
}
