import type { Provider } from '../../types/credentials';

// ─── Message types ────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ImageContent {
  type: 'image';
  /** base64-encoded image data */
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

export interface TextContent {
  type: 'text';
  text: string;
}

export type MessageContent = string | (TextContent | ImageContent)[];

export interface LLMMessage {
  role: MessageRole;
  content: MessageContent;
}

// ─── Tool / function calling ───────────────────────────────────────────────────

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ─── Usage ────────────────────────────────────────────────────────────────────

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

// ─── Request / Response ───────────────────────────────────────────────────────

export interface LLMRequest {
  provider: Provider;
  model: string;
  apiKey: string;
  messages: LLMMessage[];
  system?: string;
  tools?: ToolDefinition[];
  /** Top-level image shorthand — prepended to the last user message */
  image?: ImageContent;
  maxTokens?: number;
  temperature?: number;
  /** Optional abort signal — cancels the in-flight fetch when triggered. */
  signal?: AbortSignal;
}

export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: LLMUsage;
}

// ─── Streaming ────────────────────────────────────────────────────────────────

export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'usage'; usage: LLMUsage }
  | { type: 'error'; message: string; status?: number };

export type OnChunk = (chunk: StreamChunk) => void;

// ─── Error ────────────────────────────────────────────────────────────────────

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly provider: Provider,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
