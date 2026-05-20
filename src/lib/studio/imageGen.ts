/**
 * Image generation via OpenAI's Images API.
 * Auto-selects the best available model from the account's catalog.
 *
 * As of 2026, the Images API always returns b64_json — the `response_format`
 * parameter is no longer accepted and will cause a 400 error.
 */

import { fetchOpenAIModelCatalog } from '../llm/openaiModels';

const ENDPOINT = 'https://api.openai.com/v1/images/generations';

export interface ImageGenRequest {
  apiKey: string;
  prompt: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto';
  /** Override the model. If omitted, best available is resolved automatically. */
  model?: string;
}

export async function generateImage(req: ImageGenRequest): Promise<string> {
  let model = req.model;
  if (!model) {
    try {
      const catalog = await fetchOpenAIModelCatalog(req.apiKey);
      model = catalog.imageModel;
    } catch {
      model = 'gpt-image-1';
    }
  }

  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    n: 1,
  };

  // Size handling
  const raw = req.size;
  body.size = (!raw || raw === 'auto') ? '1024x1024' : raw;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `Image generation failed (HTTP ${res.status})`;
    try {
      const errBody = await res.json();
      msg = errBody?.error?.message ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json as string | undefined;
  if (!b64) throw new Error('No image returned from OpenAI');
  return b64;
}
