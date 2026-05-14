import type { PedagogyDB, Message } from '../../db/schema';
import { messagesRepo } from '../../db/repos';
import { offlineStream, getOfflineModel } from '../llm/webllm';
import { MAIN_SYSTEM_PROMPT } from './systemPrompt';

export interface OfflineSendOptions {
  db: PedagogyDB;
  conversationId: string;
  userMessage: Message;
  offlineModelId: string;
  onUpdate: (assistantId: string) => void;
  onUsage?: (inputTokens: number, outputTokens: number) => void;
  signal?: AbortSignal;
}

function chainToChatMessages(chain: Message[]): { role: 'user' | 'assistant' | 'system'; content: string }[] {
  return chain
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : '',
    }));
}

export async function sendMessageOffline(opts: OfflineSendOptions): Promise<void> {
  const { db, conversationId, userMessage, offlineModelId, onUpdate, onUsage, signal } = opts;

  const model = getOfflineModel(offlineModelId);
  if (!model) throw new Error(`Unknown offline model: ${offlineModelId}`);

  const chain = await messagesRepo.getActiveChain(db, conversationId);
  const history = chainToChatMessages(chain);

  const assistantMsg = await messagesRepo.create(db, {
    conversationId,
    parentId: userMessage.id,
    role: 'assistant',
    content: '',
    provider: 'anthropic',
    model: `offline:${model.id}`,
  });
  onUpdate(assistantMsg.id);

  let accumulated = '';
  let lastWrite = 0;

  try {
    await offlineStream(
      offlineModelId,
      [
        { role: 'system', content: MAIN_SYSTEM_PROMPT },
        ...history,
      ],
      (delta) => {
        accumulated += delta;
        const now = Date.now();
        if (now - lastWrite > 120) {
          lastWrite = now;
          void messagesRepo.setContent(db, assistantMsg.id, accumulated);
          onUpdate(assistantMsg.id);
        }
      },
      (inputTokens, outputTokens) => {
        void messagesRepo.setUsage(db, assistantMsg.id, { inputTokens, outputTokens });
        onUsage?.(inputTokens, outputTokens);
      },
      signal,
    );
    await messagesRepo.setContent(db, assistantMsg.id, accumulated);
    onUpdate(assistantMsg.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await messagesRepo.setContent(
      db,
      assistantMsg.id,
      accumulated + `\n\n> **Offline error:** ${message}`,
    );
    onUpdate(assistantMsg.id);
    throw err;
  }
}
