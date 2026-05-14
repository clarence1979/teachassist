import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Play,
  Square,
  ChevronDown,
  ChevronRight,
  Wrench,
  AlertCircle,
  Activity,
  Copy,
  Check,
} from 'lucide-react';
import { useCredentials } from '../../contexts/CredentialsContext';
import { useAppStore } from '../../store/appStore';
import { llmClient, LLMError } from '../../lib/llm';
import type { StreamChunk, ToolCall, LLMUsage } from '../../lib/llm';
import { PEDAGOGY_TOOLS } from '../../lib/llm';
import type { Provider } from '../../types/credentials';
import { DEFAULT_ANTHROPIC_MODELS, DEFAULT_OPENAI_MODELS } from '../../types/credentials';

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-accent-purple/40 rounded-btn bg-accent-purple/5 text-xs">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        <Wrench size={12} className="text-accent-purple shrink-0" />
        <span className="font-mono text-accent-purple font-semibold">{tc.name}</span>
        <span className="text-text-dim truncate flex-1">
          {Object.entries(tc.arguments)
            .slice(0, 2)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(', ')}
        </span>
        <span className="shrink-0 text-accent-green">✓</span>
        {expanded ? (
          <ChevronDown size={11} className="shrink-0 text-text-dim" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-text-dim" />
        )}
      </button>
      {expanded && (
        <pre className="px-3 pb-2 text-text-secondary overflow-x-auto">
          {JSON.stringify(tc.arguments, null, 2)}
        </pre>
      )}
    </div>
  );
}

function UsageBadge({ usage }: { usage: LLMUsage }) {
  return (
    <div className="flex items-center gap-2 text-xs text-text-dim font-mono mt-2">
      <Activity size={11} />
      <span>
        in: {usage.inputTokens.toLocaleString()} / out: {usage.outputTokens.toLocaleString()}
        {' '}tokens
      </span>
    </div>
  );
}

// ─── Tool preset selector ─────────────────────────────────────────────────────

const NONE = '__none__';

function ToolPresetPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider">
        Attach tools
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-bg-elevated border border-border rounded-btn px-3 py-2 font-mono text-xs text-text-primary focus:border-accent-cyan outline-none"
      >
        <option value={NONE}>None</option>
        <option value="__all__">All Teach Assist tools</option>
        {PEDAGOGY_TOOLS.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Output line ──────────────────────────────────────────────────────────────

type OutputEntry =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; toolCall: ToolCall }
  | { kind: 'usage'; usage: LLMUsage }
  | { kind: 'error'; message: string; status?: number }
  | { kind: 'meta'; text: string };

// ─── Main view ────────────────────────────────────────────────────────────────

