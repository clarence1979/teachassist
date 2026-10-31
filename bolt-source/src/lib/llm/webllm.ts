import { CreateMLCEngine, hasModelInCache, type MLCEngine, type InitProgressReport, type ChatCompletionMessageParam } from '@mlc-ai/web-llm';

export interface OfflineModelDef {
  id: string;
  label: string;
  webllmId: string;
  approxSize: string;
}

export const OFFLINE_MODELS: OfflineModelDef[] = [
  {
    id: 'llama-3.2-1b',
    label: 'Llama 3.2 · 1B Instruct',
    webllmId: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    approxSize: '~700 MB',
  },
  {
    id: 'llama-3.2-3b',
    label: 'Llama 3.2 · 3B Instruct',
    webllmId: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
    approxSize: '~1.8 GB',
  },
];

export function getOfflineModel(id: string): OfflineModelDef | undefined {
  return OFFLINE_MODELS.find((m) => m.id === id);
}

const engineCache = new Map<string, MLCEngine>();

export async function isModelCached(id: string): Promise<boolean> {
  const m = getOfflineModel(id);
  if (!m) return false;
  try {
    return await hasModelInCache(m.webllmId);
  } catch {
    return false;
  }
}

export async function hasWebGPU(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
  if (!nav.gpu) return false;
  try {
    const adapter = await nav.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

export async function loadOfflineEngine(
  id: string,
  onProgress?: (report: InitProgressReport) => void,
): Promise<MLCEngine> {
  const m = getOfflineModel(id);
  if (!m) throw new Error(`Unknown offline model: ${id}`);
  const cached = engineCache.get(m.webllmId);
  if (cached) return cached;

  const engine = await CreateMLCEngine(m.webllmId, {
    initProgressCallback: (report) => onProgress?.(report),
  });
  engineCache.set(m.webllmId, engine);
  return engine;
}

export async function offlineStream(
  modelId: string,
  messages: ChatCompletionMessageParam[],
  onText: (delta: string) => void,
  onUsage?: (inputTokens: number, outputTokens: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const engine = await loadOfflineEngine(modelId);
  const stream = await engine.chat.completions.create({
    messages,
    stream: true,
    stream_options: { include_usage: true },
  });

  let full = '';
  for await (const chunk of stream) {
    if (signal?.aborted) {
      try { await engine.interruptGenerate(); } catch { /* ignore */ }
      break;
    }
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      onText(delta);
    }
    if (chunk.usage && onUsage) {
      onUsage(chunk.usage.prompt_tokens ?? 0, chunk.usage.completion_tokens ?? 0);
    }
  }
  return full;
}
