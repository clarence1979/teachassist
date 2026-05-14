import { useNavigate, useLocation } from 'react-router-dom';
import { MessageSquare, Wand2, CheckSquare, Calendar, BookOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../contexts/CredentialsContext';
import { useMobile } from '../lib/useMobile';

const NAV_ITEMS = [
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/studio', icon: Wand2, label: 'Studio' },
  { path: '/todo', icon: CheckSquare, label: 'To-Do' },
  { path: '/timetable', icon: Calendar, label: 'Timetable' },
  { path: '/library', icon: BookOpen, label: 'Library' },
];

export function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isIframe } = useCredentials();
  const isMobile = useMobile();

  // In landscape on a phone the bottom nav takes up precious vertical space —
  // use a condensed layout (icons only, no labels, less padding).
  const isLandscape = typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
  const compact = isIframe && isMobile && isLandscape;

  return (
    <nav
      className="shrink-0 bg-bg-panel border-t border-border flex items-stretch"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Main navigation"
    >
      {NAV_ITEMS.map(({ path, icon: Icon, label }) => {
        const isActive = location.pathname === path;
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            className={clsx(
              'flex-1 flex flex-col items-center justify-center transition-colors',
              compact ? 'py-1.5 gap-0' : 'py-2 gap-1',
              isActive
                ? 'text-accent-cyan'
                : 'text-text-dim hover:text-text-secondary active:text-accent-cyan',
            )}
          >
            <Icon size={compact ? 18 : 20} />
            {!compact && (
              <span className="text-[10px] font-rajdhani font-semibold tracking-wide">{label}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
