import { useNavigate, useLocation } from 'react-router-dom';
import {
  MessageSquare,
  Wand2,
  CheckSquare,
  Calendar,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  type LucideIcon,
} from 'lucide-react';
import { TeachAssistIcon } from './TeachAssistLogo';
import { clsx } from 'clsx';
import { useAppStore } from '../store/appStore';

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
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();

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

      {/* Dev link */}
      <div className="px-1 pb-2 border-t border-border mt-1 pt-2">
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
