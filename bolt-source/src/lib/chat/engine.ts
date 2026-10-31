import type { PedagogyDB } from '../../db/schema';
import type { Message, MessageAttachment, ToolInvocation } from '../../db/schema';
import { messagesRepo, conversationsRepo, uid } from '../../db/repos';
import { llmClient } from '../llm';
import type { LLMMessage, StreamChunk, ToolDefinition } from '../llm';
import type { Provider } from '../../types/credentials';
import { PEDAGOGY_TOOLS } from '../llm';
import { MAIN_SYSTEM_PROMPT } from './systemPrompt';
import {
  PREFLIGHT_SYSTEM_PROMPT,
  parsePreflightResponse,
  looksLikeArtifactRequest,
} from './clarification';
import { executeToolInvocations, type ToolExecContext } from './toolExecutor';
import { buildMemoryContext } from './memory';

// ─── Conversation → LLM message conversion ────────────────────────────────────

function messageToLlm(m: Message): LLMMessage {
  // Build content blocks from attachments + text
  const imageAttachments = (m.attachments ?? []).filter((a) => a.kind === 'image');
  const fileAttachments = (m.attachments ?? []).filter((a) => a.kind === 'file');

  let text = m.content;
  if (fileAttachments.length) {
    const fileContext = fileAttachments
      .map((a) => `<file name="${a.name}" type="${a.mediaType}">\n${a.data}\n</file>`)
      .join('\n\n');
    text = fileContext + (text ? `\n\n${text}` : '');
  }

  if (!imageAttachments.length) {
    return { role: m.role === 'system' ? 'user' : m.role, content: text };
  }

  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' }
  > = [];
  for (const img of imageAttachments) {
    parts.push({
      type: 'image',
      data: img.data,
      mediaType: img.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
    });
  }
  if (text) parts.push({ type: 'text', text });

  return { role: m.role === 'system' ? 'user' : m.role, content: parts };
}

function buildLlmHistory(chain: Message[]): LLMMessage[] {
  return chain
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map(messageToLlm);
}

// ─── Engine options ───────────────────────────────────────────────────────────

export interface SendOptions {
  db: PedagogyDB;
  conversationId: string;
  /** The just-created user message (already in DB) */
  userMessage: Message;
  provider: Provider;
  model: string;
  apiKey: string;
  /** Secondary keys — enables tools that require a different provider (e.g. image gen). */
  anthropicKey?: string;
  openaiKey?: string;
  onUpdate: (assistantId: string) => void;
  onUsage?: (inputTokens: number, outputTokens: number) => void;
  /** Called when the chosen model couldn't use tools and another model answered instead. */
  onModelSwitch?: (model: string) => void;
  signal?: AbortSignal;
  /** When true, mix in summaries of prior conversations as additional system context. */
  memoryEnabled?: boolean;
  /** Username whose data is being viewed — used for memory context. */
  username?: string;
}

// ─── Pre-flight clarification ────────────────────────────────────────────────

async function runPreflight(
  history: LLMMessage[],
  provider: Provider,
  model: string,
  apiKey: string,
): Promise<{ kind: 'ask'; question: string } | { kind: 'ready' } | { kind: 'skip' }> {
  try {
    const res = await llmClient.complete({
      provider,
      model,
      apiKey,
      messages: history,
      system: PREFLIGHT_SYSTEM_PROMPT,
      maxTokens: 300,
      temperature: 0,
    });
    const parsed = parsePreflightResponse(res.text);
    if (parsed.kind === 'ready') return { kind: 'ready' };
    if (parsed.kind === 'ask') return { kind: 'ask', question: parsed.question };
    // Invalid JSON — skip preflight and just answer normally
    return { kind: 'skip' };
  } catch {
    return { kind: 'skip' };
  }
}

// ─── Main send loop ──────────────────────────────────────────────────────────

