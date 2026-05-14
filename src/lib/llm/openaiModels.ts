/**
 * Fetches the live list of available OpenAI models for the given API key,
 * then categorises them into chat models and image models.
 *
 * Results are cached in memory per API key for the session lifetime so we
 * only hit /v1/models once per key.
 */

export interface OpenAIModelCatalog {
  chatModels: string[];
  imageModel: string;
}

// In-memory cache: apiKey → catalog
const cache = new Map<string, OpenAIModelCatalog>();

// Models we prefer in order — latest / most capable first.
// The fetcher will keep only IDs that actually appear in the API response.
const PREFERRED_CHAT_MODELS = [
  'o3',
  'o3-mini',
  'o4-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
  'o1',
  'o1-mini',
  'o1-preview',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
];

// Image generation model preference order
const PREFERRED_IMAGE_MODELS = [
  'gpt-image-1',
  'dall-e-3',
  'dall-e-2',
];

// IDs that match "chat-capable" if they aren't in PREFERRED_CHAT_MODELS
function isChatModel(id: string): boolean {
  return (
    id.startsWith('gpt-') ||
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4') ||
    id === 'chatgpt-4o-latest'
  );
}

function isImageModel(id: string): boolean {
  return id.startsWith('dall-e') || id === 'gpt-image-1';
}

export async function fetchOpenAIModelCatalog(apiKey: string): Promise<OpenAIModelCatalog> {
  if (cache.has(apiKey)) return cache.get(apiKey)!;

  let allIds: string[] = [];
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const data = await res.json();
      allIds = (data.data as { id: string }[]).map((m) => m.id);
    }
  } catch {
    // Network failure — fall through to static defaults
  }

  const idSet = new Set(allIds);

  // Chat models: preferred order, then any other chat-capable models sorted alpha
  const chatModels: string[] = [];
  for (const id of PREFERRED_CHAT_MODELS) {
    if (idSet.has(id)) chatModels.push(id);
  }
  // Pick up any chat-capable models not in the preferred list
  for (const id of allIds) {
    if (!chatModels.includes(id) && isChatModel(id) && !isImageModel(id)) {
      chatModels.push(id);
    }
  }

  // Fall back to a sensible static list if the fetch produced nothing useful
  if (chatModels.length === 0) {
    chatModels.push('gpt-4o', 'gpt-4o-mini');
  }

  // Image model: pick the first preferred one that the account can access
  let imageModel = 'dall-e-3';
  for (const id of PREFERRED_IMAGE_MODELS) {
    if (idSet.has(id)) {
      imageModel = id;
      break;
    }
  }
  // If the fetch failed entirely, default to dall-e-3 (universally available)

  const catalog: OpenAIModelCatalog = { chatModels, imageModel };
  cache.set(apiKey, catalog);
  return catalog;
}

/** Invalidate the cached catalog for a given key (e.g. when the key changes). */
export function invalidateOpenAIModelCache(apiKey: string) {
  cache.delete(apiKey);
}

/** Returns the best available image model, falling back to dall-e-3 if catalog not yet loaded. */
export function getBestImageModel(catalog: OpenAIModelCatalog | null): string {
  return catalog?.imageModel ?? 'dall-e-3';
}
