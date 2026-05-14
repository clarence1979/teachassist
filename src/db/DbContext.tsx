import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { getDb, type PedagogyDB } from './schema';
import { useCredentials } from '../contexts/CredentialsContext';
import { supabase } from '../lib/supabaseClient';
import { configureSync, pullFromSupabase, pushLocalOnly, reconcileLocalWithRemote, subscribeRemoteChanges, setSyncPollInterval } from './sync';
import { loadUserPrefs } from '../lib/userPrefs';
import { setPrefsUsername, useAppStore } from '../store/appStore';
import type { Provider } from '../types/credentials';

interface DbContextValue {
  db: PedagogyDB;
  /** The username whose data is currently being viewed (own for regular users, switchable for admins) */
  viewedAsUser: string;
  /** Admin-only: switch to view another user's data */
  setViewedAsUser: (username: string) => void;
  /** Admin-only: all usernames in the system */
  allUsers: string[];
  /** Admin-only: manually refetch the user list */
  refreshAllUsers: () => Promise<void>;
}

const DbContext = createContext<DbContextValue | null>(null);

export function DbProvider({ children }: { children: React.ReactNode }) {
  const { username, isAdmin } = useCredentials();
  const [viewedAsUser, setViewedAsUserState] = useState(username || 'default');
  const [allUsers, setAllUsers] = useState<string[]>([]);

  // Keep viewedAsUser in sync when the logged-in user changes (e.g. after login/logout)
  useEffect(() => {
    setViewedAsUserState(username || 'default');
  }, [username]);

  // Load cross-device preferences (active model / provider, etc.) whenever the
  // logged-in user changes. Model selection is remembered against the username,
  // not the device, so signing in from another machine surfaces the same pick.
  useEffect(() => {
    if (!username || username === 'default') {
      setPrefsUsername('');
      return;
    }
    setPrefsUsername('');
    loadUserPrefs(username).then((prefs) => {
      const store = useAppStore.getState();
      if (typeof prefs.activeProvider === 'string') {
        store.setActiveProvider(prefs.activeProvider as Provider);
      }
      if (typeof prefs.activeModel === 'string') {
        store.setActiveModel(prefs.activeModel as string);
      }
      // Offline model is NOT restored from saved prefs — each sign-in should
      // start on the chosen cloud model so users aren't silently locked onto
      // the on-device model from a prior session.
      store.setOfflineModelId(null);
      setPrefsUsername(username);
    }).catch(() => setPrefsUsername(username));
  }, [username]);

  // Fetch all usernames from Supabase for the admin switcher.
  // Uses an RPC that DISTINCTs at the database layer — selecting `username`
  // directly from `user_records` gets truncated by PostgREST's 1000-row cap
  // when one user has many records, which can hide other users entirely.
  const fetchAllUsers = useCallback(async () => {
    const names = new Set<string>();
    if (username) names.add(username);

    const { data, error } = await supabase.rpc('list_all_usernames');
    if (error) {
      console.warn('[admin] list_all_usernames rpc failed:', error.message);
    } else if (Array.isArray(data)) {
      for (const r of data as { username: string }[]) {
        if (r.username && r.username !== 'default') names.add(r.username);
      }
    }

    setAllUsers(Array.from(names).sort((a, b) => a.localeCompare(b)));
  }, [username]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchAllUsers().catch((e) => {
      console.warn('[admin] fetchAllUsers failed:', e);
      setAllUsers(username ? [username] : []);
    });
  }, [isAdmin, username, fetchAllUsers]);

  const refreshAllUsers = useCallback(async () => {
    if (!isAdmin) return;
    await fetchAllUsers();
  }, [isAdmin, fetchAllUsers]);

  const setViewedAsUser = useCallback((u: string) => {
    if (!isAdmin) return;
    setViewedAsUserState(u);
  }, [isAdmin]);

  const db = useMemo(() => getDb(viewedAsUser), [viewedAsUser]);

  // Attach Dexie→Supabase sync hooks + pull remote records whenever viewedAsUser changes.
  // Order matters: PULL first so remote wins, then push only records the remote doesn't
  // already have (so a stale local copy can never overwrite a newer remote edit).
  useEffect(() => {
    if (!viewedAsUser || viewedAsUser === 'default') return;
    configureSync(db, viewedAsUser);
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    (async () => {
      await pullFromSupabase(db, viewedAsUser);
      if (cancelled) return;
      // Drop any local rows that no longer exist remotely (handles cases where
      // server-side data was purged or a different device deleted records while
      // this browser was offline). Must run BEFORE pushLocalOnly so the stale
      // rows don't get re-uploaded.
      await reconcileLocalWithRemote(db, viewedAsUser);
      if (cancelled) return;
      await pushLocalOnly(db, viewedAsUser);
      if (cancelled) return;
      // Live updates from other devices
      cleanup = subscribeRemoteChanges(db, viewedAsUser);
      // Safety-net polling every 30s in case realtime is unavailable
      setSyncPollInterval(db, viewedAsUser, 30000);
    })();
    const onFocus = () => { pullFromSupabase(db, viewedAsUser).catch(() => {}); };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      cleanup?.();
      setSyncPollInterval(db, viewedAsUser, 0);
    };
  }, [db, viewedAsUser]);

  return (
    <DbContext.Provider value={{ db, viewedAsUser, setViewedAsUser, allUsers, refreshAllUsers }}>
      {children}
    </DbContext.Provider>
  );
}

export function useDb(): PedagogyDB {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used within DbProvider');
  return ctx.db;
}

export function useAdminDb() {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useAdminDb must be used within DbProvider');
  return ctx;
}
