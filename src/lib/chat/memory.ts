import type { PedagogyDB, Message } from '../../db/schema';

const MAX_CONVERSATIONS = 8;
const MAX_SNIPPET_CHARS = 320;
const MAX_TOTAL_CHARS = 3500;

/**
 * Build a compact "memory" block from prior conversations, so the AI can
 * reference things the teacher has been working on across sessions.
 * Returns an empty string if there is nothing useful to include.
 */
export async function buildMemoryContext(
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

    msgs.sort((a, b) => a.createdAt - b.createdAt);
    const firstUser = msgs.find((m) => m.role === 'user');
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && !!m.content.trim());
    if (!firstUser) continue;

    const ask = truncate(stripAttachments(firstUser), MAX_SNIPPET_CHARS);
    const answer = lastAssistant ? truncate(lastAssistant.content, MAX_SNIPPET_CHARS) : '';
    const date = new Date(conv.updatedAt).toISOString().slice(0, 10);
    const toolNames = collectToolNames(msgs);
    const toolsLine = toolNames.length ? `\n  Tools used: ${toolNames.join(', ')}` : '';

    entries.push(
      `• [${date}] "${conv.title}"\n  Asked: ${ask}${answer ? `\n  Replied: ${answer}` : ''}${toolsLine}`,
    );
  }

  if (!entries.length) return '';

  let block = entries.join('\n\n');
  if (block.length > MAX_TOTAL_CHARS) {
    block = block.slice(0, MAX_TOTAL_CHARS) + '\n…(older conversations truncated)';
  }

  return `PRIOR-CONVERSATION MEMORY
The teacher has had earlier conversations with you. Brief summaries follow. Use these only when genuinely relevant — do NOT repeat them back unprompted. Treat them as soft context.

${block}`;
}

function stripAttachments(msg: Message): string {
  if (!msg.attachments?.length) return msg.content;
  const kinds = msg.attachments.map((a) => `[${a.kind}:${a.name}]`).join(' ');
  return `${kinds} ${msg.content}`.trim();
}

function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

function collectToolNames(msgs: Message[]): string[] {
  const set = new Set<string>();
  for (const m of msgs) {
    for (const t of m.toolCalls ?? []) set.add(t.name);
  }
  return [...set].slice(0, 6);
}
