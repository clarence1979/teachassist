import type { PedagogyDB, Conversation, Message, MessageAttachment, ToolInvocation, Artifact, Task } from './schema';

// ─── ID generator ─────────────────────────────────────────────────────────────

export function uid(prefix = 'id'): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(random).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${Date.now().toString(36)}_${hex}`;
}

// ─── Conversations ────────────────────────────────────────────────────────────

export const conversationsRepo = {
  async create(db: PedagogyDB, overrides: Partial<Conversation> = {}): Promise<Conversation> {
    const now = Date.now();
    const conv: Conversation = {
      id: uid('conv'),
      title: 'New conversation',
      pinned: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    await db.conversations.add(conv);
    return conv;
  },

  async update(db: PedagogyDB, id: string, patch: Partial<Conversation>): Promise<void> {
    await db.conversations.update(id, { ...patch, updatedAt: Date.now() });
  },

  async rename(db: PedagogyDB, id: string, title: string): Promise<void> {
    await db.conversations.update(id, { title, updatedAt: Date.now() });
  },

  async togglePin(db: PedagogyDB, id: string): Promise<void> {
    const c = await db.conversations.get(id);
    if (!c) return;
    await db.conversations.update(id, { pinned: !c.pinned, updatedAt: Date.now() });
  },

  async remove(db: PedagogyDB, id: string): Promise<void> {
    // Delete the conversation row first in its own transaction so the sidebar
    // updates immediately. Then sweep messages in chunks — if any message row
    // is unusually large (e.g. inline base64 attachments) a single bulk delete
    // can stall or trip a browser IDB limit and roll everything back; chunked
    // bulkDelete keeps each operation bounded.
    await db.conversations.delete(id);

    const msgIds = await db.messages
      .where('conversationId')
      .equals(id)
      .primaryKeys();
    const CHUNK = 50;
    for (let i = 0; i < msgIds.length; i += CHUNK) {
      try {
        await db.messages.bulkDelete(msgIds.slice(i, i + CHUNK) as string[]);
      } catch (err) {
        console.warn('[conversations.remove] message cleanup chunk failed:', err);
      }
    }
  },

  async get(db: PedagogyDB, id: string): Promise<Conversation | undefined> {
    return db.conversations.get(id);
  },
};

// ─── Messages ─────────────────────────────────────────────────────────────────

export interface CreateMessageInput {
  conversationId: string;
  parentId: string | null;
  role: Message['role'];
  content: string;
  attachments?: MessageAttachment[];
  toolCalls?: ToolInvocation[];
  provider?: Message['provider'];
  model?: string;
  editedFromId?: string;
}

export const messagesRepo = {
  async create(db: PedagogyDB, input: CreateMessageInput): Promise<Message> {
    const msg: Message = {
      id: uid('msg'),
      isActive: true,
      createdAt: Date.now(),
      ...input,
    };

    await db.transaction('rw', db.messages, db.conversations, async () => {
      // Deactivate sibling branches under the same parent. This also applies
      // to root-level messages (parentId === null) so that an edited/resent
      // first message becomes the new active branch — otherwise the old root
      // would keep winning in getActiveChain and the new reply would render
      // nowhere. Dexie's compound index skips null values, so we filter in JS
      // when parentId is null.
      if (input.parentId === null) {
        await db.messages
          .where('conversationId')
          .equals(input.conversationId)
          .filter((m) => m.parentId === null || m.parentId === undefined)
          .modify({ isActive: false });
      } else {
        await db.messages
          .where({ conversationId: input.conversationId, parentId: input.parentId })
          .modify({ isActive: false });
      }

      await db.messages.add(msg);
      await db.conversations.update(input.conversationId, { updatedAt: Date.now() });
    });

    return msg;
  },

  async appendText(db: PedagogyDB, id: string, delta: string): Promise<void> {
    const m = await db.messages.get(id);
    if (!m) return;
    await db.messages.update(id, { content: m.content + delta });
  },

  async setContent(db: PedagogyDB, id: string, content: string): Promise<void> {
    await db.messages.update(id, { content });
  },

  async setToolCalls(db: PedagogyDB, id: string, toolCalls: ToolInvocation[]): Promise<void> {
    await db.messages.update(id, { toolCalls });
  },

  async setUsage(db: PedagogyDB, id: string, usage: Message['usage']): Promise<void> {
    await db.messages.update(id, { usage });
  },

  async remove(db: PedagogyDB, id: string): Promise<void> {
    await db.messages.delete(id);
  },

  /** Delete a message and every descendant in the tree. Lets the chat UI wipe
   *  a bad turn (user prompt + assistant reply + any deeper follow-ups). */
  async removeWithDescendants(db: PedagogyDB, conversationId: string, id: string): Promise<void> {
    await db.transaction('rw', db.messages, async () => {
      const all = await db.messages.where('conversationId').equals(conversationId).toArray();
      const byParent = new Map<string | null, Message[]>();
      for (const m of all) {
        const k = m.parentId;
        if (!byParent.has(k)) byParent.set(k, []);
        byParent.get(k)!.push(m);
      }
      const toDelete = new Set<string>();
      const walk = (rootId: string) => {
        toDelete.add(rootId);
        for (const child of byParent.get(rootId) ?? []) walk(child.id);
      };
      walk(id);
      await db.messages.bulkDelete([...toDelete]);
    });
  },

  async getActiveChain(db: PedagogyDB, conversationId: string): Promise<Message[]> {
    const all = await db.messages.where('conversationId').equals(conversationId).toArray();
    const byParent = new Map<string | null, Message[]>();
    for (const m of all) {
      const key = m.parentId;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(m);
    }

    const chain: Message[] = [];
    let parent: string | null = null;
    while (true) {
      const siblings: Message[] = byParent.get(parent) ?? [];
      if (!siblings.length) break;
      const active: Message =
        siblings.find((s) => s.isActive) ??
        [...siblings].sort((a, b) => b.createdAt - a.createdAt)[0];
      chain.push(active);
      parent = active.id;
    }
    return chain;
  },

  async switchBranch(db: PedagogyDB, conversationId: string, parentId: string | null, targetId: string): Promise<void> {
    await db.transaction('rw', db.messages, async () => {
      await db.messages
        .where({ conversationId, parentId: parentId as string | null })
        .modify({ isActive: false });
      await db.messages.update(targetId, { isActive: true });
    });
  },

  async getSiblings(db: PedagogyDB, conversationId: string, parentId: string | null): Promise<Message[]> {
    return db.messages
      .where({ conversationId, parentId: parentId as string | null })
      .toArray()
      .then((arr) => arr.sort((a, b) => a.createdAt - b.createdAt));
  },
};

// ─── Artifacts ────────────────────────────────────────────────────────────────

export interface CreateArtifactInput {
  type: Artifact['type'];
  title: string;
  data: string;
  mediaType: string;
  meta: Record<string, unknown>;
  conversationId?: string;
  /** Supply existing groupId + next version when regenerating */
  groupId?: string;
  version?: number;
  tags?: string[];
}

export const artifactsRepo = {
  async create(db: PedagogyDB, input: CreateArtifactInput): Promise<Artifact> {
    const id = uid('art');
    const artifact: Artifact = {
      id,
      createdAt: Date.now(),
      groupId: input.groupId ?? id,
      version: input.version ?? 1,
      ...input,
    };
    await db.artifacts.add(artifact);
    return artifact;
  },

  async get(db: PedagogyDB, id: string): Promise<Artifact | undefined> {
    return db.artifacts.get(id);
  },

  async list(db: PedagogyDB): Promise<Artifact[]> {
    const all = await db.artifacts.toArray();
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },

  async getVersions(db: PedagogyDB, groupId: string): Promise<Artifact[]> {
    const all = await db.artifacts.where('groupId').equals(groupId).toArray();
    return all.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
  },

  async createNextVersion(db: PedagogyDB, groupId: string, input: Omit<CreateArtifactInput, 'groupId' | 'version'>): Promise<Artifact> {
    const existing = await db.artifacts.where('groupId').equals(groupId).toArray();
    const nextVersion = existing.reduce((max, a) => Math.max(max, a.version ?? 1), 0) + 1;
    return artifactsRepo.create(db, { ...input, groupId, version: nextVersion });
  },

  async remove(db: PedagogyDB, id: string): Promise<void> {
    await db.artifacts.delete(id);
  },

  async removeGroup(db: PedagogyDB, groupId: string): Promise<void> {
    await db.artifacts.where('groupId').equals(groupId).delete();
  },

  async updateMeta(db: PedagogyDB, id: string, meta: Record<string, unknown>): Promise<void> {
    await db.artifacts.update(id, { meta });
  },

  async updateTags(db: PedagogyDB, id: string, tags: string[]): Promise<void> {
    await db.artifacts.update(id, { tags });
  },
};

// ─── Tasks ────────────────────────────────────────────────────────────────────

export type CreateTaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;

export const tasksRepo = {
  async create(db: PedagogyDB, input: CreateTaskInput): Promise<Task> {
    const now = Date.now();
    const task: Task = { id: uid('task'), createdAt: now, updatedAt: now, ...input };
    await db.tasks.add(task);
    return task;
  },

  async update(db: PedagogyDB, id: string, patch: Partial<Task>): Promise<void> {
    await db.tasks.update(id, { ...patch, updatedAt: Date.now() });
  },

  async remove(db: PedagogyDB, id: string): Promise<void> {
    await db.tasks.delete(id);
  },

  async list(db: PedagogyDB): Promise<Task[]> {
    const all = await db.tasks.toArray();
    return all.sort((a, b) => a.priority - b.priority || (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || b.createdAt - a.createdAt);
  },

  async get(db: PedagogyDB, id: string): Promise<Task | undefined> {
    return db.tasks.get(id);
  },

  async bulkRemove(db: PedagogyDB, ids: string[]): Promise<void> {
    await db.tasks.bulkDelete(ids);
  },

  async bulkUpdate(db: PedagogyDB, ids: string[], patch: Partial<Task>): Promise<void> {
    const now = Date.now();
    await Promise.all(ids.map((id) => db.tasks.update(id, { ...patch, updatedAt: now })));
  },
};
