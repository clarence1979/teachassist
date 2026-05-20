/**
 * Image generation via OpenAI's images API.
 * Auto-selects the best available model from the account's catalog.
 * GPT image models (gpt-image-2, gpt-image-1) return b64_json by default
 * and do NOT accept a response_format parameter.
 * dall-e-3/2 require response_format: 'b64_json' to return base64.
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
  // Resolve the best image model the account has access to via the live catalog.
  // Falls back to dall-e-3 if catalog fetch fails — it is universally available.
  let model = req.model;
  if (!model) {
    try {
      const catalog = await fetchOpenAIModelCatalog(req.apiKey);
      model = catalog.imageModel;
    } catch {
      model = 'dall-e-3';
    }
  }

  const isDallE = model === 'dall-e-2' || model === 'dall-e-3';

  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    n: 1,
  };

  if (isDallE) {
    // dall-e-2/3 need explicit response_format to get base64 back
    body.response_format = 'b64_json';
    // dall-e-3 uses different size names
    const raw = req.size;
    if (model === 'dall-e-3') {
      if (raw === '1536x1024') body.size = '1792x1024';
      else if (raw === '1024x1536') body.size = '1024x1792';
      else body.size = '1024x1024';
    } else {
      // dall-e-2 only supports square sizes
      body.size = '1024x1024';
    }
    body.quality = 'standard';
  } else {
    // GPT image models (gpt-image-2, gpt-image-1, etc.):
    // - Do NOT accept response_format (causes 400)
    // - Return b64_json automatically
    // - Accept flexible sizes
    const raw = req.size;
    body.size = (!raw || raw === 'auto') ? '1024x1024' : raw;
  }

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
