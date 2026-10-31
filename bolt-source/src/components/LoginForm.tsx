import { useState } from 'react';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { clsx } from 'clsx';
import { TeachAssistIcon } from './TeachAssistLogo';
import { useCredentials } from '../contexts/CredentialsContext';

export function LoginForm() {
  const { login } = useCredentials();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);
    if (result.error) setError(result.error);
  };

  return (
    <div className="min-h-screen bg-bg-base grid-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-4 mb-8">
          <TeachAssistIcon size={48} className="text-accent-cyan" />
          <div className="text-center">
            <h1 className="font-orbitron text-2xl font-bold text-text-primary tracking-wider">
              TEACH ASSIST
            </h1>
            <p className="text-xs text-text-dim mt-1 font-mono uppercase tracking-widest">
              Sign in to continue
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-bg-panel border border-border rounded-lg p-6 space-y-5 shadow-lg"
        >
          <div className="space-y-2">
            <label
              htmlFor="login-username"
              className="block text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider"
            >
              Username
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              placeholder="Enter your username"
              className={clsx(
                'w-full bg-bg-elevated border rounded-btn px-3 py-2.5',
                'text-sm text-text-primary placeholder:text-text-dim',
                'caret-accent-cyan outline-none transition-colors',
                error ? 'border-accent-red' : 'border-border focus:border-accent-cyan'
              )}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="login-password"
              className="block text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="login-password"
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="Enter your password"
                className={clsx(
                  'w-full bg-bg-elevated border rounded-btn px-3 py-2.5 pr-10',
                  'text-sm text-text-primary placeholder:text-text-dim',
                  'caret-accent-cyan outline-none transition-colors',
                  error ? 'border-accent-red' : 'border-border focus:border-accent-cyan'
                )}
              />
              <button
                type="button"
                onClick={() => setShowPass((s) => !s)}
                aria-label={showPass ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-secondary transition-colors"
              >
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/30 rounded-btn px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={clsx(
              'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-btn',
              'font-rajdhani font-semibold text-sm uppercase tracking-wider transition-colors',
              'border border-accent-cyan text-accent-cyan hover:bg-accent-cyan/10',
              'focus:outline-none focus:ring-2 focus:ring-accent-cyan',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border border-accent-cyan border-t-transparent rounded-full animate-spin" />
                Signing in...
              </span>
            ) : (
              <>
                <LogIn size={14} />
                Sign In
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
