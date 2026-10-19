import type {
  LLMRequest,
  LLMResponse,
  LLMMessage,
  ImageContent,
  ToolCall,
  OnChunk,
} from './types';
import { LLMError } from './types';

import { fetchOpenAIModelCatalog } from './openaiModels';

const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

// o1 models use the responses endpoint and don't support streaming
const O1_MODELS = ['o1', 'o1-mini', 'o1-preview'];
const isO1 = (model: string) => O1_MODELS.some((m) => model.startsWith(m));
// Reasoning models reject max_tokens/temperature, and their hidden reasoning counts toward the token cap.
const isReasoningModel = (model: string) => /^o\d/.test(model) || /^gpt-(5|[6-9]|\d{2})/.test(model);

// ─── Request builders ─────────────────────────────────────────────────────────

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function toBase64DataUrl(img: ImageContent): string {
  return `data:${img.mediaType};base64,${img.data}`;
}

function toOpenAIContent(
  content: LLMMessage['content'],
  image?: ImageContent,
): string | OpenAIContentPart[] {
  if (!image && typeof content === 'string') return content;

  const parts: OpenAIContentPart[] = [];

  if (image) {
    parts.push({ type: 'image_url', image_url: { url: toBase64DataUrl(image) } });
  }

  if (typeof content === 'string') {
    parts.push({ type: 'text', text: content });
  } else {
    for (const c of content) {
      if (c.type === 'text') {
        parts.push({ type: 'text', text: c.text });
      } else {
        parts.push({ type: 'image_url', image_url: { url: toBase64DataUrl(c) } });
      }
    }
  }

  return parts;
}

function buildMessages(req: LLMRequest): { role: string; content: unknown }[] {
  const out: { role: string; content: unknown }[] = [];

  if (req.system) out.push({ role: 'system', content: req.system });

  for (let i = 0; i < req.messages.length; i++) {
    const m = req.messages[i];
    if (m.role === 'system') continue;
    const isLast = i === req.messages.length - 1;
    const img = isLast && m.role === 'user' ? req.image : undefined;
    out.push({ role: m.role, content: toOpenAIContent(m.content, img) });
  }

  return out;
}

function buildBody(req: LLMRequest, stream: boolean, reasoningOff = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: buildMessages(req),
    stream,
  };

  if (isReasoningModel(req.model)) {
    body.max_completion_tokens = Math.max(req.maxTokens ?? 4096, 16000);
  } else {
    body.max_tokens = req.maxTokens ?? 4096;
    if (req.temperature !== undefined) body.temperature = req.temperature;
  }

  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    body.tool_choice = 'auto';
    if (reasoningOff) body.reasoning_effort = 'none';
  }

  if (stream) {
    body.stream_options = { include_usage: true };
  }

  return body;
}

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

// ─── Error handling ───────────────────────────────────────────────────────────

async function handleError(res: Response): Promise<never> {
  const prefix = res.status === 401 ? 'Invalid OpenAI API key — check Settings.'
    : res.status === 429 ? 'OpenAI rate limit reached. Wait a moment and try again.'
    : res.status >= 500 ? `OpenAI server error (${res.status}). Try again shortly.`
    : `OpenAI ${res.status}`;
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message ?? '';
  } catch { /* ignore */ }
  const message = detail && !prefix.includes(String(res.status)) ? `${prefix} ${detail}` : (detail || prefix);
  throw new LLMError(message, res.status, 'openai');
}

// ─── Streaming ────────────────────────────────────────────────────────────────

async function streamOnce(
  req: LLMRequest,
  onChunk: OnChunk,
  reasoningOff: boolean,
): Promise<LLMResponse> {
  if (isO1(req.model)) {
    return completeOnce(req, onChunk, reasoningOff);
  }

  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: headers(req.apiKey),
    body: JSON.stringify(buildBody(req, true, reasoningOff)),
    signal: req.signal,
  });

  if (!res.ok) await handleError(res);
  if (!res.body) throw new LLMError('No response body', 500, 'openai');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let fullText = '';
  // index → { id, name, argsJson }
  const toolCallsMap = new Map<number, { id: string; name: string; argsJson: string }>();
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

      const usage = event.usage as Record<string, unknown> | undefined;
      if (usage) {
        inputTokens = (usage.prompt_tokens as number) ?? inputTokens;
        outputTokens = (usage.completion_tokens as number) ?? outputTokens;
      }

      const choices = (event.choices as unknown[]) ?? [];
      for (const choice of choices) {
        const delta = (choice as Record<string, unknown>).delta as Record<string, unknown>;
        if (!delta) continue;

        if (delta.content) {
          const text = delta.content as string;
          fullText += text;
          onChunk({ type: 'text', delta: text });
        }

        const tcDeltas = (delta.tool_calls as unknown[]) ?? [];
        for (const tc of tcDeltas) {
          const d = tc as Record<string, unknown>;
          const idx = d.index as number;
          if (!toolCallsMap.has(idx)) {
            const fn = d.function as Record<string, unknown>;
            toolCallsMap.set(idx, {
              id: d.id as string ?? '',
              name: (fn?.name as string) ?? '',
              argsJson: (fn?.arguments as string) ?? '',
            });
          } else {
            const existing = toolCallsMap.get(idx)!;
            const fn = d.function as Record<string, unknown>;
            if (fn?.arguments) existing.argsJson += fn.arguments as string;
            if (d.id) existing.id = d.id as string;
          }
        }
      }
    }
  }

  const toolCalls: ToolCall[] = [];
  for (const [, tc] of toolCallsMap) {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.argsJson); } catch { /* malformed */ }
    const call: ToolCall = { id: tc.id, name: tc.name, arguments: args };
    toolCalls.push(call);
    onChunk({ type: 'tool_call', toolCall: call });
  }

  const usage = { inputTokens, outputTokens };
  onChunk({ type: 'usage', usage });

  return { text: fullText, toolCalls, usage, model: req.model };
}

