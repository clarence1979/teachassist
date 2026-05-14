import { useState } from 'react';
import { clsx } from 'clsx';
import {
  Sparkles, X, Check, CheckCheck, XCircle, ChevronDown, ChevronUp,
  Loader2, AlertTriangle, Settings2,
} from 'lucide-react';
import type { GhostBlock, TeacherPreferences } from '../../lib/timetable/aiPopulate';
import { fmtTime, parseLocal } from '../../lib/timetable/dates';
import { typeColor } from './blockTypes';

// ─── Preferences panel ────────────────────────────────────────────────────────

interface PrefsFormProps {
  prefs: TeacherPreferences;
  onChange: (p: TeacherPreferences) => void;
  onClose: () => void;
}

export function AIPrefsPanel({ prefs, onChange, onClose }: PrefsFormProps) {
  const [local, setLocal] = useState<TeacherPreferences>(prefs);
  const set = <K extends keyof TeacherPreferences>(k: K, v: TeacherPreferences[K]) =>
    setLocal((p) => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-[65] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-bg-panel border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="shrink-0 px-4 py-3 flex items-center justify-between border-b border-border bg-bg-elevated">
          <h2 className="font-orbitron text-sm font-bold text-text-primary">AI SCHEDULE PREFERENCES</h2>
          <button onClick={onClose} className="p-1 text-text-dim hover:text-text-primary transition-colors"><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Work start</div>
              <input type="number" min={5} max={10} value={local.workDayStart} onChange={(e) => set('workDayStart', +e.target.value)} className="input text-sm" />
            </label>
            <label className="block">
              <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Work end</div>
              <input type="number" min={14} max={22} value={local.workDayEnd} onChange={(e) => set('workDayEnd', +e.target.value)} className="input text-sm" />
            </label>
            <label className="block">
              <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Sleep start (hr)</div>
              <input type="number" min={20} max={24} value={local.sleepStart} onChange={(e) => set('sleepStart', +e.target.value)} className="input text-sm" />
            </label>
            <label className="block">
              <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Wake time (hr)</div>
              <input type="number" min={4} max={9} value={local.sleepEnd} onChange={(e) => set('sleepEnd', +e.target.value)} className="input text-sm" />
            </label>
            <label className="block">
              <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Break interval (min)</div>
              <input type="number" min={45} max={180} step={15} value={local.breakIntervalMinutes} onChange={(e) => set('breakIntervalMinutes', +e.target.value)} className="input text-sm" />
            </label>
            <label className="block">
              <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Meeting buffer (min)</div>
              <input type="number" min={0} max={30} step={5} value={local.meetingBufferMinutes} onChange={(e) => set('meetingBufferMinutes', +e.target.value)} className="input text-sm" />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={local.exerciseEnabled} onChange={(e) => set('exerciseEnabled', e.target.checked)} className="accent-accent-cyan" />
              <span className="text-sm text-text-secondary font-rajdhani font-semibold">Schedule daily exercise</span>
            </label>
            {local.exerciseEnabled && (
              <input type="number" min={20} max={120} step={5} value={local.exerciseMinutes} onChange={(e) => set('exerciseMinutes', +e.target.value)} className="input text-sm w-20" />
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(['breakfast', 'lunch', 'dinner'] as const).map((m) => (
              <label key={m} className="block">
                <div className="text-[10px] font-mono text-text-dim uppercase mb-1">{m} (min)</div>
                <input type="number" min={10} max={90} step={5} value={local.mealDurations[m]} onChange={(e) => set('mealDurations', { ...local.mealDurations, [m]: +e.target.value })} className="input text-sm" />
              </label>
            ))}
          </div>

          <div>
            <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Family commitments / notes for AI</div>
            <textarea value={local.familyCommitments ?? ''} onChange={(e) => set('familyCommitments', e.target.value)} placeholder="E.g. school pickup at 3:30 on Mon/Wed, date night Friday evening..." className="input text-sm min-h-[60px] resize-none" rows={3} />
          </div>

          {local.learnedPreferences.length > 0 && (
            <div>
              <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Learned preferences ({local.learnedPreferences.length})</div>
              <div className="space-y-1 max-h-32 overflow-auto">
                {local.learnedPreferences.map((lp, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px] font-mono text-text-secondary">
                    <button onClick={() => set('learnedPreferences', local.learnedPreferences.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300 mt-px"><X size={9} /></button>
                    <span>{lp.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0 px-4 py-3 border-t border-border bg-bg-elevated flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Cancel</button>
          <button onClick={() => { onChange(local); onClose(); }} className="px-4 py-2 rounded-btn bg-accent-amber text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all">Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Ghost block list ─────────────────────────────────────────────────────────

interface GhostBlockItemProps {
  ghost: GhostBlock;
  onAccept: () => void;
  onReject: () => void;
}

function GhostBlockItem({ ghost, onAccept, onReject }: GhostBlockItemProps) {
  const [expanded, setExpanded] = useState(false);
  const color = typeColor(ghost.type, ghost.color);
  const day = parseLocal(ghost.startISO).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div
      className={clsx(
        'rounded-btn border transition-all',
        ghost.status === 'accepted' && 'opacity-50',
        ghost.status === 'rejected' && 'opacity-30 line-through',
      )}
      style={{ borderColor: `${color}50`, background: `${color}0d` }}
    >
      <div className="px-3 py-2 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-rajdhani font-bold truncate" style={{ color }}>{ghost.title}</div>
          <div className="text-[9px] font-mono text-text-dim">{day} · {fmtTime(ghost.startISO)}–{fmtTime(ghost.endISO)}</div>
        </div>
        {ghost.status === 'pending' && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onAccept} title="Accept" className="p-1 rounded text-accent-green hover:bg-accent-green/10 transition-colors"><Check size={12} /></button>
            <button onClick={onReject} title="Reject" className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors"><XCircle size={12} /></button>
          </div>
        )}
        {ghost.status === 'accepted' && <Check size={12} className="text-accent-green shrink-0" />}
        {ghost.status === 'rejected' && <XCircle size={12} className="text-red-400 shrink-0" />}
        <button onClick={() => setExpanded((s) => !s)} className="p-1 text-text-dim hover:text-text-primary transition-colors">
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-2 text-[10px] font-mono text-text-dim border-t border-white/5 pt-2">
          <span className="text-text-secondary">Rationale: </span>{ghost.rationale}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface AIWeekPanelProps {
  ghosts: GhostBlock[];
  loading: boolean;
  error: string | null;
  prefs: TeacherPreferences;
  onPrefsChange: (p: TeacherPreferences) => void;
  onGenerate: () => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
  weekLabel: string;
}

export function AIWeekPanel({
  ghosts, loading, error, prefs, onPrefsChange, onGenerate,
  onAccept, onReject, onAcceptAll, onRejectAll, onClose, weekLabel,
}: AIWeekPanelProps) {
  const [showPrefs, setShowPrefs] = useState(false);
  const pending = ghosts.filter((g) => g.status === 'pending');
  const accepted = ghosts.filter((g) => g.status === 'accepted');
  const rejected = ghosts.filter((g) => g.status === 'rejected');

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/40" onClick={onClose} />
      <div className="fixed right-4 top-24 bottom-4 z-[56] w-80 bg-bg-panel border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-border bg-bg-elevated flex items-center gap-2">
          <div className="p-1.5 rounded bg-accent-cyan/10 border border-accent-cyan/30">
            <Sparkles size={14} className="text-accent-cyan" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-orbitron text-sm font-bold text-text-primary">AI WEEK PLAN</h2>
            <p className="text-[10px] font-mono text-text-dim truncate">{weekLabel}</p>
          </div>
          <button onClick={() => setShowPrefs(true)} title="Preferences" className="p-1 text-text-dim hover:text-text-primary transition-colors"><Settings2 size={14} /></button>
          <button onClick={onClose} className="p-1 text-text-dim hover:text-text-primary transition-colors"><X size={14} /></button>
        </div>

        {/* Generate button */}
        <div className="shrink-0 p-3 border-b border-border">
          <button
            onClick={onGenerate}
            disabled={loading}
            className={clsx(
              'w-full py-2 rounded-btn font-rajdhani font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2',
              loading
                ? 'bg-bg-elevated border border-border text-text-dim cursor-not-allowed'
                : 'bg-gradient-to-r from-accent-cyan/80 to-accent-cyan text-bg-base hover:brightness-110',
            )}
          >
            {loading ? <><Loader2 size={13} className="animate-spin" />Generating…</> : <><Sparkles size={13} />Generate full week</>}
          </button>
          {error && (
            <div className="mt-2 p-2 rounded-btn bg-red-500/10 border border-red-500/30 flex items-start gap-2">
              <AlertTriangle size={12} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-[10px] font-mono text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Block list */}
        {ghosts.length > 0 && (
          <>
            <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-2">
              <span className="text-[10px] font-mono text-text-dim flex-1">
                {pending.length} pending · {accepted.length} accepted · {rejected.length} rejected
              </span>
              {pending.length > 0 && (
                <>
                  <button onClick={onAcceptAll} title="Accept all" className="px-2 py-1 rounded-btn bg-accent-green/10 border border-accent-green/30 text-accent-green text-[10px] font-rajdhani font-bold uppercase tracking-wider hover:bg-accent-green/20 transition-colors flex items-center gap-1"><CheckCheck size={10} />All</button>
                  <button onClick={onRejectAll} title="Reject all" className="px-2 py-1 rounded-btn bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-rajdhani font-bold uppercase tracking-wider hover:bg-red-500/20 transition-colors flex items-center gap-1"><XCircle size={10} />None</button>
                </>
              )}
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1.5">
              {ghosts.map((g) => (
                <GhostBlockItem key={g.id} ghost={g} onAccept={() => onAccept(g.id)} onReject={() => onReject(g.id)} />
              ))}
            </div>
          </>
        )}

        {ghosts.length === 0 && !loading && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
            <Sparkles size={32} className="text-text-dim opacity-40" />
            <p className="text-xs text-text-dim font-mono">Click "Generate full week" to let AI propose a complete, balanced schedule for this week including sleep, meals, breaks, and tasks.</p>
          </div>
        )}
      </div>

      {showPrefs && (
        <AIPrefsPanel prefs={prefs} onChange={onPrefsChange} onClose={() => setShowPrefs(false)} />
      )}
    </>
  );
}
