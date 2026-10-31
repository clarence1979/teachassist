import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  MessageSquare,
  Wand2,
  CheckSquare,
  Calendar,
  BookOpen,
  LayoutTemplate,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Palette,
  Type,
  Sun,
  Moon,
  Minus,
  Plus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { TeachAssistIcon } from './TeachAssistLogo';
import { clsx } from 'clsx';
import { useAppStore, type ThemeId, type FontSize } from '../store/appStore';

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'chat', label: 'Chat', path: '/chat', icon: MessageSquare },
  { id: 'studio', label: 'Studio', path: '/studio', icon: Wand2 },
  { id: 'todo', label: 'To-Do', path: '/todo', icon: CheckSquare },
  { id: 'timetable', label: 'Timetable', path: '/timetable', icon: Calendar },
  { id: 'library', label: 'Library', path: '/library', icon: BookOpen },
  { id: 'infographic-poster', label: 'Poster', path: '/infographic-poster', icon: LayoutTemplate },
];

const THEMES: Array<{ id: ThemeId; label: string; bg: string; accent: string; isDark: boolean }> = [
  { id: 'midnight', label: 'Midnight', bg: '#050a14', accent: '#22d3ee', isDark: true },
  { id: 'light',    label: 'Light',    bg: '#f5f7fa', accent: '#0891b2', isDark: false },
  { id: 'forest',   label: 'Forest',   bg: '#0c1a0e', accent: '#34d399', isDark: true },
  { id: 'ocean',    label: 'Ocean',    bg: '#020e1a', accent: '#0ea5e9', isDark: true },
  { id: 'slate',    label: 'Slate',    bg: '#0f1117', accent: '#58a6ff', isDark: true },
];

