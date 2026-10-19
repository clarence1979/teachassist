import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles, AlertCircle, Paperclip, X as XIcon, MessageSquare } from 'lucide-react';
import { useDb, useAdminDb } from '../db/DbContext';
import { useCredentials } from '../contexts/CredentialsContext';
import { useAppStore } from '../store/appStore';
import { useMobile } from '../lib/useMobile';
import { ConversationList } from '../components/chat/ConversationList';
import { MessageItem } from '../components/chat/MessageItem';
import { Composer, type PendingAttachment } from '../components/chat/Composer';
import { QuickPrompts } from '../components/chat/QuickPrompts';
import { conversationsRepo, messagesRepo, uid } from '../db/repos';
import type { Message, MessageAttachment, Artifact } from '../db/schema';
import { sendMessage, createUserMessage } from '../lib/chat/engine';
import { sendMessageOffline } from '../lib/chat/offlineEngine';
import { ArtifactPreviewModal } from '../components/ArtifactPreviewModal';

function attachmentsFromPending(pending: PendingAttachment[]): MessageAttachment[] {
  return pending.map((p) => ({
    id: uid('att'),
    kind: p.kind,
    name: p.name,
    mediaType: p.mediaType,
    data: p.data,
    size: p.size,
  }));
}

export function ChatView() {
  const db = useDb();
  const { getKey, providers } = useCredentials();
  const { viewedAsUser } = useAdminDb();
  const { activeProvider, activeModel, setActiveModel, offlineModelId, addUsage, lastGeneratedArtifactId, clearGeneratedArtifact, memoryEnabled } = useAppStore();

  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  // Per-conversation abort controllers — keyed by conversationId.
  // A conversation is "busy" when it has an entry in this map.
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  // React state version so renders update when busy set changes.
  const [busyConvIds, setBusyConvIds] = useState<ReadonlySet<string>>(new Set());

  const setConvBusy = useCallback((convId: string, controller: AbortController) => {
    abortControllersRef.current.set(convId, controller);
    setBusyConvIds(new Set(abortControllersRef.current.keys()));
  }, []);

  const setConvIdle = useCallback((convId: string) => {
    abortControllersRef.current.delete(convId);
    setBusyConvIds(new Set(abortControllersRef.current.keys()));
  }, []);

  // Per-conversation send errors (only shown for the active conversation)
  const [sendErrors, setSendErrors] = useState<Map<string, string>>(new Map());
  const sendError = activeConvId ? (sendErrors.get(activeConvId) ?? null) : null;
  const setSendError = useCallback((convId: string, err: string | null) => {
    setSendErrors((prev) => {
      const next = new Map(prev);
      if (err === null) next.delete(convId);
      else next.set(convId, err);
      return next;
    });
  }, []);

  const [composerSeed, setComposerSeed] = useState<string | undefined>(undefined);
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleStop = useCallback(() => {
    if (!activeConvId) return;
    abortControllersRef.current.get(activeConvId)?.abort();
  }, [activeConvId]);

  const busy = activeConvId ? busyConvIds.has(activeConvId) : false;

  const handleDeleteMessage = useCallback(
    async (msg: Message) => {
      if (!activeConvId) return;
      if (busyConvIds.has(activeConvId)) {
        abortControllersRef.current.get(activeConvId)?.abort();
      }
      await messagesRepo.removeWithDescendants(db, activeConvId, msg.id);
    },
    [db, activeConvId, busyConvIds],
  );

  const conversations = useLiveQuery(
    () => db.conversations.orderBy('updatedAt').reverse().toArray(),
    [db],
  );

  // Auto-select most recent conversation on mount
  useEffect(() => {
    if (activeConvId === null && conversations && conversations.length > 0) {
      setActiveConvId(conversations[0].id);
    }
  }, [conversations, activeConvId]);

  // Live messages for active conversation
  const allMessages: Message[] = useLiveQuery(
    async () => {
      if (!activeConvId) return [] as Message[];
      return db.messages.where('conversationId').equals(activeConvId).toArray();
    },
    [db, activeConvId],
    [] as Message[],
  );

  // All artifacts (live) to resolve per-message artifact IDs
  const allArtifacts: Artifact[] = useLiveQuery(
    () => db.artifacts.toArray(),
    [db],
    [],
  );

  // Build active chain + siblings map
  const { chain, siblingsByMsgId } = React.useMemo(() => {
    const byParent = new Map<string | null, Message[]>();
    for (const m of allMessages) {
      const k = m.parentId;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(m);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.createdAt - b.createdAt);

    const chainArr: Message[] = [];
    let parent: string | null = null;
    while (true) {
      const siblings: Message[] = byParent.get(parent) ?? [];
      if (!siblings.length) break;
      const active: Message =
        siblings.find((s) => s.isActive) ?? siblings[siblings.length - 1];
      chainArr.push(active);
      parent = active.id;
    }

    const siblingsMap = new Map<string, Message[]>();
    for (const m of chainArr) {
      siblingsMap.set(m.id, byParent.get(m.parentId) ?? [m]);
    }

    return { chain: chainArr, siblingsByMsgId: siblingsMap };
  }, [allMessages]);

  // Build artifact lookup map
  const artifactById = React.useMemo(() => {
    const map = new Map<string, Artifact>();
    for (const a of allArtifacts) map.set(a.id, a);
    return map;
  }, [allArtifacts]);

  // Auto-scroll to bottom on new content (only for the active conversation)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chain.length, chain[chain.length - 1]?.content]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleCreateConversation = useCallback(async () => {
    const conv = await conversationsRepo.create(db, {
      provider: activeProvider,
      model: activeModel,
    });
    setActiveConvId(conv.id);
    setSendError(conv.id, null);
  }, [db, activeProvider, activeModel, setSendError]);

  const doSend = useCallback(
    async (conversationId: string, parentId: string | null, text: string, attachments: MessageAttachment[]) => {
      if (offlineModelId) {
        setSendError(conversationId, null);
        const controller = new AbortController();
        setConvBusy(conversationId, controller);
        try {
          const userMsg = await createUserMessage(db, conversationId, parentId, text, attachments);
          await sendMessageOffline({
            db,
            conversationId,
            userMessage: userMsg,
            offlineModelId,
            memoryEnabled,
            username: viewedAsUser,
            onUpdate: () => { /* live */ },
          });
        } catch (err) {
          setSendError(conversationId, err instanceof Error ? err.message : String(err));
        } finally {
          setConvIdle(conversationId);
        }
        return;
      }

      const apiKey = getKey(activeProvider);
      if (!apiKey) {
        setSendError(conversationId, `No API key for ${activeProvider}. Open Settings to add one.`);
        return;
      }
      setSendError(conversationId, null);
      const controller = new AbortController();
      setConvBusy(conversationId, controller);
      try {
        const userMsg = await createUserMessage(db, conversationId, parentId, text, attachments);
        await sendMessage({
          db,
          conversationId,
          userMessage: userMsg,
          provider: activeProvider,
          model: activeModel,
          apiKey,
          anthropicKey: getKey('anthropic'),
          openaiKey: getKey('openai'),
          onUpdate: () => { /* live query handles re-render */ },
          onUsage: (i, o) => addUsage(activeProvider, i, o),
          onModelSwitch: setActiveModel,
          memoryEnabled,
          username: viewedAsUser,
          signal: controller.signal,
        });
      } catch (err) {
        setSendError(conversationId, err instanceof Error ? err.message : String(err));
      } finally {
        setConvIdle(conversationId);
      }
    },
    [db, getKey, activeProvider, activeModel, offlineModelId, addUsage, memoryEnabled, viewedAsUser, setConvBusy, setConvIdle, setSendError],
  );

  const handleSend = useCallback(
    async (text: string, pending: PendingAttachment[]) => {
      let convId = activeConvId;
      if (!convId) {
        const conv = await conversationsRepo.create(db, { provider: activeProvider, model: activeModel });
        convId = conv.id;
        setActiveConvId(convId);
      }
      const parentId = chain.length ? chain[chain.length - 1].id : null;
      await doSend(convId, parentId, text, attachmentsFromPending(pending));
    },
    [activeConvId, chain, db, activeProvider, activeModel, doSend],
  );

  const handleRegenerate = useCallback(
    async (assistantMsg: Message) => {
      if (!activeConvId) return;
      const parentId = assistantMsg.parentId;
      if (!parentId) return;
      const parentMsg = allMessages.find((m) => m.id === parentId);
      if (!parentMsg) return;

      if (offlineModelId) {
        setSendError(activeConvId, null);
        const controller = new AbortController();
        setConvBusy(activeConvId, controller);
        try {
          await sendMessageOffline({
            db,
            conversationId: activeConvId,
            userMessage: parentMsg,
            offlineModelId,
            memoryEnabled,
            username: viewedAsUser,
            onUpdate: () => { /* live */ },
          });
        } catch (err) {
          setSendError(activeConvId, err instanceof Error ? err.message : String(err));
        } finally {
          setConvIdle(activeConvId);
        }
        return;
      }

      const apiKey = getKey(activeProvider);
      if (!apiKey) {
        setSendError(activeConvId, `No API key for ${activeProvider}.`);
        return;
      }
      setSendError(activeConvId, null);
      const controller = new AbortController();
      setConvBusy(activeConvId, controller);
      try {
        await sendMessage({
          db,
          conversationId: activeConvId,
          userMessage: parentMsg,
          provider: activeProvider,
          model: activeModel,
          apiKey,
          anthropicKey: getKey('anthropic'),
          openaiKey: getKey('openai'),
          onUpdate: () => { /* live */ },
          onUsage: (i, o) => addUsage(activeProvider, i, o),
          onModelSwitch: setActiveModel,
          memoryEnabled,
          username: viewedAsUser,
          signal: controller.signal,
        });
      } catch (err) {
        setSendError(activeConvId, err instanceof Error ? err.message : String(err));
      } finally {
        setConvIdle(activeConvId);
      }
    },
    [activeConvId, allMessages, db, getKey, activeProvider, activeModel, offlineModelId, addUsage, memoryEnabled, viewedAsUser, setConvBusy, setConvIdle, setSendError],
  );

  const handleEdit = useCallback(
    async (oldUserMsg: Message, newText: string) => {
      if (!activeConvId) return;
      const newUserMsg = await messagesRepo.create(db, {
        conversationId: activeConvId,
        parentId: oldUserMsg.parentId,
        role: 'user',
        content: newText,
        attachments: oldUserMsg.attachments,
        editedFromId: oldUserMsg.id,
      });
      if (offlineModelId) {
        setSendError(activeConvId, null);
        const controller = new AbortController();
        setConvBusy(activeConvId, controller);
        try {
          await sendMessageOffline({
            db,
            conversationId: activeConvId,
            userMessage: newUserMsg,
            offlineModelId,
            memoryEnabled,
            username: viewedAsUser,
            onUpdate: () => { /* live */ },
          });
        } catch (err) {
          setSendError(activeConvId, err instanceof Error ? err.message : String(err));
        } finally {
          setConvIdle(activeConvId);
        }
        return;
      }

      const apiKey = getKey(activeProvider);
      if (!apiKey) {
        setSendError(activeConvId, `No API key for ${activeProvider}.`);
        return;
      }
      setSendError(activeConvId, null);
      const controller = new AbortController();
      setConvBusy(activeConvId, controller);
      try {
        await sendMessage({
          db,
          conversationId: activeConvId,
          userMessage: newUserMsg,
          provider: activeProvider,
          model: activeModel,
          apiKey,
          anthropicKey: getKey('anthropic'),
          openaiKey: getKey('openai'),
          onUpdate: () => { /* live */ },
          onUsage: (i, o) => addUsage(activeProvider, i, o),
          onModelSwitch: setActiveModel,
          memoryEnabled,
          username: viewedAsUser,
          signal: controller.signal,
        });
      } catch (err) {
        setSendError(activeConvId, err instanceof Error ? err.message : String(err));
      } finally {
        setConvIdle(activeConvId);
      }
    },
    [activeConvId, db, getKey, activeProvider, activeModel, offlineModelId, addUsage, memoryEnabled, viewedAsUser, setConvBusy, setConvIdle, setSendError],
  );

  const handleSwitchBranch = useCallback(
    async (msg: Message, targetId: string) => {
      if (!activeConvId) return;
      await messagesRepo.switchBranch(db, activeConvId, msg.parentId, targetId);
    },
    [db, activeConvId],
  );

  // Attach a generated artifact to the last message in the active conversation
  const attachArtifactToLastMessage = useCallback(async (artifactId: string) => {
    if (!activeConvId) return;
    const lastMessage = chain[chain.length - 1];
    if (!lastMessage) return;
    const existing = new Set(lastMessage.artifactIds ?? []);
    existing.add(artifactId);
    await db.messages.update(lastMessage.id, { artifactIds: [...existing] });
    clearGeneratedArtifact();
  }, [activeConvId, chain, db, clearGeneratedArtifact]);

  // ─── Render ──────────────────────────────────────────────────────────────

  const hasAnyKey = providers.length > 0;
  const lastMsg = chain[chain.length - 1];
  const streamingMsgId =
    busy && lastMsg?.role === 'assistant' ? lastMsg.id : null;
  const isMobile = useMobile();
  const [mobileConvOpen, setMobileConvOpen] = useState(false);

  return (
    <div className="flex flex-1 min-h-0 relative">
      {/* Desktop: inline conversation list */}
      {!isMobile && (
        <ConversationList
          activeId={activeConvId}
          busyConvIds={busyConvIds}
          onSelect={(id) => { setActiveConvId(id); }}
          onCreate={handleCreateConversation}
        />
      )}

      {/* Mobile: slide-over drawer */}
      {isMobile && mobileConvOpen && (
        <div
          className="absolute inset-0 z-40 flex"
          onClick={() => setMobileConvOpen(false)}
        >
          <div
            className="w-72 h-full flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <ConversationList
              activeId={activeConvId}
              busyConvIds={busyConvIds}
              onSelect={(id) => {
                setActiveConvId(id);
                setMobileConvOpen(false);
              }}
              onCreate={async () => {
                await handleCreateConversation();
                setMobileConvOpen(false);
              }}
            />
          </div>
          <div className="flex-1 bg-black/60 backdrop-blur-sm" />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile: conversation drawer toggle bar */}
        {isMobile && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-panel shrink-0">
            <button
              onClick={() => setMobileConvOpen(true)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-btn border border-border text-text-dim hover:text-accent-cyan hover:border-accent-cyan transition-colors"
              aria-label="Open conversations"
            >
              <MessageSquare size={14} />
              <span className="text-xs font-rajdhani font-semibold">Conversations</span>
            </button>
            <button
              onClick={handleCreateConversation}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-btn bg-accent-cyan text-bg-base text-xs font-rajdhani font-bold uppercase tracking-wider hover:brightness-110 transition-colors"
            >
              + New
            </button>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!activeConvId || chain.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3 grid-bg">
              <div className="p-4 rounded-full bg-bg-elevated border border-border">
                <Sparkles size={28} className="text-accent-cyan" />
              </div>
              <h1 className="font-orbitron text-xl font-bold text-text-primary">
                How can I help today?
              </h1>
              <p className="text-sm text-text-secondary max-w-md">
                Ask anything about teaching — I can plan lessons, generate slides, worksheets, quizzes and more.
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-2 divide-y divide-border/30">
              {chain.map((m) => {
                const msgArtifacts = (m.artifactIds ?? [])
                  .map((id) => artifactById.get(id))
                  .filter((a): a is Artifact => !!a);
                return (
                  <MessageItem
                    key={m.id}
                    message={m}
                    siblings={siblingsByMsgId.get(m.id) ?? [m]}
                    artifacts={msgArtifacts}
                    isStreaming={m.id === streamingMsgId}
                    onRegenerate={m.role === 'assistant' ? () => handleRegenerate(m) : undefined}
                    onEdit={
                      m.role === 'user'
                        ? (newText) => handleEdit(m, newText)
                        : undefined
                    }
                    onSwitchBranch={(targetId) => handleSwitchBranch(m, targetId)}
                    onDelete={() => handleDeleteMessage(m)}
                    onStop={m.id === streamingMsgId ? handleStop : undefined}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Generated artifact notification banner */}
        {lastGeneratedArtifactId && (
          <div className="flex items-center gap-2 px-4 py-2 bg-accent-amber/10 border-t border-accent-amber/40">
            <Paperclip size={13} className="text-accent-amber shrink-0" />
            <span className="text-xs text-accent-amber flex-1">
              Material generated and saved to library.
            </span>
            <button
              onClick={() => setPreviewArtifactId(lastGeneratedArtifactId)}
              className="px-2.5 py-1 rounded-btn border border-accent-amber/60 text-[10px] font-rajdhani font-semibold uppercase tracking-wider text-accent-amber hover:bg-accent-amber/10 transition-colors shrink-0"
            >
              Preview &amp; assign
            </button>
            {chain.length > 0 && (
              <button
                onClick={() => attachArtifactToLastMessage(lastGeneratedArtifactId)}
                className="px-2.5 py-1 rounded-btn border border-accent-cyan/60 text-[10px] font-rajdhani font-semibold uppercase tracking-wider text-accent-cyan hover:bg-accent-cyan/10 transition-colors shrink-0"
              >
                Add to this chat
              </button>
            )}
            <button
              onClick={clearGeneratedArtifact}
              className="p-1 text-accent-amber/60 hover:text-accent-amber transition-colors"
            >
              <XIcon size={12} />
            </button>
          </div>
        )}

        {/* Error banner */}
        {sendError && (
          <div className="flex items-start gap-2 px-4 py-2 bg-accent-red/10 border-t border-accent-red/40">
            <AlertCircle size={13} className="text-accent-red mt-0.5 shrink-0" />
            <span className="text-xs text-accent-red font-mono flex-1">{sendError}</span>
            <button
              onClick={() => activeConvId && setSendError(activeConvId, null)}
              className="text-xs text-accent-red hover:underline"
            >
              dismiss
            </button>
          </div>
        )}

        {!hasAnyKey && (
          <div className="flex items-start gap-2 px-4 py-2 bg-accent-amber/10 border-t border-accent-amber/40">
            <AlertCircle size={13} className="text-accent-amber mt-0.5 shrink-0" />
            <span className="text-xs text-accent-amber">
              No API key configured. Open <strong>Settings</strong> to add one.
            </span>
          </div>
        )}

        <QuickPrompts onPick={(p) => setComposerSeed(p)} compact={isMobile} />
        <Composer
          onSend={handleSend}
          onStop={handleStop}
          busy={busy}
          initialValue={composerSeed}
          compact={isMobile}
        />
      </div>

      {previewArtifactId && (
        <ArtifactPreviewModal
          artifactId={previewArtifactId}
          onClose={() => setPreviewArtifactId(null)}
        />
      )}
    </div>
  );
}
