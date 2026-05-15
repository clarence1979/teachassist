import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  MessageSquare, Wand2, CheckSquare, Calendar, BookOpen,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ContextPanel } from './ContextPanel';
import { BottomNav } from './BottomNav';
import { useAppStore } from '../store/appStore';
import { useMobile } from '../lib/useMobile';
import { useOrientation } from '../lib/useOrientation';
import { useCredentials } from '../contexts/CredentialsContext';

const NAV_ITEMS = [
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/studio', icon: Wand2, label: 'Studio' },
  { path: '/todo', icon: CheckSquare, label: 'To-Do' },
  { path: '/timetable', icon: Calendar, label: 'Timetable' },
  { path: '/library', icon: BookOpen, label: 'Library' },
];

/** Compact side-rail used in mobile landscape — icons + tiny labels */
function LandscapeRail() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <nav
      className="shrink-0 w-14 flex flex-col bg-bg-panel border-r border-border"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
      }}
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
              'flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors',
              isActive ? 'text-accent-cyan' : 'text-text-dim hover:text-text-secondary',
            )}
          >
            <Icon size={18} />
            <span className="text-[8px] font-rajdhani font-semibold tracking-wide leading-none">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function AppShell() {
  const reducedMotion = useAppStore((s) => s.reducedMotion);
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore();
  const isMobile = useMobile();
  const orientation = useOrientation();
  const { isIframe } = useCredentials();

  const isLandscape = isMobile && orientation === 'landscape';

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
  }, [reducedMotion]);

  useEffect(() => {
    if (isMobile && !sidebarCollapsed) setSidebarCollapsed(true);
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  const heightClass = isIframe && isMobile ? 'h-[100svh]' : 'h-[100dvh]';

  // ── Desktop ────────────────────────────────────────────────────────────────
  if (!isMobile) {
    return (
      <div className={`flex ${heightClass} overflow-hidden bg-bg-base`}>
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <TopBar />
          <div className="flex flex-1 overflow-hidden min-h-0">
            <main className="flex-1 flex overflow-hidden min-w-0">
              <Outlet />
            </main>
            <ContextPanel />
          </div>
        </div>
      </div>
    );
  }

  // ── Mobile landscape — side rail + slim top bar, no bottom nav ────────────
  if (isLandscape) {
    return (
      <div
        className={`flex flex-row ${heightClass} overflow-hidden bg-bg-base`}
        style={{ maxHeight: '-webkit-fill-available' }}
      >
        <LandscapeRail />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <TopBar landscape />
          <main className="flex-1 flex overflow-hidden min-w-0 min-h-0">
            <Outlet />
          </main>
          {/* Thin utility bar: Appearance + Context buttons */}
          <BottomNav landscapeBar />
        </div>
      </div>
    );
  }

  // ── Mobile portrait ────────────────────────────────────────────────────────
  return (
    <div
      className={`flex flex-col ${heightClass} overflow-hidden bg-bg-base`}
      style={{ maxHeight: '-webkit-fill-available' }}
    >
      <TopBar />
      <main className="flex-1 flex overflow-hidden min-w-0 min-h-0">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
