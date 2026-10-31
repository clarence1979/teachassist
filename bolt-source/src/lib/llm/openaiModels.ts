/**
 * Fetches the live list of OpenAI models for an API key and splits them into
 * chat models (newest release first) and the best image model.
 */

export interface OpenAIModelCatalog {
  chatModels: string[];
  /** Newest general-purpose chat model — the default selection. */
  latestModel: string;
  /** False when the provider couldn't be reached and a built-in list is shown. */
  isLive: boolean;
  imageModel: string;
}

const cache = new Map<string, OpenAIModelCatalog>();

const FALLBACK_CHAT_MODELS = ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini'];

const PREFERRED_IMAGE_MODELS = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'];

// Variants that don't work with the chat completions API the app uses.
const EXCLUDED_FRAGMENTS = [
  'audio', 'realtime', 'transcribe', 'tts', 'search', 'image', 'embedding',
  'moderation', 'instruct', 'codex', 'deep-research', 'computer-use', '-pro',
  'oss', 'chat-latest',
];

const DATED_SNAPSHOT = /-\d{4}-\d{2}-\d{2}$|-\d{4}$/;
const SMALL_TIER = /-(mini|nano)\b/;

function isChatModel(id: string): boolean {
  const chatFamily = id.startsWith('gpt-') || /^o\d/.test(id);
  return chatFamily && !EXCLUDED_FRAGMENTS.some((f) => id.includes(f));
}

export async function fetchOpenAIModelCatalog(apiKey: string): Promise<OpenAIModelCatalog> {
  const cached = cache.get(apiKey);
  if (cached) return cached;

  let live: { id: string; created: number }[] = [];
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.data)) {
        live = (data.data as { id?: unknown; created?: unknown }[])
          .filter((m) => typeof m.id === 'string')
          .map((m) => ({ id: m.id as string, created: typeof m.created === 'number' ? m.created : 0 }));
      }
    } else {
      console.warn(`[ModelFetch] OpenAI /v1/models returned ${res.status}`);
    }
  } catch (err) {
    console.warn('[ModelFetch] Failed to fetch OpenAI models:', err);
  }

  const ids = new Set(live.map((m) => m.id));
  // Hide dated snapshots when their undated alias is also available.
  const chat = live
    .filter((m) => isChatModel(m.id))
    .filter((m) => !(DATED_SNAPSHOT.test(m.id) && ids.has(m.id.replace(DATED_SNAPSHOT, ''))))
    .sort((a, b) => b.created - a.created || b.id.localeCompare(a.id))
    .map((m) => m.id);

  const chatModels = chat.length > 0 ? chat : FALLBACK_CHAT_MODELS;
  const latestModel = chatModels.find((id) => !SMALL_TIER.test(id)) ?? chatModels[0];

  const imageModel =
    PREFERRED_IMAGE_MODELS.find((id) => ids.has(id)) ??
    live.filter((m) => m.id.startsWith('gpt-image-')).sort((a, b) => b.created - a.created)[0]?.id ??
    'gpt-image-1';

  const catalog: OpenAIModelCatalog = { chatModels, latestModel, imageModel, isLive: live.length > 0 };
  if (live.length > 0) cache.set(apiKey, catalog);
  return catalog;
}

export function invalidateOpenAIModelCache(apiKey: string) {
  cache.delete(apiKey);
}

export function getBestImageModel(catalog: OpenAIModelCatalog | null): string {
  return catalog?.imageModel ?? 'gpt-image-1';
}