export async function sendMessage(opts: SendOptions): Promise<void> {
  const { db, conversationId, userMessage, provider, apiKey, onUpdate, onUsage } = opts;
  let model = opts.model;
  const anthropicKey = opts.anthropicKey ?? (provider === 'anthropic' ? apiKey : undefined);
  const openaiKey = opts.openaiKey ?? (provider === 'openai' ? apiKey : undefined);

  const chain = await messagesRepo.getActiveChain(db, conversationId);
  const llmHistory = buildLlmHistory(chain);

  // Decide whether to invoke pre-flight clarifier
  const userText =
    typeof userMessage.content === 'string' ? userMessage.content : '';
  const shouldClarify = looksLikeArtifactRequest(userText);

  // Create the assistant message placeholder up front so UI can render immediately
  const assistantMsg = await messagesRepo.create(db, {
    conversationId,
    parentId: userMessage.id,
    role: 'assistant',
    content: '',
    provider,
    model,
  });
  onUpdate(assistantMsg.id);

  if (shouldClarify) {
    const preflight = await runPreflight(llmHistory, provider, model, apiKey);
    if (preflight.kind === 'ask') {
      await messagesRepo.setContent(db, assistantMsg.id, preflight.question);
      onUpdate(assistantMsg.id);
      return;
    }
    // ready or skip: fall through to main generation
  }

  // ─── Main streaming generation ─────────────────────────────────────────────

  const tools: ToolDefinition[] = PEDAGOGY_TOOLS;

  // Inject today's date + timezone so relative phrases like "tomorrow" / "next
  // Monday" resolve correctly when the model builds tool arguments.
  const now = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const _pad = (n: number) => String(n).padStart(2, '0');
  const todayLocal = `${now.getFullYear()}-${_pad(now.getMonth() + 1)}-${_pad(now.getDate())}`;
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowLocal = `${tomorrowDate.getFullYear()}-${_pad(tomorrowDate.getMonth() + 1)}-${_pad(tomorrowDate.getDate())}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const lookupRows: string[] = [];
  for (let i = 0; i < 21; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
    const label = i === 0 ? 'TODAY' : i === 1 ? 'TOMORROW' : `+${i}d`;
    lookupRows.push(`  ${iso} = ${dayNames[d.getDay()]} (${label})`);
  }
  const dateBlock = [
    'CURRENT DATE/TIME — USE THIS, DO NOT GUESS:',
    `- Today is ${dayNames[now.getDay()]}, ${todayLocal} (local time ${_pad(now.getHours())}:${_pad(now.getMinutes())}, timezone ${tz}).`,
    `- "Today" = ${todayLocal}. "Tomorrow" = ${tomorrowLocal}.`,
    '',
    'AUTHORITATIVE CALENDAR LOOKUP (next 21 days). Your training data may have an incorrect calendar for this year — ALWAYS use the table below to resolve any day-of-week question. Do not compute dates yourself.',
    ...lookupRows,
    '',
    'RULES:',
    '- CRITICAL: When the user mentions a weekday ("next Tuesday", "this Friday", "Monday"), you MUST call clear_timetable_range with weekdayPhrase="next tuesday" (etc) and OMIT fromISO/toISO. The server will resolve the correct date from the real current date. DO NOT compute the date yourself — your calendar arithmetic has been wrong before.',
    '- For read-only queries: call list_timetable_blocks with NO date filters first to see everything, then filter in your reasoning using the dayOfWeek / date fields on each returned block.',
    '- Before claiming a date is free, verify by reading the actual tool result — never assert a day is clear based on your own date reasoning.',
    '- After any destructive action, QUOTE the returned summary (which includes the actual day-of-week cleared) in your reply. Do NOT paraphrase or restate the date in your own words — copy it from the tool result verbatim to avoid hallucinating the wrong day.',
    '- If you absolutely must pass fromISO/toISO for clear_timetable_range, also pass expectedDayOfWeek so the tool can sanity-check and refuse if your date is wrong.',
  ].join('\n');

  let systemPrompt = `${MAIN_SYSTEM_PROMPT}\n\n${dateBlock}`;
  if (opts.memoryEnabled) {
    try {
      const memoryBlock = await buildMemoryContext({
        db,
        currentConversationId: conversationId,
        username: opts.username || '',
      });
      if (memoryBlock) {
        systemPrompt = `${MAIN_SYSTEM_PROMPT}\n\n${dateBlock}\n\n---\n${memoryBlock}`;
      }
    } catch {
      // memory is best-effort
    }
  }

  const workingHistory: LLMMessage[] = [...llmHistory];
  let allToolCalls: ToolInvocation[] = [];
  let finalText = '';
  const MAX_TOOL_ROUNDS = 4;

  const execCtx: ToolExecContext = {
    db, conversationId, anthropicKey, openaiKey, provider, model,
  };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let roundText = '';
      const roundToolCalls: ToolInvocation[] = [];
      let lastWrite = 0;

      const onChunk = (chunk: StreamChunk) => {
        if (chunk.type === 'text') {
          roundText += chunk.delta;
          const combined = finalText + roundText;
          // Throttle DB writes to ~every 120ms to avoid swamping Dexie/Supabase.
          const now = Date.now();
          if (now - lastWrite > 120) {
            lastWrite = now;
            void messagesRepo.setContent(db, assistantMsg.id, combined);
            onUpdate(assistantMsg.id);
          }
        } else if (chunk.type === 'tool_call') {
          const inv: ToolInvocation = {
            id: chunk.toolCall.id,
            name: chunk.toolCall.name,
            arguments: chunk.toolCall.arguments,
            status: 'pending',
          };
          roundToolCalls.push(inv);
          void messagesRepo.setToolCalls(db, assistantMsg.id, [...allToolCalls, ...roundToolCalls]);
          onUpdate(assistantMsg.id);
        } else if (chunk.type === 'usage') {
          void messagesRepo.setUsage(db, assistantMsg.id, {
            inputTokens: chunk.usage.inputTokens,
            outputTokens: chunk.usage.outputTokens,
          });
          onUsage?.(chunk.usage.inputTokens, chunk.usage.outputTokens);
        }
      };

      const res = await llmClient.complete(
        {
          provider,
          model,
          apiKey,
          messages: workingHistory,
          system: systemPrompt,
          tools,
          maxTokens: 16384,
          signal: opts.signal,
        },
        onChunk,
      );
      if (res.model && res.model !== model) {
        model = res.model;
        execCtx.model = model;
        opts.onModelSwitch?.(model);
      }

      // Flush any buffered streamed text to the DB so the UI sees the final state.
      finalText += roundText;
      await messagesRepo.setContent(db, assistantMsg.id, finalText);
      onUpdate(assistantMsg.id);

      if (roundToolCalls.length === 0) break;

      // Execute this round's tools and feed results back to the LLM.
      const executed = await executeToolInvocations(
        roundToolCalls.map((t) => ({ ...t })),
        execCtx,
        (updated) => {
          void messagesRepo.setToolCalls(db, assistantMsg.id, [...allToolCalls, ...updated]);
          onUpdate(assistantMsg.id);
        },
      );
      allToolCalls = [...allToolCalls, ...executed];
      await messagesRepo.setToolCalls(db, assistantMsg.id, allToolCalls);
      onUpdate(assistantMsg.id);

      // Append the assistant turn + synthetic tool-result turn to history so
      // the next round can use them. We collapse to text-only messages because
      // the LLMMessage surface doesn't carry tool-use blocks natively — this is
      // a practical workaround that still grounds the model in what was found.
      const toolTranscript = executed
        .map((t) => {
          const r = t.result as { summary?: string; details?: Record<string, unknown>; error?: string } | undefined;
          let payload: string;
          if (r?.error) {
            payload = `Error: ${r.error}`;
          } else if (t.name === 'fetch_webpage' && r?.details && typeof (r.details as Record<string, unknown>).pageContent === 'string') {
            // Surface page text directly so the model can read it without JSON parsing
            payload = `${r.summary}\n\n${(r.details as Record<string, unknown>).pageContent as string}`;
          } else {
            payload = JSON.stringify({ summary: r?.summary, details: r?.details }, null, 2);
          }
          return `<tool_result name="${t.name}">\n${payload}\n</tool_result>`;
        })
        .join('\n');

      workingHistory.push({
        role: 'assistant',
        content: (roundText || '[tool calls]') +
          '\n\n' + executed.map((t) => `<tool_use name="${t.name}" />`).join('\n'),
      });
      workingHistory.push({
        role: 'user',
        content: `${toolTranscript}\n\nContinue — use these tool results to directly answer the user's question. Do not call the same tool again unnecessarily.`,
      });
    }
  } catch (err) {
    const isAbort = (err as { name?: string })?.name === 'AbortError'
      || opts.signal?.aborted;
    if (isAbort) {
      // User stopped — preserve what we have and surface a friendly note.
      await messagesRepo.setContent(
        db,
        assistantMsg.id,
        finalText + (finalText ? '\n\n' : '') + '_Stopped by user._',
      );
      onUpdate(assistantMsg.id);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await messagesRepo.setContent(
      db,
      assistantMsg.id,
      finalText + `\n\n> **Error:** ${message}`,
    );
    onUpdate(assistantMsg.id);
    throw err;
  }

  await maybeAutoRenameConversation(db, conversationId, provider, model, apiKey);
}