// ─── Non-streaming (o1 + fallback) ───────────────────────────────────────────

async function completeOnce(
  req: LLMRequest,
  onChunk: OnChunk | undefined,
  reasoningOff: boolean,
): Promise<LLMResponse> {
  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: headers(req.apiKey),
    body: JSON.stringify(buildBody(req, false, reasoningOff)),
    signal: req.signal,
  });

  if (!res.ok) await handleError(res);
  const data = await res.json();

  const choice = data.choices?.[0];
  const msg = choice?.message ?? {};
  const text = msg.content ?? '';

  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map(
    (tc: Record<string, unknown>) => {
      const fn = tc.function as Record<string, unknown>;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(fn.arguments as string); } catch { /* malformed */ }
      return { id: tc.id as string, name: fn.name as string, arguments: args };
    },
  );

  if (onChunk && text) onChunk({ type: 'text', delta: text });
  for (const tc of toolCalls) if (onChunk) onChunk({ type: 'tool_call', toolCall: tc });

  const usage = {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
  if (onChunk) onChunk({ type: 'usage', usage });

  return { text, toolCalls, usage, model: req.model };
}

// ─── Tool-compatibility recovery ─────────────────────────────────────────────
// Some models only accept tools with reasoning off; others reject tools on
// chat completions entirely. Learned fixes are remembered for the session.

type Sender = (req: LLMRequest, reasoningOff: boolean) => Promise<LLMResponse>;

const MAX_SUBSTITUTE_ATTEMPTS = 6;
const needsReasoningOff = new Set<string>();
const toolSubstitutes = new Map<string, string>();

function isToolRejection(err: unknown): err is LLMError {
  return err instanceof LLMError && err.status === 400 && /\b(tool|tools|function)\b/i.test(err.message);
}

function wantsReasoningOff(err: LLMError): boolean {
  return /reasoning_effort/i.test(err.message) && /'none'|"none"|\bnone\b/i.test(err.message);
}

// The candidate can't serve this request, but the key itself is fine.
function isModelUnusable(err: unknown): boolean {
  return err instanceof LLMError && [400, 403, 404].includes(err.status);
}

async function sendOnModel(send: Sender, req: LLMRequest, model: string): Promise<LLMResponse> {
  const attempt = { ...req, model };
  if (needsReasoningOff.has(model)) return send(attempt, true);
  try {
    return await send(attempt, false);
  } catch (err) {
    if (!isToolRejection(err) || !wantsReasoningOff(err)) throw err;
    needsReasoningOff.add(model);
    return send(attempt, true);
  }
}

async function withToolRecovery(send: Sender, req: LLMRequest): Promise<LLMResponse> {
  if (!req.tools?.length) return send(req, false);

  const remembered = toolSubstitutes.get(req.model);
  if (remembered) {
    try { return await sendOnModel(send, req, remembered); }
    catch (err) { if (!isModelUnusable(err)) throw err; toolSubstitutes.delete(req.model); }
  }

  let original: unknown;
  try {
    return await sendOnModel(send, req, req.model);
  } catch (err) {
    if (!isToolRejection(err)) throw err;
    original = err;
  }

  const catalog = await fetchOpenAIModelCatalog(req.apiKey);
  const candidates = catalog.chatModels.filter((m) => m !== req.model).slice(0, MAX_SUBSTITUTE_ATTEMPTS);
  for (const candidate of candidates) {
    if (req.signal?.aborted) break;
    try {
      const res = await sendOnModel(send, req, candidate);
      toolSubstitutes.set(req.model, candidate);
      return res;
    } catch (err) {
      if (!isModelUnusable(err)) throw err;
    }
  }
  throw new LLMError(
    `${req.model} can't use the app's tools, and no other OpenAI model on this API key could take over. Pick a different model and try again.`,
    (original as LLMError).status,
    'openai',
  );
}

export function openaiStream(req: LLMRequest, onChunk: OnChunk): Promise<LLMResponse> {
  return withToolRecovery((r, off) => streamOnce(r, onChunk, off), req);
}

export function openaiComplete(req: LLMRequest, onChunk?: OnChunk): Promise<LLMResponse> {
  return withToolRecovery((r, off) => completeOnce(r, onChunk, off), req);
}
