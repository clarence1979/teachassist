import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  MessageSquare, Wand2, CheckSquare, Calendar, BookOpen,
  Palette, Type, Sun, Moon, Minus, Plus, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useOrientation } from '../lib/useOrientation';
import { useAppStore, type ThemeId, type FontSize } from '../store/appStore';

const NAV_ITEMS = [
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/studio', icon: Wand2, label: 'Studio' },
  { path: '/todo', icon: CheckSquare, label: 'To-Do' },
  { path: '/timetable', icon: Calendar, label: 'Timetable' },
  { path: '/library', icon: BookOpen, label: 'Library' },
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

interface BottomNavProps {
  /** When true, renders a thin utility bar (Appearance only) for landscape mode */
  landscapeBar?: boolean;
}

export function BottomNav({ landscapeBar = false }: BottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const orientation = useOrientation();
  const { theme, setTheme, fontSize, setFontSize } = useAppStore();
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  const isLandscape = orientation === 'landscape';
  // In landscape portrait nav, compact = icons only
  const compact = isLandscape && !landscapeBar;

  const fontSizeOrder: FontSize[] = ['sm', 'md', 'lg', 'xl'];
  const currentFontIdx = fontSizeOrder.indexOf(fontSize);
  const currentTheme = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <>
      {/* Appearance sheet — slides up from bottom */}
      {appearanceOpen && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setAppearanceOpen(false)}>
          <div
            className="w-full bg-bg-panel border-t border-border rounded-t-2xl shadow-2xl"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <div className="flex items-center gap-2">
                <Palette size={14} className="text-accent-cyan" />
                <span className="font-rajdhani font-bold text-sm text-text-primary tracking-wide uppercase">Appearance</span>
              </div>
              <button onClick={() => setAppearanceOpen(false)} className="p-1.5 rounded-btn text-text-dim hover:text-accent-red transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="px-4 py-3 space-y-4">
              {/* Theme */}
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-[11px] font-mono uppercase tracking-widest text-text-dim">
                  {currentTheme.isDark ? <Moon size={11} /> : <Sun size={11} />}
                  Colour Theme
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {THEMES.map((t) => {
                    const active = theme === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTheme(t.id)}
                        title={t.label}
                        className={clsx(
                          'flex flex-col items-center gap-1.5 p-2 rounded-lg border-2 transition-all',
                          active ? 'border-accent-cyan scale-105' : 'border-border hover:border-text-dim',
                        )}
                        style={{ background: t.bg }}
                      >
                        <div className="w-6 h-6 rounded-full border border-white/10" style={{ background: t.accent }} />
                        <span className="text-[9px] font-mono font-bold" style={{ color: t.accent, textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                          {t.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Font size */}
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-[11px] font-mono uppercase tracking-widest text-text-dim">
                  <Type size={11} />
                  Font Size
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { if (currentFontIdx > 0) setFontSize(fontSizeOrder[currentFontIdx - 1]); }}
                    disabled={currentFontIdx <= 0}
                    className="w-9 h-9 flex items-center justify-center rounded-btn border border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan transition-colors disabled:opacity-30"
                  ><Minus size={14} /></button>
                  <div className="flex-1 grid grid-cols-4 gap-1.5">
                    {FONT_SIZES.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFontSize(f.id)}
                        className={clsx(
                          'h-9 rounded-btn border font-rajdhani font-bold text-sm transition-all',
                          fontSize === f.id
                            ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan'
                            : 'border-border text-text-dim hover:border-text-dim hover:text-text-secondary',
                        )}
                      >{f.label}</button>
                    ))}
                  </div>
                  <button
                    onClick={() => { if (currentFontIdx < fontSizeOrder.length - 1) setFontSize(fontSizeOrder[currentFontIdx + 1]); }}
                    disabled={currentFontIdx >= fontSizeOrder.length - 1}
                    className="w-9 h-9 flex items-center justify-center rounded-btn border border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan transition-colors disabled:opacity-30"
                  ><Plus size={14} /></button>
                </div>
              </div>
            </div>
          </div>
          <div className="absolute inset-0 -z-10 bg-black/60 backdrop-blur-sm" />
        </div>
      )}

      {/* Landscape utility bar — just Appearance button, full-width slim strip */}
      {landscapeBar && (
        <div
          className="shrink-0 bg-bg-panel border-t border-border flex items-center justify-end gap-2 px-3"
          style={{ height: 36, paddingBottom: 'env(safe-area-inset-bottom)', paddingRight: 'max(12px, env(safe-area-inset-right))' }}
        >
          <button
            onClick={() => setAppearanceOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-btn border border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan transition-colors text-xs font-rajdhani font-semibold"
          >
            <Palette size={12} />
            <span>Theme &amp; Font</span>
            <div className="w-2.5 h-2.5 rounded-full border border-bg-panel ml-0.5" style={{ background: currentTheme.accent }} />
          </button>
        </div>
      )}

      {!landscapeBar && (
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

        {/* Appearance button — always present on mobile */}
        <button
          onClick={() => setAppearanceOpen(true)}
          aria-label="Appearance settings"
          className={clsx(
            'flex-1 flex flex-col items-center justify-center transition-colors',
            compact ? 'py-1.5 gap-0' : 'py-2 gap-1',
            'text-text-dim hover:text-accent-cyan active:text-accent-cyan',
          )}
        >
          {/* Coloured swatch dot + palette icon stacked */}
          <div className="relative">
            <Palette size={compact ? 18 : 20} />
            <div
              className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-bg-panel"
              style={{ background: currentTheme.accent }}
            />
          </div>
          {!compact && (
            <span className="text-[10px] font-rajdhani font-semibold tracking-wide">Theme</span>
          )}
        </button>
      </nav>
      )}
    </>
  );
}
