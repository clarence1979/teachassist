import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ContextPanel } from './ContextPanel';
import { BottomNav } from './BottomNav';
import { useAppStore } from '../store/appStore';
import { useMobile } from '../lib/useMobile';
import { useCredentials } from '../contexts/CredentialsContext';

export function AppShell() {
  const reducedMotion = useAppStore((s) => s.reducedMotion);
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore();
  const isMobile = useMobile();
  const { isIframe } = useCredentials();

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
  }, [reducedMotion]);

  // Auto-collapse sidebar on mobile
  useEffect(() => {
    if (isMobile && !sidebarCollapsed) {
      setSidebarCollapsed(true);
    }
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  // In iframe on iOS, 100dvh can still exceed the visible area during orientation
  // transitions. Use 100svh (small viewport height) for iframe so the shell is
  // always within the visible viewport regardless of browser chrome state.
  const heightClass = isIframe && isMobile ? 'h-[100svh]' : 'h-[100dvh]';

  return (
    <div
      className={`flex ${heightClass} overflow-hidden bg-bg-base`}
      // Ensure layout recalculates on orientation change
      style={{ maxHeight: '-webkit-fill-available' }}
    >
      {/* Desktop sidebar — hidden on mobile (bottom nav used instead) */}
      {!isMobile && <Sidebar />}

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar />
        <div className="flex flex-1 overflow-hidden min-h-0">
          <main className="flex-1 flex overflow-hidden min-w-0">
            <Outlet />
          </main>
          {/* Context panel — hidden on mobile (accessed via TopBar button) */}
          {!isMobile && <ContextPanel />}
        </div>

        {/* Bottom navigation on mobile */}
        {isMobile && <BottomNav />}
      </div>
    </div>
  );
}
