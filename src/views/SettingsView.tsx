import { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BarChart3, Download, Upload, AlertTriangle,
  CheckCircle, Accessibility, LogOut,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../contexts/CredentialsContext';
import { useAppStore } from '../store/appStore';
import { useDb } from '../db/DbContext';
import { exportAll, importAll, downloadBackup, type BackupBundle } from '../lib/backup';

function UsageChart() {
  const history = useAppStore((s) => s.usageHistory);
  const sessionUsage = useAppStore((s) => s.sessionUsage);

  const byDay = useMemo(() => {
    const days = new Map<string, { anthropic: number; openai: number }>();
    for (const h of history) {
      const total = h.inputTokens + h.outputTokens;
      const existing = days.get(h.date) ?? { anthropic: 0, openai: 0 };
      existing[h.provider] += total;
      days.set(h.date, existing);
    }
    const out: Array<{ date: string; anthropic: number; openai: number }> = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const e = days.get(key) ?? { anthropic: 0, openai: 0 };
      out.push({ date: key, anthropic: e.anthropic, openai: e.openai });
    }
    return out;
  }, [history]);

  const max = Math.max(1, ...byDay.map((d) => d.anthropic + d.openai));
  const totalAnthropic = byDay.reduce((a, d) => a + d.anthropic, 0);
  const totalOpenai = byDay.reduce((a, d) => a + d.openai, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-btn border border-border bg-bg-elevated">
          <div className="text-[10px] font-mono uppercase text-text-dim tracking-wider">Session (Anthropic)</div>
          <div className="text-lg font-orbitron font-bold text-accent-cyan">
            {(sessionUsage.anthropic.inputTokens + sessionUsage.anthropic.outputTokens).toLocaleString()}
          </div>
          <div className="text-[10px] font-mono text-text-dim">
            {sessionUsage.anthropic.inputTokens.toLocaleString()} in · {sessionUsage.anthropic.outputTokens.toLocaleString()} out
          </div>
        </div>
        <div className="p-3 rounded-btn border border-border bg-bg-elevated">
          <div className="text-[10px] font-mono uppercase text-text-dim tracking-wider">Session (OpenAI)</div>
          <div className="text-lg font-orbitron font-bold text-accent-green">
            {(sessionUsage.openai.inputTokens + sessionUsage.openai.outputTokens).toLocaleString()}
          </div>
          <div className="text-[10px] font-mono text-text-dim">
            {sessionUsage.openai.inputTokens.toLocaleString()} in · {sessionUsage.openai.outputTokens.toLocaleString()} out
          </div>
        </div>
      </div>

      <div className="p-4 rounded-btn border border-border bg-bg-elevated">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-mono uppercase text-text-dim tracking-wider">Last 30 days</div>
          <div className="flex items-center gap-3 text-[10px] font-mono text-text-dim">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-accent-cyan rounded-sm" />Anthropic {totalAnthropic.toLocaleString()}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-accent-green rounded-sm" />OpenAI {totalOpenai.toLocaleString()}</span>
          </div>
        </div>
        <div className="flex items-end gap-0.5 h-28" role="img" aria-label="Daily token usage over the last 30 days">
          {byDay.map((d) => {
            const aH = (d.anthropic / max) * 100;
            const oH = (d.openai / max) * 100;
            const tooltip = `${d.date}: ${(d.anthropic + d.openai).toLocaleString()} tokens`;
            return (
              <div key={d.date} title={tooltip} className="flex-1 flex flex-col justify-end gap-0.5 group cursor-default" aria-label={tooltip}>
                <div style={{ height: `${oH}%` }} className="bg-accent-green/70 group-hover:bg-accent-green min-h-[1px] rounded-sm transition-colors" />
                <div style={{ height: `${aH}%` }} className="bg-accent-cyan/70 group-hover:bg-accent-cyan min-h-[1px] rounded-sm transition-colors" />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[9px] font-mono text-text-dim mt-2">
          <span>{byDay[0]?.date.slice(5)}</span>
          <span>{byDay[byDay.length - 1]?.date.slice(5)}</span>
        </div>
      </div>
    </div>
  );
}

function BackupSection() {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setBusy(true); setMsg(null);
    try {
      const b = await exportAll(db);
      downloadBackup(b);
      setMsg({ kind: 'ok', text: 'Backup downloaded.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  const doImport = async (file: File, mode: 'merge' | 'replace') => {
    setBusy(true); setMsg(null);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as BackupBundle;
      const res = await importAll(db, bundle, mode);
      const total = Object.values(res).reduce((a, b) => a + b, 0);
      setMsg({ kind: 'ok', text: `Imported ${total.toLocaleString()} records.` });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-dim">Export all conversations, tasks, timetable blocks, and generated artifacts as a single JSON file. Import restores them into a new device or browser.</p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={doExport}
          disabled={busy}
          aria-label="Download full backup"
          className="px-3 py-2 rounded-btn border border-accent-cyan/40 text-accent-cyan hover:bg-accent-cyan/10 focus:outline-none focus:ring-2 focus:ring-accent-cyan text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <Download size={13} />Export all (JSON)
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="Import merge backup"
          className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary hover:border-accent-cyan focus:outline-none focus:ring-2 focus:ring-accent-cyan text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <Upload size={13} />Import (merge)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f, 'merge'); }}
        />
      </div>
      {msg && (
        <div className={clsx('flex items-start gap-2 p-2 rounded-btn border text-xs', msg.kind === 'ok' ? 'border-accent-green/40 bg-accent-green/10 text-accent-green' : 'border-red-500/40 bg-red-500/10 text-red-400')}>
          {msg.kind === 'ok' ? <CheckCircle size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}
    </div>
  );
}

export function SettingsView() {
  const navigate = useNavigate();
  const { isIframe, username, logout } = useCredentials();
  const { timezone, setTimezone, reducedMotion, setReducedMotion } = useAppStore();

  return (
    <div className="flex-1 overflow-y-auto grid-bg">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="p-1.5 rounded-btn border border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan transition-colors"
          >
            <ArrowLeft size={14} />
          </button>
          <div className="flex-1">
            <h1 className="font-orbitron text-xl font-bold text-text-primary">Settings</h1>
            {username && (
              <p className="text-xs text-text-dim mt-0.5">
                Signed in as <span className="text-text-secondary font-mono">{username}</span>
              </p>
            )}
          </div>
          {!isIframe && (
            <button
              onClick={logout}
              aria-label="Sign out"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn border border-border text-text-dim hover:border-accent-red hover:text-accent-red transition-colors text-xs font-rajdhani font-semibold uppercase tracking-wider"
            >
              <LogOut size={12} />
              Sign out
            </button>
          )}
        </div>

        {/* Preferences */}
        <section className="space-y-4">
          <h2 className="font-rajdhani text-base font-semibold text-text-primary border-b border-border pb-2">
            Preferences
          </h2>

          <div className="space-y-2">
            <label
              htmlFor="timezone-select"
              className="block text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider"
            >
              Timezone
            </label>
            <select
              id="timezone-select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={clsx(
                'w-full bg-bg-elevated border border-border rounded-btn px-3 py-2',
                'font-mono text-xs text-text-primary',
                'focus:border-accent-cyan outline-none caret-accent-cyan transition-colors'
              )}
            >
              <option value="Australia/Melbourne">Australia/Melbourne</option>
              <option value="Australia/Sydney">Australia/Sydney</option>
              <option value="Australia/Brisbane">Australia/Brisbane</option>
              <option value="Australia/Perth">Australia/Perth</option>
              <option value="Pacific/Auckland">Pacific/Auckland</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Chicago">America/Chicago</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
              <option value="Europe/London">Europe/London</option>
              <option value="UTC">UTC</option>
            </select>
          </div>

          <div className="flex items-start gap-3 pt-2">
            <Accessibility size={14} className="text-text-dim mt-0.5 shrink-0" />
            <div className="flex-1">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={reducedMotion}
                  onChange={(e) => setReducedMotion(e.target.checked)}
                  className="w-4 h-4 rounded border-border bg-bg-elevated accent-accent-cyan cursor-pointer"
                />
                <span className="text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider group-hover:text-text-primary transition-colors">
                  Reduce motion
                </span>
              </label>
              <p className="text-xs text-text-dim mt-1">Disable glow pulses, text-shadow effects, and long transitions.</p>
            </div>
          </div>
        </section>

        {/* Usage */}
        <section className="space-y-4">
          <h2 className="font-rajdhani text-base font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
            <BarChart3 size={14} className="text-accent-cyan" />
            Usage
          </h2>
          <UsageChart />
        </section>

        {/* Backup */}
        <section className="space-y-4">
          <h2 className="font-rajdhani text-base font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
            <Download size={14} className="text-accent-cyan" />
            Backup &amp; Restore
          </h2>
          <BackupSection />
        </section>
      </div>
    </div>
  );
}