// ─── Auto-titling ────────────────────────────────────────────────────────────

async function maybeAutoRenameConversation(
  db: PedagogyDB,
  conversationId: string,
  provider: Provider,
  model: string,
  apiKey: string,
): Promise<void> {
  const conv = await conversationsRepo.get(db, conversationId);
  if (!conv) return;
  if (conv.title !== 'New conversation' && !looksLikeShortOrGenericTitle(conv.title)) return;

  const msgs = await db.messages.where('conversationId').equals(conversationId).toArray();
  msgs.sort((a, b) => a.createdAt - b.createdAt);
  const firstUser = msgs.find((m) => m.role === 'user');
  if (!firstUser) return;

  // Collect a short transcript for context
  const transcript = msgs
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(0, 6)
    .map((m) => {
      const who = m.role === 'user' ? 'User' : 'Assistant';
      const text = typeof m.content === 'string' ? m.content : '';
      return `${who}: ${text.slice(0, 400)}`;
    })
    .join('\n');

  let title = firstUser.content.slice(0, 48).trim() + (firstUser.content.length > 48 ? '…' : '');

  try {
    const res = await llmClient.complete({
      provider,
      model,
      apiKey,
      messages: [
        {
          role: 'user',
          content:
            'Produce a short, descriptive title (3–7 words, Title Case, no surrounding quotes, no trailing punctuation) for the conversation below. The title must reflect the actual topic being discussed — never use a single number, a greeting, or filler words. Respond with ONLY the title.\n\n' +
            transcript,
        },
      ],
      maxTokens: 40,
      temperature: 0,
    });
    const cleaned = cleanTitle(res.text);
    if (cleaned) title = cleaned;
  } catch {
    // fall back to firstUser snippet
  }

  await conversationsRepo.rename(db, conversationId, title);
}

function looksLikeShortOrGenericTitle(title: string): boolean {
  const t = title.trim();
  if (t.length <= 3) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^(yes|no|ok|okay|sure|thanks|hi|hello|hey)\W*$/i.test(t)) return true;
  return false;
}

function cleanTitle(raw: string): string {
  return raw
    .split('\n')[0]
    .replace(/^["'`\s]+|["'`\s.?!]+$/g, '')
    .replace(/^title:\s*/i, '')
    .slice(0, 72)
    .trim();
}

// ─── Message creation helpers ────────────────────────────────────────────────

export async function createUserMessage(
  db: PedagogyDB,
  conversationId: string,
  parentId: string | null,
  content: string,
  attachments: MessageAttachment[] = [],
): Promise<Message> {
  return messagesRepo.create(db, {
    conversationId,
    parentId,
    role: 'user',
    content,
    attachments: attachments.length ? attachments : undefined,
  });
}

export function newAttachmentId(): string {
  return uid('att');
}
