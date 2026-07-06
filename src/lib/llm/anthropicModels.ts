/**
 * Fetches the live list of available Anthropic models for a given API key.
 * Results are cached per key for the session lifetime.
 *
 * Anthropic's /v1/models endpoint returns all models the account can access,
 * sorted newest-first by default.
 */

export interface AnthropicModelCatalog {
  chatModels: string[];
}

const cache = new Map<string, AnthropicModelCatalog>();

// Models we know are chat-capable — used only as fallback when the API call fails
const FALLBACK_MODELS = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

// Patterns that mark a non-chat model we want to exclude from the picker
function isNonChatModel(id: string): boolean {
  return (
    id.includes('embedding') ||
    id.includes('moderation') ||
    id.includes('vision') ||
    id.includes('tts') ||
    id.includes('whisper')
  );
}

// Sort comparator: newer models first, higher-tier families first.
function sortModels(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ver = (id: string) => {
      // Handle both "X-Y" (e.g. opus-4-8) and single version (e.g. sonnet-5, fable-5)
      const m2 = id.match(/(\d+)-(\d+)/);
      if (m2) return parseInt(m2[1]) * 100 + parseInt(m2[2]);
      const m1 = id.match(/-(\d+)$/);
      if (m1) return parseInt(m1[1]) * 100;
      return 0;
    };
    const vDiff = ver(b) - ver(a);
    if (vDiff !== 0) return vDiff;
    // Family rank: fable/mythos > opus > sonnet > haiku
    const familyRank = (id: string) => {
      if (id.includes('mythos')) return 5;
      if (id.includes('fable')) return 4;
      if (id.includes('opus')) return 3;
      if (id.includes('sonnet')) return 2;
      if (id.includes('haiku')) return 1;
      return 0;
    };
    const fDiff = familyRank(b) - familyRank(a);
    if (fDiff !== 0) return fDiff;
    return a.localeCompare(b);
  });
}

export async function fetchAnthropicModelCatalog(apiKey: string): Promise<AnthropicModelCatalog> {
  if (cache.has(apiKey)) return cache.get(apiKey)!;

  let allIds: string[] = [];
  try {
    const baseHeaders = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };

    let hasMore = true;
    let afterId: string | undefined;
    const maxPages = 5;
    let page = 0;

    while (hasMore && page < maxPages) {
      const url = new URL('https://api.anthropic.com/v1/models');
      url.searchParams.set('limit', '100');
      if (afterId) url.searchParams.set('after_id', afterId);

      const res = await fetch(url.toString(), { headers: baseHeaders });
      if (!res.ok) {
        console.warn(`[ModelFetch] Anthropic /v1/models returned ${res.status}`);
        break;
      }
      const data = await res.json();
      const models = (data.data as { id: string }[]) ?? [];
      for (const m of models) {
        if (!isNonChatModel(m.id)) allIds.push(m.id);
      }
      hasMore = data.has_more === true;
      if (hasMore && models.length > 0) {
        afterId = models[models.length - 1].id;
      }
      page++;
    }
  } catch (err) {
    console.warn('[ModelFetch] Failed to fetch Anthropic models:', err);
  }

  const chatModels = allIds.length > 0 ? sortModels(allIds) : FALLBACK_MODELS;

  const catalog: AnthropicModelCatalog = { chatModels };
  cache.set(apiKey, catalog);
  return catalog;
}

export function invalidateAnthropicModelCache(apiKey: string) {
  cache.delete(apiKey);
}

/** Clear ALL cached catalogs — used on app boot to ensure fresh models. */
export function clearAnthropicModelCache() {
  cache.clear();
}

/** Return the latest Opus model from a model list, or the first model if none found. */
export function getLatestOpus(models: string[]): string {
  const opus = models.find((m) => m.includes('opus'));
  return opus ?? models[0] ?? FALLBACK_MODELS[0];
}
