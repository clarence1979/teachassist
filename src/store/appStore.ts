import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Provider } from '../types/credentials';
import { saveUserPref } from '../lib/userPrefs';

/** The username whose preferences we should push to Supabase. Kept here so the
 *  store stays provider-agnostic — `CredentialsContext` updates this on login. */
let prefsUsername = '';
export function setPrefsUsername(username: string): void {
  prefsUsername = username || '';
}
function pushPref(key: string, value: unknown): void {
  if (prefsUsername) saveUserPref(prefsUsername, key, value).catch(() => {});
}

export type ViewId = 'chat' | 'studio' | 'todo' | 'timetable' | 'library' | 'settings';

interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface UsageDailyEntry {
  date: string; // YYYY-MM-DD
  provider: Provider;
  inputTokens: number;
  outputTokens: number;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface AppState {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;

  /** Set when a studio generator saves an artifact — chat can pick this up */
  lastGeneratedArtifactId: string | null;
  notifyArtifactGenerated: (id: string) => void;
  clearGeneratedArtifact: () => void;

  activeProvider: Provider;
  setActiveProvider: (provider: Provider) => void;

  activeModel: string;
  setActiveModel: (model: string) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  contextPanelOpen: boolean;
  toggleContextPanel: () => void;

  conversationListCollapsed: boolean;
  toggleConversationList: () => void;

  sessionUsage: Record<Provider, SessionUsage>;
  addUsage: (provider: Provider, input: number, output: number) => void;

  /** Daily usage history for Settings → Usage chart (persisted) */
  usageHistory: UsageDailyEntry[];

  timezone: string;
  setTimezone: (tz: string) => void;

  reducedMotion: boolean;
  setReducedMotion: (v: boolean) => void;

  /** Whether the chat engine mixes summaries of prior conversations into the system prompt. */
  memoryEnabled: boolean;
  setMemoryEnabled: (v: boolean) => void;

  /** Selected on-device (offline) model id, e.g. "llama-3.2-3b". Null when no offline model is chosen. */
  offlineModelId: string | null;
  setOfflineModelId: (id: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeView: 'chat',
      setActiveView: (view) => set({ activeView: view }),

      lastGeneratedArtifactId: null,
      notifyArtifactGenerated: (id) => set({ lastGeneratedArtifactId: id }),
      clearGeneratedArtifact: () => set({ lastGeneratedArtifactId: null }),

      activeProvider: 'anthropic',
      setActiveProvider: (provider) => {
        // Switching to a cloud provider must disable any sticky offline model.
        set({ activeProvider: provider, offlineModelId: null });
        pushPref('activeProvider', provider);
        pushPref('offlineModelId', null);
      },

      activeModel: 'claude-sonnet-4-5',
      setActiveModel: (model) => {
        set({ activeModel: model });
        pushPref('activeModel', model);
      },

      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      contextPanelOpen: false,
      toggleContextPanel: () => set((s) => ({ contextPanelOpen: !s.contextPanelOpen })),

      conversationListCollapsed: false,
      toggleConversationList: () => set((s) => ({ conversationListCollapsed: !s.conversationListCollapsed })),

      sessionUsage: {
        anthropic: { inputTokens: 0, outputTokens: 0 },
        openai: { inputTokens: 0, outputTokens: 0 },
      },
      addUsage: (provider, input, output) =>
        set((s) => {
          const today = todayISO();
          const history = [...s.usageHistory];
          const idx = history.findIndex((h) => h.date === today && h.provider === provider);
          if (idx >= 0) {
            history[idx] = { ...history[idx], inputTokens: history[idx].inputTokens + input, outputTokens: history[idx].outputTokens + output };
          } else {
            history.push({ date: today, provider, inputTokens: input, outputTokens: output });
          }
          // Cap history to the last 90 days per provider
          const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
          const pruned = history.filter((h) => new Date(h.date).getTime() >= cutoff);
          return {
            sessionUsage: {
              ...s.sessionUsage,
              [provider]: {
                inputTokens: s.sessionUsage[provider].inputTokens + input,
                outputTokens: s.sessionUsage[provider].outputTokens + output,
              },
            },
            usageHistory: pruned,
          };
        }),

      usageHistory: [],

      timezone: 'Australia/Melbourne',
      setTimezone: (tz) => set({ timezone: tz }),

      reducedMotion: false,
      setReducedMotion: (v) => set({ reducedMotion: v }),

      memoryEnabled: true,
      setMemoryEnabled: (v) => set({ memoryEnabled: v }),

      offlineModelId: null,
      setOfflineModelId: (id) => {
        set({ offlineModelId: id });
        pushPref('offlineModelId', id);
      },
    }),
    {
      name: 'pedagogy-app-store',
      onRehydrateStorage: () => (state) => {
        // Any offline selection from a prior session is cleared so the app
        // always boots on the default cloud model (Sonnet 4.5).
        if (state && state.offlineModelId) state.offlineModelId = null;
      },
      partialize: (s) => ({
        usageHistory: s.usageHistory,
        timezone: s.timezone,
        reducedMotion: s.reducedMotion,
        activeProvider: s.activeProvider,
        activeModel: s.activeModel,
        memoryEnabled: s.memoryEnabled,
        // Intentionally NOT persisting `offlineModelId`: each session must
        // start on the default cloud model (Sonnet 4.5) unless the user
        // explicitly re-selects an offline model.
        sidebarCollapsed: s.sidebarCollapsed,
        conversationListCollapsed: s.conversationListCollapsed,
      }),
    },
  ),
);
