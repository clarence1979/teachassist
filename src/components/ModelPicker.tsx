import React, { useRef, useState, useEffect } from 'react';
import { ChevronDown, Cpu, Activity, RefreshCw, Lock, Brain, Download, AlertTriangle, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../contexts/CredentialsContext';
import { useAppStore } from '../store/appStore';
import type { Provider } from '../types/credentials';
import { DEFAULT_ANTHROPIC_MODELS, DEFAULT_OPENAI_MODELS } from '../types/credentials';
import { fetchOpenAIModelCatalog, invalidateOpenAIModelCache, type OpenAIModelCatalog } from '../lib/llm/openaiModels';
import { fetchAnthropicModelCatalog, invalidateAnthropicModelCache, type AnthropicModelCatalog } from '../lib/llm/anthropicModels';
import { OFFLINE_MODELS as WEBLLM_MODELS, isModelCached, loadOfflineEngine, hasWebGPU } from '../lib/llm/webllm';

type Tab = Provider | 'offline';

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

const TAB_LABELS: Record<Tab, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  offline: 'Offline',
};

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ModelPicker({ compact = false }: { compact?: boolean }) {
  const { providers } = useCredentials();
  const {
    activeProvider, setActiveProvider,
    activeModel, setActiveModel,
    offlineModelId, setOfflineModelId,
    sessionUsage,
  } = useAppStore();

  const [open, setOpen] = useState(false);
  const [openaiCatalog, setOpenaiCatalog] = useState<OpenAIModelCatalog | null>(null);
  const [anthropicCatalog, setAnthropicCatalog] = useState<AnthropicModelCatalog | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const isOfflineActive = !!offlineModelId;
  const [activeTab, setActiveTab] = useState<Tab>(isOfflineActive ? 'offline' : activeProvider);
  const ref = useRef<HTMLDivElement>(null);
  const defaultAppliedFor = useRef(new Set<Provider>());

  useEffect(() => {
    setActiveTab(isOfflineActive ? 'offline' : activeProvider);
  }, [activeProvider, isOfflineActive]);

  const availableProviders = providers.map((p) => p.id);
  const hasProvider = (id: Provider) => availableProviders.includes(id);

  const openaiKey = providers.find((p) => p.id === 'openai')?.apiKey;
  const anthropicKey = providers.find((p) => p.id === 'anthropic')?.apiKey;

  useEffect(() => {
    if (!openaiKey) { setOpenaiCatalog(null); return; }
    let cancelled = false;
    setFetchingModels(true);
    invalidateOpenAIModelCache(openaiKey);
    fetchOpenAIModelCatalog(openaiKey)
      .then((catalog) => { if (!cancelled) setOpenaiCatalog(catalog); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setFetchingModels(false); });
    return () => { cancelled = true; };
  }, [openaiKey]);

  useEffect(() => {
    if (!anthropicKey) { setAnthropicCatalog(null); return; }
    let cancelled = false;
    setFetchingModels(true);
    invalidateAnthropicModelCache(anthropicKey);
    fetchAnthropicModelCatalog(anthropicKey)
      .then((catalog) => { if (!cancelled) setAnthropicCatalog(catalog); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setFetchingModels(false); });
    return () => { cancelled = true; };
  }, [anthropicKey]);

  const catalogFor = (id: Provider) => (id === 'openai' ? openaiCatalog : anthropicCatalog);

  // Once per app load and provider, switch to the newest model the account can use.
  useEffect(() => {
    if (offlineModelId || defaultAppliedFor.current.has(activeProvider)) return;
    const catalog = catalogFor(activeProvider);
    if (!catalog) return;
    defaultAppliedFor.current.add(activeProvider);
    if (catalog.isLive || !catalog.chatModels.includes(activeModel)) {
      setActiveModel(catalog.latestModel);
    }
  }, [openaiCatalog, anthropicCatalog, activeProvider, offlineModelId]);

  const currentProviderCred = providers.find((p) => p.id === activeProvider);

  const modelList: string[] =
    catalogFor(activeProvider)?.chatModels ??
    currentProviderCred?.availableModels ??
    (activeProvider === 'openai' ? DEFAULT_OPENAI_MODELS : DEFAULT_ANTHROPIC_MODELS);

  const usage = sessionUsage[activeProvider];
  const totalTokens = usage.inputTokens + usage.outputTokens;

  const handleProviderSelect = (id: Provider) => {
    setActiveProvider(id);
    setOfflineModelId(null);
    const cred = providers.find((p) => p.id === id);
    const catalog = catalogFor(id);
    const fallback = cred?.availableModels ?? (id === 'openai' ? DEFAULT_OPENAI_MODELS : DEFAULT_ANTHROPIC_MODELS);
    setActiveModel(catalog?.latestModel ?? cred?.defaultModel ?? fallback[0]);
    setOpen(false);
  };

  const handleOfflineSelect = (id: string, label: string) => {
    setOfflineModelId(id);
    setActiveModel(label);
    setOpen(false);
  };

  const handleRefreshModels = (e: React.MouseEvent) => {
    e.stopPropagation();
    const key = activeProvider === 'openai' ? openaiKey : anthropicKey;
    if (!key) return;
    setFetchingModels(true);
    const request = activeProvider === 'openai'
      ? (invalidateOpenAIModelCache(key), fetchOpenAIModelCatalog(key).then(setOpenaiCatalog))
      : (invalidateAnthropicModelCache(key), fetchAnthropicModelCatalog(key).then(setAnthropicCatalog));
    request.catch(() => {}).finally(() => setFetchingModels(false));
  };

  const handleModelSelect = (model: string) => {
    setActiveModel(model);
    setOfflineModelId(null);
    setOpen(false);
  };

  // Close on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Model picker"
        className={clsx(
          'flex items-center gap-1.5 rounded-btn w-full min-w-0',
          compact ? 'px-2 py-1' : 'px-3 py-1.5',
          'border border-border bg-bg-elevated',
          'font-mono text-xs text-text-secondary',
          'hover:border-accent-cyan hover:text-text-primary transition-colors',
          open && 'border-accent-cyan text-text-primary'
        )}
      >
        <Cpu size={compact ? 11 : 13} className={clsx('shrink-0', isOfflineActive ? 'text-accent-green' : 'text-accent-cyan')} />
        <span className={clsx('truncate min-w-0', compact ? 'max-w-[72px] text-[10px]' : 'max-w-36')}>
          {compact
            ? activeModel.split('-').slice(-1)[0] // e.g. "sonnet-4-5" → "4-5", short name
            : isOfflineActive ? `Offline · ${activeModel}` : activeModel}
        </span>
        <ChevronDown size={compact ? 10 : 12} className={clsx('transition-transform shrink-0', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className={clsx(
            'absolute right-0 top-full mt-1 z-50',
            compact ? 'w-64' : 'w-72',
            'bg-bg-elevated border border-border rounded shadow-xl',
            // On compact mobile ensure it doesn't overflow right edge
            compact && 'max-w-[calc(100vw-24px)]',
          )}
          role="dialog"
          aria-label="Model selection"
        >
          {/* Provider tabs */}
          <div className="flex border-b border-border">
            {(['anthropic', 'openai', 'offline'] as Tab[]).map((id) => {
              const isProvider = id !== 'offline';
              const active = id === activeTab;
              const available = !isProvider || hasProvider(id as Provider);
              return (
                <button
                  key={id}
                  onClick={() => {
                    if (!available) return;
                    if (isProvider) handleProviderSelect(id as Provider);
                    else setActiveTab('offline');
                  }}
                  disabled={!available}
                  className={clsx(
                    'flex-1 py-2 text-xs font-rajdhani font-semibold transition-colors',
                    active
                      ? 'text-accent-cyan border-b-2 border-accent-cyan'
                      : available
                      ? 'text-text-secondary hover:text-text-primary'
                      : 'text-text-dim cursor-not-allowed opacity-40'
                  )}
                >
                  {TAB_LABELS[id]}
                  {isProvider && !available && ' (no key)'}
                </button>
              );
            })}
          </div>

          {activeTab === 'offline' ? (
            <OfflinePanel
              selectedId={offlineModelId}
              onSelect={handleOfflineSelect}
            />
          ) : (<>
          {/* Model list header */}
          <div className="flex items-center justify-between px-3 pt-2 pb-1">
            <span className="text-[10px] font-mono text-text-dim uppercase tracking-wider">
              {catalogFor(activeProvider)?.isLive ? 'Live models' : 'Models'}
            </span>
            {((activeProvider === 'openai' && openaiKey) ||
              (activeProvider === 'anthropic' && anthropicKey)) && (
              <button
                onClick={handleRefreshModels}
                disabled={fetchingModels}
                title="Refresh model list"
                className="p-0.5 rounded text-text-dim hover:text-accent-cyan transition-colors disabled:opacity-40"
              >
                <RefreshCw size={10} className={clsx(fetchingModels && 'animate-spin')} />
              </button>
            )}
          </div>

          {/* Model list */}
          <ul role="listbox" className="py-1 max-h-56 overflow-y-auto">
            {fetchingModels && !catalogFor(activeProvider) && (
              <li className="px-3 py-2 text-xs font-mono text-text-dim italic">Loading models…</li>
            )}
            {modelList.map((model) => (
              <li key={model}>
                <button
                  role="option"
                  aria-selected={model === activeModel}
                  onClick={() => handleModelSelect(model)}
                  className={clsx(
                    'w-full text-left px-3 py-2 text-xs font-mono transition-colors',
                    model === activeModel
                      ? 'text-accent-cyan bg-bg-panel'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-panel'
                  )}
                >
                  {model}
                  {catalogFor(activeProvider)?.isLive && model === catalogFor(activeProvider)?.latestModel && (
                    <span className="ml-2 px-1.5 py-px rounded border border-accent-cyan/40 text-[9px] uppercase tracking-wider text-accent-cyan">
                      Latest
                    </span>
                  )}
                  {model === activeModel && (
                    <span className="float-right text-accent-cyan">✓</span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/* Token usage */}
          {totalTokens > 0 && (
            <div className="border-t border-border px-3 py-2 flex items-center gap-2 text-xs text-text-dim">
              <Activity size={11} />
              <span>
                Session: {formatTokens(usage.inputTokens)} in /{' '}
                {formatTokens(usage.outputTokens)} out
              </span>
            </div>
          )}
          </>)}
        </div>
      )}
    </div>
  );
}

// ─── Offline panel ──────────────────────────────────────────────────────────

type ModelStatus = 'unchecked' | 'idle' | 'loading' | 'ready' | 'error';

function OfflinePanel({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string, label: string) => void;
}) {
  const [statuses, setStatuses] = useState<Record<string, ModelStatus>>({});
  const [progress, setProgress] = useState<Record<string, { pct: number; text: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [webgpuOk, setWebgpuOk] = useState<boolean | null>(null);

  useEffect(() => {
    hasWebGPU().then(setWebgpuOk);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, ModelStatus> = {};
      for (const m of WEBLLM_MODELS) {
        const cached = await isModelCached(m.id);
        next[m.id] = cached ? 'ready' : 'idle';
      }
      if (!cancelled) setStatuses(next);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLoad = async (modelId: string) => {
    setStatuses((s) => ({ ...s, [modelId]: 'loading' }));
    setErrors((e) => ({ ...e, [modelId]: '' }));
    try {
      await loadOfflineEngine(modelId, (report) => {
        setProgress((p) => ({
          ...p,
          [modelId]: { pct: Math.round((report.progress ?? 0) * 100), text: report.text ?? '' },
        }));
      });
      setStatuses((s) => ({ ...s, [modelId]: 'ready' }));
      setProgress((p) => ({ ...p, [modelId]: { pct: 100, text: 'Ready' } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatuses((s) => ({ ...s, [modelId]: 'error' }));
      setErrors((e) => ({ ...e, [modelId]: message }));
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-accent-green/40 bg-accent-green/5 text-accent-green text-[10px] font-mono tracking-wider">
          <Lock size={10} />
          On-device AI · runs via WebGPU in your browser · no API credits used
        </div>
      </div>

      {webgpuOk === false && (
        <div className="flex items-start gap-2 rounded-btn border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-[11px] text-accent-red">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            WebGPU isn't available in this browser. Offline models require a recent Chrome, Edge, or
            Safari Tech Preview with WebGPU enabled.
          </span>
        </div>
      )}

      <div className="space-y-2">
        {WEBLLM_MODELS.map((m) => {
          const status = statuses[m.id] ?? 'unchecked';
          const isSelected = selectedId === m.id;
          const prog = progress[m.id];
          const err = errors[m.id];
          const ready = status === 'ready';
          const loading = status === 'loading';

          return (
            <div
              key={m.id}
              className={clsx(
                'rounded-btn border p-3 transition-colors',
                isSelected
                  ? 'border-accent-green bg-accent-green/10'
                  : 'border-border bg-bg-panel',
              )}
            >
              <div className="flex items-start gap-2">
                <Brain size={14} className={clsx('mt-0.5 shrink-0', isSelected ? 'text-accent-green' : 'text-accent-cyan')} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-text-primary truncate">{m.label}</span>
                    {isSelected && (
                      <span className="text-[9px] font-mono text-accent-green tracking-wider">ACTIVE</span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-accent-amber">{m.approxSize} · one-time download</div>
                </div>
              </div>

              {loading && (
                <div className="mt-2 space-y-1">
                  <div className="h-0.5 rounded-full bg-bg-elevated overflow-hidden">
                    <div className="h-full bg-accent-cyan transition-all" style={{ width: `${prog?.pct ?? 0}%` }} />
                  </div>
                  <div className="text-[10px] font-mono text-text-dim truncate">
                    {prog?.text || `Loading ${prog?.pct ?? 0}%`}
                  </div>
                </div>
              )}

              {err && (
                <div className="mt-2 text-[10px] font-mono text-accent-red break-words">{err}</div>
              )}

              <div className="mt-2 flex gap-2">
                {!ready && (
                  <button
                    type="button"
                    onClick={() => handleLoad(m.id)}
                    disabled={loading || webgpuOk === false}
                    className={clsx(
                      'flex-1 py-1.5 rounded-btn text-[11px] font-rajdhani font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all',
                      loading
                        ? 'bg-bg-elevated border border-border text-text-dim cursor-wait'
                        : webgpuOk === false
                        ? 'bg-bg-elevated border border-border text-text-dim opacity-50 cursor-not-allowed'
                        : 'bg-accent-amber text-bg-base hover:brightness-110',
                    )}
                  >
                    {loading ? (
                      <><RefreshCw size={11} className="animate-spin" /> Loading</>
                    ) : (
                      <><Download size={11} /> Download & load</>
                    )}
                  </button>
                )}
                {ready && (
                  <button
                    type="button"
                    onClick={() => onSelect(m.id, m.label)}
                    className={clsx(
                      'flex-1 py-1.5 rounded-btn text-[11px] font-rajdhani font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all',
                      isSelected
                        ? 'bg-accent-green/20 border border-accent-green/50 text-accent-green'
                        : 'bg-accent-cyan text-bg-base hover:brightness-110',
                    )}
                  >
                    {isSelected ? <><Check size={11} /> Selected</> : <>Use this model</>}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] font-mono text-text-dim leading-relaxed text-center px-2">
        Models run entirely in your browser. After the first download they're cached and fully offline.
      </p>
    </div>
  );
}
