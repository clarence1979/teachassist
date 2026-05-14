import { useState } from 'react';
import { clsx } from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Plus,
  Pin,
  PinOff,
  MoreVertical,
  Pencil,
  Trash2,
  MessageSquare,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useDb } from '../../db/DbContext';
import { conversationsRepo } from '../../db/repos';
import type { Conversation } from '../../db/schema';
import { useAppStore } from '../../store/appStore';

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => Promise<void>;
}

export function ConversationList({ activeId, onSelect, onCreate }: Props) {
  const db = useDb();
  const { conversationListCollapsed, toggleConversationList } = useAppStore();
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const conversations = useLiveQuery(
    () => db.conversations.orderBy('updatedAt').reverse().toArray(),
    [db],
  ) ?? [];

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase()),
  );
  const pinned = filtered.filter((c) => c.pinned);
  const unpinned = filtered.filter((c) => !c.pinned);

  const handleRename = async (id: string) => {
    if (renameValue.trim()) {
      await conversationsRepo.rename(db, id, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this conversation? This cannot be undone.')) return;
    await conversationsRepo.remove(db, id);
    if (activeId === id) {
      const next = conversations.find((c) => c.id !== id);
      if (next) onSelect(next.id);
    }
    setMenuFor(null);
  };

  const renderRow = (c: Conversation) => {
    const isActive = c.id === activeId;
    const isRenaming = renamingId === c.id;

    return (
      <li key={c.id} className="relative group">
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => handleRename(c.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename(c.id);
              if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
            }}
            className="w-full bg-bg-elevated border border-accent-cyan rounded-btn px-3 py-1.5 font-inter text-xs text-text-primary outline-none caret-accent-cyan"
          />
        ) : (
          <button
            onClick={() => onSelect(c.id)}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-1.5 rounded-btn text-left transition-colors',
              isActive
                ? 'bg-bg-elevated text-text-primary border border-border'
                : 'text-text-secondary hover:bg-bg-elevated border border-transparent',
            )}
          >
            {c.pinned && <Pin size={10} className="text-accent-cyan shrink-0" />}
            <span className="text-xs truncate flex-1">{c.title}</span>
          </button>
        )}

        {!isRenaming && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuFor(menuFor === c.id ? null : c.id);
            }}
            aria-label="Conversation options"
            className={clsx(
              'absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-btn',
              'opacity-0 group-hover:opacity-100 transition-opacity',
              'text-text-dim hover:text-text-primary hover:bg-bg-panel',
              menuFor === c.id && 'opacity-100',
            )}
          >
            <MoreVertical size={12} />
          </button>
        )}

        {menuFor === c.id && (
          <div className="absolute right-1 top-full mt-1 z-20 bg-bg-elevated border border-border rounded shadow-xl min-w-32">
            <button
              onClick={() => {
                conversationsRepo.togglePin(db, c.id);
                setMenuFor(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:text-accent-cyan hover:bg-bg-panel transition-colors"
            >
              {c.pinned ? <PinOff size={11} /> : <Pin size={11} />}
              {c.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              onClick={() => {
                setRenamingId(c.id);
                setRenameValue(c.title);
                setMenuFor(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:text-accent-cyan hover:bg-bg-panel transition-colors"
            >
              <Pencil size={11} /> Rename
            </button>
            <button
              onClick={() => handleDelete(c.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-accent-red hover:bg-bg-panel transition-colors border-t border-border"
            >
              <Trash2 size={11} /> Delete
            </button>
          </div>
        )}
      </li>
    );
  };

  // ─── Collapsed state: icon strip ─────────────────────────────────────────

  if (conversationListCollapsed) {
    return (
      <aside className="w-10 shrink-0 flex flex-col bg-bg-panel border-r border-border transition-all duration-200">
        {/* Expand button */}
        <button
          onClick={toggleConversationList}
          aria-label="Expand conversation list"
          title="Expand conversations"
          className="p-2 flex items-center justify-center text-text-dim hover:text-accent-cyan hover:bg-bg-elevated transition-colors border-b border-border"
        >
          <ChevronRight size={14} />
        </button>

        {/* New conversation */}
        <button
          onClick={onCreate}
          aria-label="New conversation"
          title="New conversation"
          className="p-2 flex items-center justify-center text-text-dim hover:text-accent-cyan hover:bg-bg-elevated transition-colors"
        >
          <Plus size={14} />
        </button>

        {/* Conversation dots */}
        <div className="flex-1 overflow-y-auto py-1 flex flex-col items-center gap-1">
          {conversations.slice(0, 20).map((c) => {
            const isActive = c.id === activeId;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                title={c.title}
                className={clsx(
                  'w-6 h-6 rounded-btn flex items-center justify-center transition-colors',
                  isActive
                    ? 'bg-bg-elevated border border-border text-accent-cyan'
                    : 'text-text-dim hover:text-text-primary hover:bg-bg-elevated',
                )}
              >
                {c.pinned
                  ? <Pin size={10} className="text-accent-cyan" />
                  : <MessageSquare size={10} />
                }
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  // ─── Expanded state ───────────────────────────────────────────────────────

  return (
    <aside className="w-60 shrink-0 flex flex-col bg-bg-panel border-r border-border transition-all duration-200">
      <div className="p-3 space-y-2 border-b border-border">
        <div className="flex items-center gap-2">
          <button
            onClick={onCreate}
            className="flex-1 flex items-center gap-2 px-3 py-2 bg-bg-elevated border border-border rounded-btn text-xs font-rajdhani font-semibold text-text-primary hover:border-accent-cyan hover:text-accent-cyan transition-colors"
          >
            <Plus size={13} /> New conversation
          </button>
          <button
            onClick={toggleConversationList}
            aria-label="Collapse conversation list"
            title="Collapse"
            className="p-2 rounded-btn text-text-dim hover:text-accent-cyan hover:bg-bg-elevated transition-colors shrink-0"
          >
            <ChevronLeft size={14} />
          </button>
        </div>

        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="w-full pl-7 pr-2 py-1.5 bg-bg-elevated border border-border rounded-btn text-xs font-inter text-text-primary placeholder:text-text-dim focus:border-accent-cyan outline-none caret-accent-cyan"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
            <MessageSquare size={20} className="text-text-dim" />
            <p className="text-xs text-text-dim">
              {query ? 'No matches' : 'No conversations yet'}
            </p>
          </div>
        )}

        {pinned.length > 0 && (
          <>
            <div className="px-2 py-1 text-xs font-rajdhani font-semibold text-text-dim uppercase tracking-wider">
              Pinned
            </div>
            <ul className="space-y-0.5 mb-3">{pinned.map(renderRow)}</ul>
          </>
        )}

        {unpinned.length > 0 && (
          <>
            {pinned.length > 0 && (
              <div className="px-2 py-1 text-xs font-rajdhani font-semibold text-text-dim uppercase tracking-wider">
                Recent
              </div>
            )}
            <ul className="space-y-0.5">{unpinned.map(renderRow)}</ul>
          </>
        )}
      </div>
    </aside>
  );
}
