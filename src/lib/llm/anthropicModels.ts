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
  'claude-opus-4-7',
  'claude-opus-4-5',
  'claude-sonnet-4-7',
  'claude-sonnet-4-5',
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

// Sort comparator: newer models first, Opus before Sonnet at same version.
function sortModels(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ver = (id: string) => {
      const m = id.match(/(\d+)-(\d+)/);
      return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0;
    };
    const vDiff = ver(b) - ver(a);
    if (vDiff !== 0) return vDiff;
    // At same version: opus > sonnet > haiku
    const familyRank = (id: string) => {
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
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2025-04-15',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (res.ok) {
      const data = await res.json();
      allIds = (data.data as { id: string }[])
        .map((m) => m.id)
        .filter((id) => !isNonChatModel(id));
    }
  } catch {
    // Network failure — fall through to static defaults
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
