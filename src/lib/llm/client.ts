import type { LLMRequest, LLMResponse, OnChunk, StreamChunk } from './types';
import { LLMError } from './types';
import { anthropicStream, anthropicComplete } from './anthropic';
import { openaiStream, openaiComplete } from './openai';

export type { LLMRequest, LLMResponse, StreamChunk, OnChunk };
export { LLMError };

/**
 * Primary entry point.
 *
 * Attempts streaming first; falls back to non-streaming if the browser or
 * endpoint doesn't support ReadableStream (shouldn't happen in modern browsers,
 * but guards edge cases).
 *
 * onChunk is optional — omit it for a simple await-style call.
 */
export async function complete(
  req: LLMRequest,
  onChunk?: OnChunk,
): Promise<LLMResponse> {
  const sink: OnChunk = onChunk ?? (() => { /* no-op */ });

  try {
    if (req.provider === 'anthropic') {
      return await anthropicStream(req, sink);
    } else {
      return await openaiStream(req, sink);
    }
  } catch (err) {
    if (err instanceof LLMError) throw err;

    // Network / parse error — attempt non-streaming fallback
    if (req.provider === 'anthropic') {
      return anthropicComplete(req);
    } else {
      return openaiComplete(req, sink);
    }
  }
}

export const llmClient = { complete };