export function LlmTestView() {
  const { providers, getKey } = useCredentials();
  const { addUsage } = useAppStore();

  const [provider, setProvider] = useState<Provider>('anthropic');
  const [model, setModel] = useState('claude-sonnet-4-5');
  const [system, setSystem] = useState('You are a helpful assistant.');
  const [prompt, setPrompt] = useState('Say hello and briefly describe what you can do as Teach Assist.');
  const [toolPreset, setToolPreset] = useState(NONE);
  const [streaming, setStreaming] = useState(true);

  const [output, setOutput] = useState<OutputEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(false);

  const availableProviders = providers.map((p) => p.id);
  const modelList =
    provider === 'anthropic'
      ? (providers.find((p) => p.id === 'anthropic')?.availableModels ?? DEFAULT_ANTHROPIC_MODELS)
      : (providers.find((p) => p.id === 'openai')?.availableModels ?? DEFAULT_OPENAI_MODELS);

  const handleProviderChange = (p: Provider) => {
    setProvider(p);
    setModel(
      p === 'anthropic' ? DEFAULT_ANTHROPIC_MODELS[0] : DEFAULT_OPENAI_MODELS[0],
    );
  };

  const resolveTools = () => {
    if (toolPreset === NONE) return undefined;
    if (toolPreset === '__all__') return PEDAGOGY_TOOLS;
    return PEDAGOGY_TOOLS.filter((t) => t.name === toolPreset);
  };

  const handleRun = async () => {
    const apiKey = getKey(provider);
    if (!apiKey) {
      setOutput([{ kind: 'error', message: `No API key for ${provider}. Go to Settings to add one.` }]);
      return;
    }

    setOutput([{ kind: 'meta', text: `→ ${provider} / ${model} ${streaming ? '(stream)' : '(non-stream)'}` }]);
    setRunning(true);
    abortRef.current = false;

    const chunks: OutputEntry[] = [{ kind: 'meta', text: `→ ${provider} / ${model} ${streaming ? '(stream)' : '(non-stream)'}` }];

    const onChunk = (chunk: StreamChunk) => {
      if (abortRef.current) return;
      if (chunk.type === 'text') {
        // Append to last text entry or create new one
        setOutput((prev) => {
          const last = prev[prev.length - 1];
          if (last?.kind === 'text') {
            return [...prev.slice(0, -1), { kind: 'text', text: last.text + chunk.delta }];
          }
          return [...prev, { kind: 'text', text: chunk.delta }];
        });
      } else if (chunk.type === 'tool_call') {
        setOutput((prev) => [...prev, { kind: 'tool', toolCall: chunk.toolCall }]);
      } else if (chunk.type === 'usage') {
        setOutput((prev) => [...prev, { kind: 'usage', usage: chunk.usage }]);
        addUsage(provider, chunk.usage.inputTokens, chunk.usage.outputTokens);
      } else if (chunk.type === 'error') {
        setOutput((prev) => [...prev, { kind: 'error', message: chunk.message, status: chunk.status }]);
      }
    };

    try {
      const req = {
        provider,
        model,
        apiKey,
        messages: [{ role: 'user' as const, content: prompt }],
        system: system || undefined,
        tools: resolveTools(),
        maxTokens: 1024,
      };

      if (streaming) {
        await llmClient.complete(req, onChunk);
      } else {
        const res = await llmClient.complete(req);
        if (res.text) onChunk({ type: 'text', delta: res.text });
        for (const tc of res.toolCalls) onChunk({ type: 'tool_call', toolCall: tc });
        onChunk({ type: 'usage', usage: res.usage });
      }
    } catch (err) {
      const msg =
        err instanceof LLMError
          ? `${err.message} (HTTP ${err.status})`
          : String(err);
      setOutput((prev) => [...prev, { kind: 'error', message: msg }]);
    } finally {
      setRunning(false);
    }
    void chunks;
  };

  const handleStop = () => { abortRef.current = true; setRunning(false); };

  const handleCopy = () => {
    const text = output
      .map((e) => {
        if (e.kind === 'text') return e.text;
        if (e.kind === 'tool') return `[tool: ${e.toolCall.name}] ${JSON.stringify(e.toolCall.arguments)}`;
        if (e.kind === 'usage') return `[usage: in=${e.usage.inputTokens} out=${e.usage.outputTokens}]`;
        if (e.kind === 'error') return `[error: ${e.message}]`;
        return e.text;
      })
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const hasKey = !!getKey(provider);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg-base">
      {/* Dev banner */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-accent-amber/10 border-b border-accent-amber/30 shrink-0">
        <span className="text-xs font-mono text-accent-amber">DEV</span>
        <span className="text-xs text-text-dim">LLM Client Test — not visible in production</span>
      </div>

      <div className="flex flex-1 min-h-0 gap-0">
        {/* ── Left: controls ──────────────────────────────────────── */}
        <div className="w-72 shrink-0 border-r border-border bg-bg-panel flex flex-col overflow-y-auto p-4 gap-4">
          <h2 className="font-orbitron text-sm font-bold text-text-primary">LLM Test</h2>

          {/* Provider */}
          <div className="space-y-1">
            <label className="text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider">
              Provider
            </label>
            <div className="flex gap-2">
              {(['anthropic', 'openai'] as Provider[]).map((p) => {
                const avail = availableProviders.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => avail && handleProviderChange(p)}
                    disabled={!avail}
                    className={clsx(
                      'flex-1 py-1.5 rounded-btn border text-xs font-rajdhani font-semibold transition-colors',
                      p === provider
                        ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/10'
                        : avail
                        ? 'border-border text-text-secondary hover:border-accent-cyan'
                        : 'border-border text-text-dim opacity-40 cursor-not-allowed',
                    )}
                  >
                    {p === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                    {!avail && <span className="ml-1 text-accent-red">✗</span>}
                  </button>
                );
              })}
            </div>
            {!hasKey && (
              <p className="text-xs text-accent-amber mt-1">
                No key for {provider} — go to Settings.
              </p>
            )}
          </div>

          {/* Model */}
          <div className="space-y-1">
            <label className="text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider">
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded-btn px-3 py-2 font-mono text-xs text-text-primary focus:border-accent-cyan outline-none"
            >
              {modelList.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* System */}
          <div className="space-y-1">
            <label className="text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider">
              System prompt
            </label>
            <textarea
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              rows={3}
              className="w-full bg-bg-elevated border border-border rounded-btn px-3 py-2 font-inter text-xs text-text-primary focus:border-accent-cyan outline-none resize-y caret-accent-cyan"
            />
          </div>

          {/* Tools */}
          <ToolPresetPicker value={toolPreset} onChange={setToolPreset} />

          {/* Streaming toggle */}
          <div className="flex items-center gap-2">
            <button
              role="switch"
              aria-checked={streaming}
              onClick={() => setStreaming((s) => !s)}
              className={clsx(
                'relative w-9 h-5 rounded-full border transition-colors',
                streaming ? 'bg-accent-cyan/20 border-accent-cyan' : 'bg-bg-elevated border-border',
              )}
            >
              <span
                className={clsx(
                  'absolute top-0.5 w-4 h-4 rounded-full transition-transform',
                  streaming ? 'translate-x-4 bg-accent-cyan' : 'translate-x-0.5 bg-text-dim',
                )}
              />
            </button>
            <span className="text-xs text-text-secondary">Streaming SSE</span>
          </div>

          {/* Run / Stop */}
          <button
            onClick={running ? handleStop : handleRun}
            disabled={!hasKey}
            className={clsx(
              'flex items-center justify-center gap-2 py-2 rounded-btn border',
              'font-rajdhani font-semibold text-sm transition-colors',
              running
                ? 'border-accent-red text-accent-red hover:bg-accent-red/10'
                : hasKey
                ? 'border-accent-cyan text-accent-cyan hover:bg-accent-cyan/10'
                : 'border-border text-text-dim opacity-40 cursor-not-allowed',
            )}
          >
            {running ? (
              <><Square size={13} /> Stop</>
            ) : (
              <><Play size={13} /> Run</>
            )}
          </button>
        </div>

        {/* ── Right: prompt + output ───────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Prompt */}
          <div className="border-b border-border p-4 shrink-0">
            <label className="block text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider mb-1">
              User message
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full bg-bg-elevated border border-border rounded-btn px-3 py-2 font-inter text-sm text-text-primary focus:border-accent-cyan outline-none resize-y caret-accent-cyan"
              placeholder="Enter a prompt…"
            />
          </div>

          {/* Output */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
              <span className="text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider">
                Output
              </span>
              <div className="flex items-center gap-2">
                {running && (
                  <span className="flex items-center gap-1 text-xs text-accent-cyan font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
                    streaming
                  </span>
                )}
                {output.length > 0 && (
                  <button
                    onClick={handleCopy}
                    aria-label="Copy output"
                    className="p-1 rounded-btn text-text-dim hover:text-accent-cyan transition-colors"
                  >
                    {copied ? <Check size={13} className="text-accent-green" /> : <Copy size={13} />}
                  </button>
                )}
                {output.length > 0 && !running && (
                  <button
                    onClick={() => setOutput([])}
                    className="text-xs text-text-dim hover:text-accent-red transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 font-inter text-sm">
              {output.length === 0 && (
                <p className="text-text-dim text-xs font-mono">Output will appear here…</p>
              )}

              {output.map((entry, i) => {
                if (entry.kind === 'meta') {
                  return (
                    <p key={i} className="text-xs font-mono text-text-dim">
                      {entry.text}
                    </p>
                  );
                }
                if (entry.kind === 'text') {
                  return (
                    <p key={i} className="text-text-primary whitespace-pre-wrap leading-relaxed">
                      {entry.text}
                    </p>
                  );
                }
                if (entry.kind === 'tool') {
                  return <ToolCallCard key={i} tc={entry.toolCall} />;
                }
                if (entry.kind === 'usage') {
                  return <UsageBadge key={i} usage={entry.usage} />;
                }
                if (entry.kind === 'error') {
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/40 rounded-btn text-xs"
                    >
                      <AlertCircle size={13} className="text-accent-red mt-0.5 shrink-0" />
                      <span className="text-accent-red font-mono">
                        {entry.status && <span className="font-bold">HTTP {entry.status}: </span>}
                        {entry.message}
                      </span>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
