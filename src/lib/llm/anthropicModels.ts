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

// Sort comparator: newer models first.
// Anthropic model IDs follow "claude-{family}-{version}" patterns — sort
// newest (highest version number) first, then alphabetically within same version.
function sortModels(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    // Extract trailing version numbers like "4-7", "4-5", "3-5" for numeric comparison
    const ver = (id: string) => {
      const m = id.match(/(\d+)-(\d+)/);
      return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0;
    };
    const vDiff = ver(b) - ver(a);
    if (vDiff !== 0) return vDiff;
    return b.localeCompare(a);
  });
}

export async function fetchAnthropicModelCatalog(apiKey: string): Promise<AnthropicModelCatalog> {
  if (cache.has(apiKey)) return cache.get(apiKey)!;

  let allIds: string[] = [];
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
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
