import type { PedagogyDB, Message, Conversation } from '../../db/schema';
import { supabase, USERNAME_HEADER } from '../supabaseClient';

const MAX_CONVERSATIONS = 12;
const MAX_USER_ASKS = 3;
const MAX_SNIPPET_CHARS = 280;
const MAX_TOTAL_CHARS = 7000;

interface MemoryOptions {
  db: PedagogyDB;
  currentConversationId: string;
  username: string;
}

type MemoryMessage = Pick<Message, 'conversationId' | 'role' | 'content' | 'createdAt' | 'isActive'> & {
  toolNames?: string[];
};

/**
 * Build a compact summary of the user's prior conversations so the AI can
 * reference earlier work. Reads the local mirror first (kept in sync with
 * Supabase); falls back to a lightweight remote query when the local copy
 * has not been populated yet (e.g. first load on a new device).
 */
export async function buildMemoryContext({ db, currentConversationId, username }: MemoryOptions): Promise<string> {
  let entries = await buildEntriesLocal(db, currentConversationId);
  if (!entries.length && username && username !== 'default') {
    try {
      entries = await buildEntriesRemote(username, currentConversationId);
    } catch (err) {
      console.warn('[memory] remote fetch failed:', err);
    }
  }
  return formatMemoryBlock(entries);
}

async function buildEntriesLocal(db: PedagogyDB, currentConversationId: string): Promise<string[]> {
  const convs = (await db.conversations.orderBy('updatedAt').reverse().toArray())
    .filter((c) => c.id !== currentConversationId)
    .slice(0, MAX_CONVERSATIONS);

  const entries: string[] = [];
  for (const conv of convs) {
    const msgs = await db.messages.where('conversationId').equals(conv.id).toArray();
    const slim: MemoryMessage[] = msgs.map((m) => ({
      conversationId: m.conversationId,
      role: m.role,
      content: withAttachmentNames(m),
      createdAt: m.createdAt,
      isActive: m.isActive,
      toolNames: m.toolCalls?.map((t) => t.name),
    }));
    const entry = buildConversationEntry(conv, slim);
    if (entry) entries.push(entry);
  }
  return entries;
}

async function buildEntriesRemote(username: string, currentConversationId: string): Promise<string[]> {
  const { data: convRows, error: convErr } = await supabase
    .from('user_records')
    .select('data')
    .eq('username', username)
    .eq('table_name', 'conversations')
    .eq('deleted', false)
    .order('updated_at', { ascending: false })
    .limit(MAX_CONVERSATIONS + 1)
    .setHeader(USERNAME_HEADER, username);
  if (convErr || !convRows) return [];

  const convs = (convRows as { data: Conversation }[])
    .map((r) => r.data)
    .filter((c) => c && c.id && c.id !== currentConversationId)
    .slice(0, MAX_CONVERSATIONS);
  if (!convs.length) return [];

  // Select only the small text fields — never the attachment payloads.
  const { data: msgRows, error: msgErr } = await supabase
    .from('user_records')
    .select('conversationId:data->>conversationId, role:data->>role, content:data->>content, createdAt:data->createdAt, isActive:data->isActive')
    .eq('username', username)
    .eq('table_name', 'messages')
    .eq('deleted', false)
    .in('data->>conversationId', convs.map((c) => c.id))
    .setHeader(USERNAME_HEADER, username);
  if (msgErr || !msgRows) return [];

  const byConv = new Map<string, MemoryMessage[]>();
  for (const m of msgRows as unknown as MemoryMessage[]) {
    if (!m.conversationId) continue;
    if (!byConv.has(m.conversationId)) byConv.set(m.conversationId, []);
    byConv.get(m.conversationId)!.push({ ...m, content: m.content ?? '', createdAt: Number(m.createdAt) || 0 });
  }

  const entries: string[] = [];
  for (const conv of convs) {
    const entry = buildConversationEntry(conv, byConv.get(conv.id) ?? []);
    if (entry) entries.push(entry);
  }
  return entries;
}

function buildConversationEntry(conv: Conversation, msgs: MemoryMessage[]): string | null {
  if (!msgs.length) return null;
  const sorted = [...msgs].sort((a, b) => a.createdAt - b.createdAt);
  // Prefer the active branch, but fall back to everything if flags are missing.
  const active = sorted.filter((m) => m.isActive !== false);
  const pool = active.length ? active : sorted;

  const asks = pool.filter((m) => m.role === 'user' && m.content.trim()).slice(0, MAX_USER_ASKS);
  if (!asks.length) return null;
  const lastAssistant = [...pool].reverse().find((m) => m.role === 'assistant' && m.content.trim());

  const date = new Date(conv.updatedAt || sorted[sorted.length - 1].createdAt).toISOString().slice(0, 10);
  const lines = [`[${date}] "${truncate(conv.title || 'Untitled', 80)}"`];
  asks.forEach((m, i) => lines.push(`  ${i === 0 ? 'Asked' : 'Then asked'}: ${truncate(m.content, MAX_SNIPPET_CHARS)}`));
  if (lastAssistant) lines.push(`  Last reply: ${truncate(lastAssistant.content, MAX_SNIPPET_CHARS)}`);

  const tools = [...new Set(pool.flatMap((m) => m.toolNames ?? []))].slice(0, 6);
  if (tools.length) lines.push(`  Tools used: ${tools.join(', ')}`);
  return lines.join('\n');
}

function formatMemoryBlock(entries: string[]): string {
  if (!entries.length) return '';

  let block = entries.map((e) => `\u2022 ${e}`).join('\n\n');
  if (block.length > MAX_TOTAL_CHARS) {
    block = block.slice(0, MAX_TOTAL_CHARS) + '\n\u2026(older conversations truncated)';
  }

  return `PRIOR-CONVERSATION MEMORY (enabled by the teacher)
You DO have memory of this teacher's earlier conversations: summaries of their most recent chats are listed below, newest first. When the teacher refers to something from before ("last time", "the worksheet we made", "what did we discuss"), answer using these summaries and never claim you cannot remember past chats. If a detail is not in the summaries, say you only have a brief summary of that chat and ask for the specifics. Do not bring these up unprompted when they are irrelevant.

${block}`;
}

function withAttachmentNames(msg: Message): string {
  if (!msg.attachments?.length) return msg.content ?? '';
  const kinds = msg.attachments.map((a) => `[${a.kind}:${a.name}]`).join(' ');
  return `${kinds} ${msg.content ?? ''}`.trim();
}

function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '\u2026' : one;
}
