import { useEffect, useRef } from 'react';
import { Edit3, Copy, Trash2, Repeat, Paperclip, Check, XCircle } from 'lucide-react';

export interface ContextMenuItem {
  label: string;
  icon?: typeof Edit3;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  // Clamp to viewport
  const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 600;
  const clampedX = Math.min(x, vw - 220);
  const clampedY = Math.min(y, vh - items.length * 32 - 16);

  return (
    <div
      ref={ref}
      className="fixed z-[70] min-w-[200px] bg-bg-panel border border-border rounded-lg shadow-2xl py-1"
      style={{ left: clampedX, top: clampedY }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.separator) return <div key={i} className="my-1 border-t border-border" />;
        const Icon = item.icon;
        return (
          <button
            key={i}
            onClick={() => { item.onClick(); onClose(); }}
            className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors hover:bg-bg-elevated ${item.danger ? 'text-red-400 hover:text-red-300' : 'text-text-secondary hover:text-text-primary'}`}
          >
            {Icon && <Icon size={12} />}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export { Edit3, Copy, Trash2, Repeat, Paperclip, Check, XCircle };
