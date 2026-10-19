import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { isInIframe, attemptAutoLogin } from '../utils/auto-login';
import type { ProviderCredential } from '../types/credentials';
import { supabase, setSupabaseUsername } from '../lib/supabaseClient';

export type AuthStage = 'loading' | 'login' | 'ready';

interface CredentialsContextValue {
  providers: ProviderCredential[];
  isIframe: boolean;
  authStage: AuthStage;
  username: string;
  isAdmin: boolean;
  getKey: (providerId: 'anthropic' | 'openai') => string | undefined;
  login: (username: string, password: string) => Promise<{ error?: string }>;
  logout: () => void;
}

const CredentialsContext = createContext<CredentialsContextValue | null>(null);

const LS_SESSION = 'ta_session_token';
// pre-session builds trusted these unverified values; cleared on startup
const LS_LEGACY_AUTH = 'ta_auth_username';
const LS_LEGACY_IS_ADMIN = 'ta_auth_is_admin';

export function CredentialsProvider({ children }: { children: React.ReactNode }) {
  const inIframe = isInIframe();
  const [providers, setProviders] = useState<ProviderCredential[]>([]);
  const [authStage, setAuthStage] = useState<AuthStage>('loading');
  const [username, setUsername] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const initDone = useRef(false);

  const applyKeys = useCallback((openaiKey?: string, claudeKey?: string) => {
    const next: ProviderCredential[] = [];
    if (openaiKey) next.push({ id: 'openai', apiKey: openaiKey });
    if (claudeKey) next.push({ id: 'anthropic', apiKey: claudeKey });
    setProviders(next);
  }, []);

  const fetchSecretsAndReady = useCallback(async (token: string) => {
    const { data, error } = await supabase.rpc('get_app_secrets', { p_token: token });

    if (error || !Array.isArray(data)) {
      console.error('[Credentials] Failed to fetch secrets:', error?.message);
      setAuthStage('ready');
      return;
    }

    const rows = data as { key_name: string; key_value: string }[];
    applyKeys(
      rows.find((r) => r.key_name === 'OPENAI_API_KEY')?.key_value,
      rows.find((r) => r.key_name === 'CLAUDE_API_KEY')?.key_value,
    );
    setAuthStage('ready');
  }, [applyKeys]);

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    async function init() {
      if (inIframe) {
        const result = await attemptAutoLogin();
        if (result.authenticated) {
          const openaiKey = localStorage.getItem('VITE_OPENAI_API_KEY') ?? undefined;
          const claudeKey = localStorage.getItem('VITE_CLAUDE_API_KEY') ?? undefined;
          applyKeys(openaiKey, claudeKey);
          setUsername(result.username ?? '');
          setSupabaseUsername(result.username ?? '');
          setIsAdmin(result.isAdmin ?? false);
          setAuthStage('ready');
        } else {
          setAuthStage('login');
        }
        return;
      }

      localStorage.removeItem(LS_LEGACY_AUTH);
      localStorage.removeItem(LS_LEGACY_IS_ADMIN);
      const token = localStorage.getItem(LS_SESSION);
      if (!token) {
        setAuthStage('login');
        return;
      }
      const { data, error } = await supabase.rpc('app_session_info', { p_token: token });
      const session = Array.isArray(data) ? (data[0] as { username: string; is_admin: boolean } | undefined) : undefined;
      if (error || !session) {
        localStorage.removeItem(LS_SESSION);
        setAuthStage('login');
        return;
      }
      setUsername(session.username);
      setSupabaseUsername(session.username);
      setIsAdmin(session.is_admin);
      await fetchSecretsAndReady(token);
    }

    init();
  }, [inIframe, applyKeys, fetchSecretsAndReady]);

  const login = useCallback(
    async (user: string, password: string): Promise<{ error?: string }> => {
      const trimUser = user.trim();
      const trimPass = password.trim();
      if (!trimUser || !trimPass) return { error: 'Username and password are required.' };

      const { data, error } = await supabase.rpc('app_login', {
        p_username: trimUser,
        p_password: trimPass,
      });

      if (error) {
        console.error('[Credentials] login failed:', error.message);
        return { error: 'Login failed. Please try again.' };
      }
      const session = Array.isArray(data) ? (data[0] as { token: string; is_admin: boolean } | undefined) : undefined;
      if (!session?.token) return { error: 'Invalid username or password.' };

      localStorage.setItem(LS_SESSION, session.token);
      setUsername(trimUser);
      setSupabaseUsername(trimUser);
      setIsAdmin(session.is_admin);
      await fetchSecretsAndReady(session.token);
      return {};
    },
    [fetchSecretsAndReady]
  );

  const logout = useCallback(() => {
    const token = localStorage.getItem(LS_SESSION);
    if (token) {
      supabase.rpc('app_logout', { p_token: token }).then(({ error }) => {
        if (error) console.warn('[Credentials] logout failed:', error.message);
      });
    }
    localStorage.removeItem(LS_SESSION);
    localStorage.removeItem('VITE_OPENAI_API_KEY');
    localStorage.removeItem('VITE_CLAUDE_API_KEY');
    setProviders([]);
    setUsername('');
    setSupabaseUsername('');
    setIsAdmin(false);
    setAuthStage('login');
  }, []);

  const getKey = useCallback(
    (providerId: 'anthropic' | 'openai') =>
      providers.find((p) => p.id === providerId)?.apiKey,
    [providers]
  );

  return (
    <CredentialsContext.Provider
      value={{
        providers,
        isIframe: inIframe,
        authStage,
        username,
        isAdmin,
        getKey,
        login,
        logout,
      }}
    >
      {children}
    </CredentialsContext.Provider>
  );
}

export function useCredentials() {
  const ctx = useContext(CredentialsContext);
  if (!ctx) throw new Error('useCredentials must be used inside CredentialsProvider');
  return ctx;
}
