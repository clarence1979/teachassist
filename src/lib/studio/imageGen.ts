/**
 * Image generation via OpenAI's images API.
 * Prefers gpt-image-1 but falls back to dall-e-3 automatically.
 * Returns base64 PNG (no data-URL prefix) for embedding in pptx / preview.
 */

import { fetchOpenAIModelCatalog } from '../llm/openaiModels';

const ENDPOINT = 'https://api.openai.com/v1/images/generations';

export interface ImageGenRequest {
  apiKey: string;
  prompt: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto';
  /** Override the model (e.g. 'dall-e-3'). If omitted, best available is resolved automatically. */
  model?: string;
}

export async function generateImage(req: ImageGenRequest): Promise<string> {
  // Resolve the best available image model unless the caller specified one
  let model = req.model;
  if (!model) {
    try {
      const catalog = await fetchOpenAIModelCatalog(req.apiKey);
      model = catalog.imageModel;
    } catch {
      model = 'dall-e-3';
    }
  }

  const isDallE = model.startsWith('dall-e');

  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    n: 1,
  };

  if (isDallE) {
    // dall-e-2/3 support b64_json; dall-e-3 size mapping
    body.response_format = 'b64_json';
    const raw = req.size;
    if (raw === '1536x1024') {
      body.size = '1792x1024';
    } else if (raw === '1024x1536') {
      body.size = '1024x1792';
    } else if (!raw || raw === 'auto') {
      body.size = '1024x1024';
    } else {
      body.size = raw;
    }
    body.quality = 'standard';
  } else {
    // gpt-image-1: does NOT accept response_format; returns b64_json by default
    body.size = req.size ?? '1536x1024';
    body.output_format = 'png';
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
  // gpt-image-1 returns b64_json directly; dall-e-3 also returns b64_json
  const b64 = data?.data?.[0]?.b64_json as string | undefined;
  if (!b64) throw new Error('No image returned from OpenAI');
  return b64;
}
