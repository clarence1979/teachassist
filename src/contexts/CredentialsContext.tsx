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

const LS_AUTH = 'ta_auth_username';
const LS_IS_ADMIN = 'ta_auth_is_admin';

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

  const fetchSecretsAndReady = useCallback(async () => {
    const { data, error } = await supabase
      .from('secrets')
      .select('key_name, key_value');

    if (error) {
      console.error('[Credentials] Failed to fetch secrets:', error.message);
      setAuthStage('ready');
      return;
    }

    const openaiRow = (data as { key_name: string; key_value: string }[]).find(
      (r) => r.key_name === 'OPENAI_API_KEY'
    );
    const claudeRow = (data as { key_name: string; key_value: string }[]).find(
      (r) => r.key_name === 'CLAUDE_API_KEY'
    );

    applyKeys(openaiRow?.key_value, claudeRow?.key_value);
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

      const saved = localStorage.getItem(LS_AUTH);
      if (saved) {
        setUsername(saved);
        setSupabaseUsername(saved);
        setIsAdmin(localStorage.getItem(LS_IS_ADMIN) === 'true');
        await fetchSecretsAndReady();
      } else {
        setAuthStage('login');
      }
    }

    init();
  }, [inIframe, applyKeys, fetchSecretsAndReady]);

  const login = useCallback(
    async (user: string, password: string): Promise<{ error?: string }> => {
      const trimUser = user.trim();
      const trimPass = password.trim();
      if (!trimUser || !trimPass) return { error: 'Username and password are required.' };

      const { data, error } = await supabase
        .from('users_login')
        .select('username, password, is_admin')
        .eq('username', trimUser)
        .eq('password', trimPass)
        .maybeSingle();

      if (error) return { error: 'Login failed. Please try again.' };
      if (!data) return { error: 'Invalid username or password.' };

      const adminFlag = (data as { username: string; password: string; is_admin: boolean }).is_admin ?? false;

      localStorage.setItem(LS_AUTH, trimUser);
      localStorage.setItem(LS_IS_ADMIN, adminFlag ? 'true' : 'false');
      setUsername(trimUser);
      setSupabaseUsername(trimUser);
      setIsAdmin(adminFlag);
      await fetchSecretsAndReady();
      return {};
    },
    [fetchSecretsAndReady]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(LS_AUTH);
    localStorage.removeItem(LS_IS_ADMIN);
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
