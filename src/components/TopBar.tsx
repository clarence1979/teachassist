import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, PanelRight, ShieldCheck, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { ModelPicker } from './ModelPicker';
import { TeachAssistIcon, TeachAssistLogo } from './TeachAssistLogo';
import { useAppStore } from '../store/appStore';
import { useCredentials } from '../contexts/CredentialsContext';
import { useAdminDb } from '../db/DbContext';
import { useMobile } from '../lib/useMobile';
import { ContextPanelBody } from './ContextPanelBody';

interface TopBarProps {
  /** When true, renders at reduced height for mobile landscape */
  landscape?: boolean;
}

export function TopBar({ landscape = false }: TopBarProps) {
  const { toggleContextPanel, contextPanelOpen } = useAppStore();
  const { username, isAdmin, isIframe } = useCredentials();
  const { viewedAsUser, setViewedAsUser, allUsers, refreshAllUsers } = useAdminDb();
  const navigate = useNavigate();
  const isMobile = useMobile();
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const adminMenuRef = useRef<HTMLDivElement | null>(null);

  // Compact mode: iframe on mobile OR landscape on mobile
  const isCompact = (isIframe && isMobile) || landscape;

  useEffect(() => {
    if (!adminMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!adminMenuRef.current) return;
      if (!adminMenuRef.current.contains(e.target as Node)) setAdminMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [adminMenuOpen]);

  const isViewingOther = isAdmin && viewedAsUser !== username;

  return (
    <header
      className="flex items-center justify-between border-b border-border bg-bg-panel shrink-0"
      style={{
        height: landscape ? '40px' : isCompact ? '44px' : isMobile ? '52px' : '48px',
        paddingTop: (isMobile && !landscape) ? 'max(6px, env(safe-area-inset-top))' : undefined,
        paddingLeft: landscape ? 'max(8px, env(safe-area-inset-left))' : 'max(12px, env(safe-area-inset-left))',
        paddingRight: landscape ? 'max(8px, env(safe-area-inset-right))' : 'max(12px, env(safe-area-inset-right))',
      }}
    >
      {/* Left: brand + admin indicator */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        {isCompact ? (
          <TeachAssistIcon size={14} className="text-accent-cyan shrink-0" />
        ) : (
          <>
            <TeachAssistLogo iconSize={16} className="hidden sm:inline-flex text-xs shrink-0" />
            <TeachAssistIcon size={16} className="text-accent-cyan sm:hidden shrink-0" />
          </>
        )}

        {username && !isMobile && (
          <span className="text-xs text-text-dim font-mono hidden md:block truncate max-w-24">
            {username}
          </span>
        )}

        {isAdmin && (
          <div className="flex items-center gap-1 ml-1">
            <ShieldCheck size={12} className="text-accent-amber shrink-0" />
            <div className="relative" ref={adminMenuRef}>
              <button
                onClick={() => {
                  setAdminMenuOpen((v) => {
                    const next = !v;
                    if (next) refreshAllUsers().catch(() => {});
                    return next;
                  });
                }}
                className={clsx(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-rajdhani font-bold uppercase tracking-wider transition-colors',
                  isViewingOther
                    ? 'border-accent-amber/60 bg-accent-amber/10 text-accent-amber'
                    : 'border-border text-text-dim hover:border-accent-amber/50 hover:text-accent-amber'
                )}
              >
                {isViewingOther
                  ? viewedAsUser.slice(0, isCompact ? 6 : 8)
                  : (isCompact ? 'Adm' : isMobile ? 'Admin' : 'Admin view')}
                <ChevronDown size={10} />
              </button>

              <div className={clsx(
                'absolute top-full left-0 mt-1 w-56 bg-bg-panel border border-border rounded-btn shadow-xl z-50',
                adminMenuOpen ? 'block' : 'hidden',
              )}>
                <div className="px-2 py-1.5 border-b border-border">
                  <p className="text-[9px] font-mono text-text-dim uppercase tracking-wider">View data as user</p>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <button
                    onClick={() => { setViewedAsUser(username); setAdminMenuOpen(false); }}
                    className={clsx(
                      'w-full text-left px-3 py-2 text-xs font-mono transition-colors flex items-center gap-2',
                      viewedAsUser === username
                        ? 'text-accent-cyan bg-accent-cyan/10'
                        : 'text-text-secondary hover:bg-bg-elevated'
                    )}
                  >
                    {username}
                    <span className="text-[9px] text-text-dim">(you)</span>
                  </button>

                  {allUsers.filter((u) => u !== username).length === 0 && (
                    <div className="px-3 py-2 text-[10px] font-mono text-text-dim">No other users yet</div>
                  )}
                  {allUsers
                    .filter((u) => u !== username)
                    .map((u) => (
                      <button
                        key={u}
                        onClick={() => { setViewedAsUser(u); setAdminMenuOpen(false); }}
                        className={clsx(
                          'w-full text-left px-3 py-2 text-xs font-mono transition-colors',
                          viewedAsUser === u
                            ? 'text-accent-cyan bg-accent-cyan/10'
                            : 'text-text-secondary hover:bg-bg-elevated'
                        )}
                      >
                        {u}
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-1.5 shrink-0 min-w-0">
        <div className={clsx('min-w-0', isCompact ? 'max-w-[110px]' : '')}>
          <ModelPicker compact={isCompact} />
        </div>

        {isMobile ? (
          <>
            <button
              onClick={() => setMobileContextOpen(true)}
              aria-label="Open context panel"
              className={clsx(
                'rounded-btn border border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan transition-colors shrink-0',
                isCompact ? 'p-1' : 'p-1.5'
              )}
            >
              <PanelRight size={isCompact ? 13 : 14} />
            </button>

            {mobileContextOpen && (
              <div
                className="fixed inset-0 z-50 flex items-end"
                onClick={() => setMobileContextOpen(false)}
              >
                <div
                  className="w-full max-h-[85dvh] bg-bg-panel border-t border-border rounded-t-2xl overflow-y-auto shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                  style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-bg-panel">
                    <span className="font-rajdhani font-semibold text-sm text-text-primary">Context</span>
                    <button
                      onClick={() => setMobileContextOpen(false)}
                      className="p-1 rounded-btn text-text-dim hover:text-accent-cyan transition-colors"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                  <ContextPanelBody />
                </div>
                <div className="absolute inset-0 -z-10 bg-black/60 backdrop-blur-sm" />
              </div>
            )}
          </>
        ) : (
          <button
            onClick={toggleContextPanel}
            aria-label="Toggle context panel"
            aria-pressed={contextPanelOpen}
            className={clsx(
              'p-1.5 rounded-btn border transition-colors shrink-0',
              contextPanelOpen
                ? 'border-accent-cyan text-accent-cyan bg-bg-elevated'
                : 'border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan'
            )}
          >
            <PanelRight size={14} />
          </button>
        )}

        {!isIframe && (
          <button
            onClick={() => navigate('/settings')}
            aria-label="Settings"
            className={clsx(
              'rounded-btn border border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan transition-colors shrink-0',
              isCompact ? 'p-1' : 'p-1.5'
            )}
          >
            <Settings size={isCompact ? 13 : 14} />
          </button>
        )}
      </div>
    </header>
  );
}