const FONT_SIZES: Array<{ id: FontSize; label: string }> = [
  { id: 'sm', label: 'S' },
  { id: 'md', label: 'M' },
  { id: 'lg', label: 'L' },
  { id: 'xl', label: 'XL' },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, theme, setTheme, fontSize, setFontSize } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  const fontSizeOrder: FontSize[] = ['sm', 'md', 'lg', 'xl'];
  const currentFontIdx = fontSizeOrder.indexOf(fontSize);
  const decreaseFont = () => { if (currentFontIdx > 0) setFontSize(fontSizeOrder[currentFontIdx - 1]); };
  const increaseFont = () => { if (currentFontIdx < fontSizeOrder.length - 1) setFontSize(fontSizeOrder[currentFontIdx + 1]); };
  const currentTheme = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <aside
      className={clsx(
        'flex flex-col h-full transition-all duration-200',
        'bg-bg-panel border-r border-border',
        sidebarCollapsed ? 'w-14' : 'w-52'
      )}
    >
      {/* Brand */}
      <div
        className={clsx(
          'flex items-center gap-2 px-3 py-4 border-b border-border',
          sidebarCollapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <TeachAssistIcon size={18} className="text-accent-cyan shrink-0" />
            <span className="font-orbitron text-[10px] font-bold tracking-widest text-accent-cyan truncate leading-none">
              TEACH ASSIST
            </span>
          </div>
        )}
        {sidebarCollapsed && <TeachAssistIcon size={18} className="text-accent-cyan" />}
        <button
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={clsx(
            'p-1 rounded-btn text-text-dim hover:text-accent-cyan hover:bg-bg-elevated transition-colors',
            sidebarCollapsed && 'hidden'
          )}
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2.5 mx-1 rounded-btn',
                'font-rajdhani font-semibold text-sm transition-all duration-150',
                sidebarCollapsed ? 'justify-center w-auto' : '',
                isActive
                  ? 'bg-bg-elevated text-accent-cyan border border-border'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated border border-transparent'
              )}
            >
              <Icon
                size={16}
                className={clsx(
                  'shrink-0',
                  isActive ? 'text-accent-cyan' : 'text-text-dim'
                )}
              />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Footer tools */}
      <div className="relative border-t border-border mt-1 pt-2 pb-2 px-1 space-y-1">
        {/* Appearance popover */}
        {appearanceOpen && (
          <div
            className={clsx(
              'absolute bottom-full mb-2 z-50 bg-bg-panel border border-border rounded-lg shadow-2xl',
              sidebarCollapsed ? 'left-14' : 'left-0',
              sidebarCollapsed ? 'w-72' : 'w-full',
            )}
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
              <span className="font-rajdhani font-bold text-sm text-text-primary tracking-wide uppercase">Appearance</span>
              <button onClick={() => setAppearanceOpen(false)} className="p-1 rounded-btn text-text-dim hover:text-accent-red transition-colors"><X size={13} /></button>
            </div>

            {/* Theme swatches */}
            <div className="p-3 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-widest text-text-dim flex items-center gap-1.5 mb-2">
                {currentTheme.isDark ? <Moon size={10} /> : <Sun size={10} />} Colour Theme
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {THEMES.map((t) => {
                  const active = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      title={t.label}
                      className={clsx(
                        'flex flex-col items-center gap-1 p-1.5 rounded-btn border-2 transition-all',
                        active ? 'border-accent-cyan scale-105' : 'border-border hover:border-text-dim',
                      )}
                      style={{ background: t.bg }}
                    >
                      {/* Colour dot */}
                      <div className="w-5 h-5 rounded-full border border-white/10" style={{ background: t.accent }} />
                      <span className="text-[9px] font-mono" style={{ color: t.accent, textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>
                        {t.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Font size */}
              <div className="pt-2 border-t border-border">
                <div className="text-[10px] font-mono uppercase tracking-widest text-text-dim flex items-center gap-1.5 mb-2">
                  <Type size={10} /> Font Size
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={decreaseFont}
                    disabled={currentFontIdx <= 0}
                    className="p-1.5 rounded-btn border border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan transition-colors disabled:opacity-30"
                    title="Decrease font size"
                  ><Minus size={11} /></button>
                  <div className="flex-1 grid grid-cols-4 gap-1">
                    {FONT_SIZES.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFontSize(f.id)}
                        className={clsx(
                          'py-1 rounded-btn border text-[11px] font-rajdhani font-bold transition-all',
                          fontSize === f.id
                            ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan'
                            : 'border-border text-text-dim hover:border-text-dim hover:text-text-secondary',
                        )}
                      >{f.label}</button>
                    ))}
                  </div>
                  <button
                    onClick={increaseFont}
                    disabled={currentFontIdx >= fontSizeOrder.length - 1}
                    className="p-1.5 rounded-btn border border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan transition-colors disabled:opacity-30"
                    title="Increase font size"
                  ><Plus size={11} /></button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Appearance toggle button */}
        <button
          onClick={() => setAppearanceOpen((v) => !v)}
          aria-label="Appearance settings"
          title="Theme & font size"
          className={clsx(
            'w-full flex items-center gap-3 px-3 py-2 rounded-btn border transition-all duration-150 font-rajdhani font-semibold text-xs',
            sidebarCollapsed ? 'justify-center' : '',
            appearanceOpen
              ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan'
              : 'border-border text-text-dim hover:text-accent-cyan hover:border-accent-cyan hover:bg-bg-elevated',
          )}
        >
          <Palette size={14} className="shrink-0" />
          {!sidebarCollapsed && <span>Appearance</span>}
          {!sidebarCollapsed && (
            <div className="ml-auto flex items-center gap-1">
              <div className="w-3 h-3 rounded-full border border-border" style={{ background: currentTheme.accent }} />
            </div>
          )}
        </button>

        {/* Dev link */}
        <button
          onClick={() => navigate('/dev/llm-test')}
          aria-label="LLM Test (dev)"
          className={clsx(
            'w-full flex items-center gap-3 px-3 py-2 rounded-btn',
            'font-rajdhani font-semibold text-xs transition-all duration-150',
            sidebarCollapsed ? 'justify-center' : '',
            location.pathname === '/dev/llm-test'
              ? 'bg-bg-elevated text-accent-amber border border-accent-amber/40'
              : 'text-text-dim hover:text-text-secondary hover:bg-bg-elevated border border-transparent'
          )}
        >
          <FlaskConical size={14} className="shrink-0" />
          {!sidebarCollapsed && <span>LLM Test</span>}
        </button>
      </div>

      {/* Expand toggle when collapsed */}
      {sidebarCollapsed && (
        <div className="border-t border-border p-2 flex justify-center">
          <button
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan hover:bg-bg-elevated transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </aside>
  );
}
