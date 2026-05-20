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

// In-memory cache: apiKey → catalog. Keyed by a version stamp so stale cached
// catalogs from a previous build are automatically discarded on page reload.
const CACHE_VERSION = '3';
const cache = new Map<string, OpenAIModelCatalog>();

function cacheKey(apiKey: string): string {
  return `${CACHE_VERSION}:${apiKey}`;
}

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

// Image generation model preference order — latest first
const PREFERRED_IMAGE_MODELS = [
  'gpt-image-2',
  'gpt-image-1',
  'dall-e-3',
  'dall-e-2',
];

// IDs that match "chat-capable"
function isChatModel(id: string): boolean {
  return (
    id.startsWith('gpt-') ||
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4') ||
    id.startsWith('o5') ||
    id === 'chatgpt-4o-latest'
  );
}

// Sort unlisted chat models: newer versions first, then alpha
function sortUnlistedChatModels(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    // Extract highest numeric token from ID for rough version ordering
    const ver = (id: string) => {
      const nums = id.match(/\d+(\.\d+)?/g);
      return nums ? parseFloat(nums[nums.length - 1]) : 0;
    };
    const vDiff = ver(b) - ver(a);
    return vDiff !== 0 ? vDiff : b.localeCompare(a);
  });
}

function isImageModel(id: string): boolean {
  return id.startsWith('dall-e') || id.startsWith('gpt-image-');
}

export async function fetchOpenAIModelCatalog(apiKey: string): Promise<OpenAIModelCatalog> {
  const ck = cacheKey(apiKey);
  if (cache.has(ck)) return cache.get(ck)!;

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

  // Chat models: preferred (known) models first in our defined order,
  // then any live models not in the preferred list, sorted newest-first.
  const chatModels: string[] = [];
  for (const id of PREFERRED_CHAT_MODELS) {
    if (idSet.has(id)) chatModels.push(id);
  }
  const preferredSet = new Set(PREFERRED_CHAT_MODELS);
  const unlisted = allIds.filter(
    (id) => !preferredSet.has(id) && isChatModel(id) && !isImageModel(id),
  );
  for (const id of sortUnlistedChatModels(unlisted)) {
    chatModels.push(id);
  }

  // Fall back to a sensible static list if the fetch produced nothing useful
  if (chatModels.length === 0) {
    chatModels.push('gpt-4o', 'gpt-4o-mini');
  }

  // Image model: pick the best one this account actually has access to.
  // Only ever use a model that appears in the live API response.
  // PREFERRED_IMAGE_MODELS is ordered newest-first so the first match wins.
  let imageModel = '';
  for (const id of PREFERRED_IMAGE_MODELS) {
    if (idSet.has(id)) {
      imageModel = id;
      break;
    }
  }
  // If none of the preferred models are in the account, check for any gpt-image-* live model
  if (!imageModel) {
    const liveGptImage = allIds
      .filter((id) => id.startsWith('gpt-image-'))
      .sort()
      .reverse()[0];
    imageModel = liveGptImage ?? 'dall-e-3';
  }

  const catalog: OpenAIModelCatalog = { chatModels, imageModel };
  cache.set(cacheKey(apiKey), catalog);
  return catalog;
}

/** Invalidate the cached catalog for a given key (e.g. when the key changes). */
export function invalidateOpenAIModelCache(apiKey: string) {
  cache.delete(cacheKey(apiKey));
}

/** Returns the best available image model, falling back to dall-e-3 if catalog not yet loaded. */
export function getBestImageModel(catalog: OpenAIModelCatalog | null): string {
  return catalog?.imageModel ?? 'dall-e-3';
}
