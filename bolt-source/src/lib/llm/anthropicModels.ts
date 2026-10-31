/**
 * Fetches the live list of Anthropic models for an API key, newest release first.
 */

export interface AnthropicModelCatalog {
  chatModels: string[];
  /** Newest full-size model — the default selection. */
  latestModel: string;
  /** False when the provider couldn't be reached and a built-in list is shown. */
  isLive: boolean;
}

const cache = new Map<string, AnthropicModelCatalog>();

const FALLBACK_MODELS = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

export async function fetchAnthropicModelCatalog(apiKey: string): Promise<AnthropicModelCatalog> {
  const cached = cache.get(apiKey);
  if (cached) return cached;

  const live: { id: string; created: number }[] = [];
  try {
    const headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    let afterId: string | undefined;
    for (let page = 0; page < 5; page++) {
      const url = new URL('https://api.anthropic.com/v1/models');
      url.searchParams.set('limit', '100');
      if (afterId) url.searchParams.set('after_id', afterId);

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        console.warn(`[ModelFetch] Anthropic /v1/models returned ${res.status}`);
        break;
      }
      const data = await res.json();
      const models = Array.isArray(data?.data) ? (data.data as { id?: unknown; created_at?: unknown }[]) : [];
      for (const m of models) {
        if (typeof m.id !== 'string' || !m.id.startsWith('claude')) continue;
        const created = typeof m.created_at === 'string' ? Date.parse(m.created_at) : NaN;
        live.push({ id: m.id, created: Number.isNaN(created) ? 0 : created });
      }
      if (data?.has_more !== true || models.length === 0) break;
      afterId = models[models.length - 1].id as string;
    }
  } catch (err) {
    console.warn('[ModelFetch] Failed to fetch Anthropic models:', err);
  }

  // Stable sort keeps the API's own newest-first order for equal dates.
  const chatModels = live.length > 0
    ? [...live].sort((a, b) => b.created - a.created).map((m) => m.id)
    : FALLBACK_MODELS;
  const latestModel = chatModels.find((id) => !id.includes('haiku')) ?? chatModels[0];

  const catalog: AnthropicModelCatalog = { chatModels, latestModel, isLive: live.length > 0 };
  if (live.length > 0) cache.set(apiKey, catalog);
  return catalog;
}

export function invalidateAnthropicModelCache(apiKey: string) {
  cache.delete(apiKey);
}
