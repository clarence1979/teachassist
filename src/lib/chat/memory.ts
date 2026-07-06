import type { PedagogyDB, Message, Conversation } from '../../db/schema';
import { supabase } from '../supabaseClient';

const MAX_CONVERSATIONS = 8;
const MAX_SNIPPET_CHARS = 320;
const MAX_TOTAL_CHARS = 3500;

interface MemoryOptions {
  db: PedagogyDB;
  currentConversationId: string;
  username: string;
  isAdmin: boolean;
}

/**
 * Build a compact "memory" block from prior conversations, so the AI can
 * reference things the teacher has been working on across sessions.
 * Returns an empty string if there is nothing useful to include.
 *
 * When isAdmin is true, memory includes conversations from ALL users (fetched
 * from Supabase). Otherwise, it reads the current user's own conversations
 * from Supabase so memory works across devices.
 */
export async function buildMemoryContext(opts: MemoryOptions): Promise<string>;
/**
 * @deprecated Use the options-object overload.
 */
export async function buildMemoryContext(
  db: PedagogyDB,
  currentConversationId: string,
): Promise<string>;
export async function buildMemoryContext(
  dbOrOpts: PedagogyDB | MemoryOptions,
  maybeConvId?: string,
): Promise<string> {
  if ('db' in dbOrOpts && 'currentConversationId' in dbOrOpts && 'username' in dbOrOpts) {
    return buildMemoryContextImpl(dbOrOpts);
  }
  // Legacy call — local only, no admin cross-user
  return buildMemoryContextLocal(dbOrOpts as PedagogyDB, maybeConvId!);
}

async function buildMemoryContextLocal(
  db: PedagogyDB,
  currentConversationId: string,
): Promise<string> {
  const allConvs = await db.conversations.orderBy('updatedAt').reverse().toArray();
  const others = allConvs
    .filter((c) => c.id !== currentConversationId)
    .slice(0, MAX_CONVERSATIONS);

  if (!others.length) return '';

  const entries: string[] = [];
  for (const conv of others) {
    const msgs = await db.messages
      .where('conversationId')
      .equals(conv.id)
      .toArray();
    if (!msgs.length) continue;

    const entry = buildConversationEntry(conv, msgs);
    if (entry) entries.push(entry);
  }

  return formatMemoryBlock(entries);
}

async function buildMemoryContextImpl(opts: MemoryOptions): Promise<string> {
  const { currentConversationId, username, isAdmin } = opts;

  try {
    const conversations = await fetchConversationsFromSupabase(username, isAdmin, currentConversationId);
    if (!conversations.length) return '';

    const entries: string[] = [];
    for (const conv of conversations.slice(0, MAX_CONVERSATIONS)) {
      const msgs = await fetchMessagesFromSupabase(conv.id, conv._username);
      if (!msgs.length) continue;

      const prefix = isAdmin && conv._username && conv._username !== username
        ? `[${conv._username}] `
        : '';
      const entry = buildConversationEntry(conv, msgs, prefix);
      if (entry) entries.push(entry);
    }

    return formatMemoryBlock(entries);
  } catch (err) {
    console.warn('[memory] Supabase fetch failed, falling back to local:', err);
    return buildMemoryContextLocal(opts.db, currentConversationId);
  }
}

interface ConvWithOwner extends Conversation {
  _username?: string;
}

async function fetchConversationsFromSupabase(
  username: string,
  isAdmin: boolean,
  excludeConvId: string,
): Promise<ConvWithOwner[]> {
  let query = supabase
    .from('user_records')
    .select('username, data')
    .eq('table_name', 'conversations')
    .eq('deleted', false)
    .order('updated_at', { ascending: false })
    .limit(30);

  if (!isAdmin) {
    query = query.eq('username', username);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const convs: ConvWithOwner[] = [];
  for (const row of data as { username: string; data: Record<string, unknown> }[]) {
    const conv = row.data as unknown as Conversation;
    if (!conv || !conv.id || conv.id === excludeConvId) continue;
    convs.push({ ...conv, _username: row.username });
  }

  convs.sort((a, b) => b.updatedAt - a.updatedAt);
  return convs;
}

async function fetchMessagesFromSupabase(
  conversationId: string,
  owner?: string,
): Promise<Message[]> {
  let query = supabase
    .from('user_records')
    .select('data')
    .eq('table_name', 'messages')
    .eq('deleted', false);

  if (owner) {
    query = query.eq('username', owner);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const msgs: Message[] = [];
  for (const row of data as { data: Record<string, unknown> }[]) {
    const msg = row.data as unknown as Message;
    if (msg && msg.conversationId === conversationId) {
      msgs.push(msg);
    }
  }

  msgs.sort((a, b) => a.createdAt - b.createdAt);
  return msgs;
}

function buildConversationEntry(
  conv: Conversation,
  msgs: Message[],
  prefix = '',
): string | null {
  msgs.sort((a, b) => a.createdAt - b.createdAt);
  const firstUser = msgs.find((m) => m.role === 'user');
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && !!m.content.trim());
  if (!firstUser) return null;

  const ask = truncate(stripAttachments(firstUser), MAX_SNIPPET_CHARS);
  const answer = lastAssistant ? truncate(lastAssistant.content, MAX_SNIPPET_CHARS) : '';
  const date = new Date(conv.updatedAt).toISOString().slice(0, 10);
  const toolNames = collectToolNames(msgs);
  const toolsLine = toolNames.length ? `\n  Tools used: ${toolNames.join(', ')}` : '';

  return `${prefix}[${date}] "${conv.title}"\n  Asked: ${ask}${answer ? `\n  Replied: ${answer}` : ''}${toolsLine}`;
}

function formatMemoryBlock(entries: string[]): string {
  if (!entries.length) return '';

  let block = entries.map((e) => `\u2022 ${e}`).join('\n\n');
  if (block.length > MAX_TOTAL_CHARS) {
    block = block.slice(0, MAX_TOTAL_CHARS) + '\n\u2026(older conversations truncated)';
  }

  return `PRIOR-CONVERSATION MEMORY
The teacher has had earlier conversations with you. Brief summaries follow. Use these only when genuinely relevant \u2014 do NOT repeat them back unprompted. Treat them as soft context.

${block}`;
}

function stripAttachments(msg: Message): string {
  if (!msg.attachments?.length) return msg.content;
  const kinds = msg.attachments.map((a) => `[${a.kind}:${a.name}]`).join(' ');
  return `${kinds} ${msg.content}`.trim();
}

function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '\u2026' : one;
}

function collectToolNames(msgs: Message[]): string[] {
  const set = new Set<string>();
  for (const m of msgs) {
    for (const t of m.toolCalls ?? []) set.add(t.name);
  }
  return [...set].slice(0, 6);
}
