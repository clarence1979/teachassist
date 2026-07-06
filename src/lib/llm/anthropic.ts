import type {
  LLMRequest,
  LLMResponse,
  LLMMessage,
  ImageContent,
  ToolCall,
  OnChunk,
} from './types';
import { LLMError } from './types';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// ─── Request builders ─────────────────────────────────────────────────────────

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

function toAnthropicContent(
  content: LLMMessage['content'],
): AnthropicContentBlock[] | string {
  if (typeof content === 'string') return content;
  return content.map((c) => {
    if (c.type === 'text') return { type: 'text' as const, text: c.text };
    return {
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: c.mediaType, data: c.data },
    };
  });
}

function buildMessages(
  messages: LLMMessage[],
  image?: ImageContent,
): { role: string; content: AnthropicContentBlock[] | string }[] {
  const built = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role,
      content: toAnthropicContent(m.content),
    }));

  if (image && built.length) {
    const last = built[built.length - 1];
    if (last.role === 'user') {
      const imgBlock: AnthropicContentBlock = {
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.data },
      };
      const existingBlocks: AnthropicContentBlock[] =
        typeof last.content === 'string'
          ? last.content
            ? [{ type: 'text', text: last.content }]
            : []
          : last.content;
      built[built.length - 1] = {
        role: last.role,
        content: [imgBlock, ...existingBlocks],
      };
    }
  }

  return built;
}

function buildBody(req: LLMRequest, stream: boolean): Record<string, unknown> {
  const model = req.model;
  const adaptive = usesAdaptiveThinking(model);
  const legacyThinking = usesLegacyThinking(model);

  const body: Record<string, unknown> = {
    model,
    max_tokens: req.maxTokens ?? 16384,
    messages: buildMessages(req.messages, req.image),
    stream,
  };
  if (req.system) body.system = req.system;

  // Opus 4.7+, Sonnet 5, Fable 5 reject non-default temperature/top_p/top_k
  if (!adaptive && req.temperature !== undefined) {
    body.temperature = req.temperature;
  }

  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  // Adaptive thinking for Opus 4.7+, Sonnet 5, Fable 5
  if (adaptive) {
    body.thinking = { type: 'adaptive' };
  } else if (legacyThinking && !req.tools?.length) {
    // Legacy extended thinking for Opus 4.5/4.6, Sonnet 4.5/4.6
    body.thinking = { type: 'enabled', budget_tokens: Math.min(10000, (req.maxTokens ?? 16384) - 1000) };
    delete body.temperature;
  }

  return body;
}

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

// Opus 4.7+, Sonnet 5, Fable 5 use adaptive thinking (rejects budget_tokens)
function usesAdaptiveThinking(model: string): boolean {
  if (model.includes('fable')) return true;
  if (model.includes('opus-4-7') || model.includes('opus-4-8') || model.includes('opus-4-9')) return true;
  if (model.includes('sonnet-5')) return true;
  // Future opus versions
  const opusMatch = model.match(/opus-(\d+)-(\d+)/);
  if (opusMatch) {
    const major = parseInt(opusMatch[1]);
    const minor = parseInt(opusMatch[2]);
    if (major > 4 || (major === 4 && minor >= 7)) return true;
  }
  return false;
}

// Older models that still support legacy extended thinking (budget_tokens)
function usesLegacyThinking(model: string): boolean {
  return (
    model.includes('opus-4-5') ||
    model.includes('opus-4-6') ||
    model.includes('sonnet-4-5') ||
    model.includes('sonnet-4-6')
  );
}

// ─── Error handling ───────────────────────────────────────────────────────────

async function handleError(res: Response): Promise<never> {
  const prefix = res.status === 401 ? 'Invalid Anthropic API key — check Settings.'
    : res.status === 429 ? 'Anthropic rate limit reached. Wait a moment and try again.'
    : res.status >= 500 ? `Anthropic server error (${res.status}). Try again shortly.`
    : `Anthropic ${res.status}`;
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message ?? '';
  } catch { /* ignore */ }
  const message = detail && !prefix.includes(String(res.status)) ? `${prefix} ${detail}` : (detail || prefix);
  throw new LLMError(message, res.status, 'anthropic');
}

// ─── Streaming ────────────────────────────────────────────────────────────────

export async function anthropicStream(
  req: LLMRequest,
  onChunk: OnChunk,
): Promise<LLMResponse> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: headers(req.apiKey),
    body: JSON.stringify(buildBody(req, true)),
    signal: req.signal,
  });

  if (!res.ok) await handleError(res);
  if (!res.body) throw new LLMError('No response body', 500, 'anthropic');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let fullText = '';
  const toolCallsMap = new Map<number, { id: string; name: string; inputJson: string }>();
  const thinkingBlocks = new Set<number>();
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;

      let event: Record<string, unknown>;
      try { event = JSON.parse(raw); } catch { continue; }

      const type = event.type as string;

      if (type === 'content_block_start') {
        const block = event.content_block as Record<string, unknown>;
        const idx = event.index as number;
        if (block?.type === 'tool_use') {
          toolCallsMap.set(idx, {
            id: block.id as string,
            name: block.name as string,
            inputJson: '',
          });
        } else if (block?.type === 'thinking') {
          thinkingBlocks.add(idx);
        }
      } else if (type === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown>;
        const idx = event.index as number;
        if (thinkingBlocks.has(idx)) {
          // Skip thinking block deltas — internal reasoning, not shown to user
        } else if (delta?.type === 'text_delta') {
          const text = delta.text as string;
          fullText += text;
          onChunk({ type: 'text', delta: text });
        } else if (delta?.type === 'input_json_delta') {
          const partial = delta.partial_json as string;
          const tc = toolCallsMap.get(idx);
          if (tc) tc.inputJson += partial;
        }
      } else if (type === 'content_block_stop') {
        const idx = event.index as number;
        const tc = toolCallsMap.get(idx);
        if (tc) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.inputJson); } catch { /* malformed */ }
          const toolCall: ToolCall = { id: tc.id, name: tc.name, arguments: args };
          onChunk({ type: 'tool_call', toolCall });
          toolCallsMap.delete(idx);
        }
        thinkingBlocks.delete(idx);
      } else if (type === 'message_delta') {
        const usage = (event.usage as Record<string, unknown>) ?? {};
        outputTokens = (usage.output_tokens as number) ?? outputTokens;
      } else if (type === 'message_start') {
        const msg = event.message as Record<string, unknown>;
        const usage = (msg?.usage as Record<string, unknown>) ?? {};
        inputTokens = (usage.input_tokens as number) ?? 0;
        outputTokens = (usage.output_tokens as number) ?? 0;
      }
    }
  }

  const usage = { inputTokens, outputTokens };
  onChunk({ type: 'usage', usage });

  return {
    text: fullText,
    toolCalls: [],
    usage,
  };
}

// ─── Non-streaming fallback ───────────────────────────────────────────────────

export async function anthropicComplete(req: LLMRequest): Promise<LLMResponse> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: headers(req.apiKey),
    body: JSON.stringify(buildBody(req, false)),
    signal: req.signal,
  });

  if (!res.ok) await handleError(res);
  const data = await res.json();

  let text = '';
  const toolCalls: ToolCall[] = [];

  for (const block of data.content ?? []) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, arguments: block.input ?? {} });
    }
  }

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    },
  };
}
