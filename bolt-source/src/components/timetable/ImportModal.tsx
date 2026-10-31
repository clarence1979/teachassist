import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  X, Upload, Image as ImageIcon, FileText, Loader2, AlertTriangle,
  Check, ArrowLeft, ArrowRight, Clock, CalendarDays, Plus, Trash2,
  Sparkles, Calendar,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDb } from '../../db/DbContext';
import { useCredentials } from '../../contexts/CredentialsContext';
import {
  callVisionImport, expandCycle, buildClassBlocks,
  nextMondayOnOrAfter,
  type ExtractedTimetable, type ExtractedBlock, type ExtractedPeriod,
  type CycleConfig,
} from '../../lib/timetable/importImage';
import { isoDate } from '../../lib/timetable/dates';
import { parseICSToBlocks } from '../../lib/timetable/icsParser';

type Mode = 'image' | 'ics';
type Step = 'upload' | 'review' | 'cycle' | 'done';

interface Props {
  onClose: () => void;
}

const DEFAULT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export function TimetableImportModal({ onClose }: Props) {
  const db = useDb();
  const { getKey } = useCredentials();
  const [mode, setMode] = useState<Mode>('image');
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedTimetable | null>(null);

  // ── ICS-mode state ──
  const [icsFile, setIcsFile] = useState<File | null>(null);
  const [icsPreview, setIcsPreview] = useState<{ count: number; skipped: number; sample: string[] } | null>(null);
  const [icsConflictMode, setIcsConflictMode] = useState<'replace' | 'merge'>('merge');
  const icsRef = useRef<HTMLInputElement>(null);
  const [fallbackStart, setFallbackStart] = useState('09:00');
  const [fallbackDuration, setFallbackDuration] = useState(60);
  const [fallbackBreak, setFallbackBreak] = useState(5);
  const [weeksInCycle, setWeeksInCycle] = useState(1);
  const [startDate, setStartDate] = useState(() => isoDate(nextMondayOnOrAfter(new Date())));
  const [monthsHorizon, setMonthsHorizon] = useState(12);
  const [defaultLocation, setDefaultLocation] = useState('');
  const [conflictMode, setConflictMode] = useState<'replace' | 'merge'>('merge');
  const [existingImportedCount, setExistingImportedCount] = useState<number | null>(null);
  const [result, setResult] = useState<{ added: number; removed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const anthropicKey = getKey('anthropic');
  const openaiKey = getKey('openai');

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setError(null);
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  }, []);

  useEffect(() => {
    if (step !== 'upload') return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) handleFile(f);
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [step, handleFile]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const runImport = useCallback(async () => {
    if (!file) return;
    if (!anthropicKey && !openaiKey) {
      setError('Add an Anthropic or OpenAI API key in Settings first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await callVisionImport({ file, anthropicKey, openaiKey });
      if (data.blocks.length === 0) {
        setError('The model did not return any blocks. Try a clearer image.');
      }
      // Ensure unique sorted days & periods
      if (data.days.length === 0) data.days = DEFAULT_DAYS;
      if (data.periods.length === 0) {
        const nums = Array.from(new Set(data.blocks.map((b) => b.periodNumber))).sort((a, b) => a - b);
        data.periods = nums.map((n) => ({ number: n, startTime: null, endTime: null }));
      }
      setExtracted(data);
      setStep('review');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [file, anthropicKey, openaiKey]);

  const timesMissing = useMemo(
    () => !!extracted && !extracted.periods.some((p) => p.startTime && p.endTime),
    [extracted],
  );

  const cycleConfig: CycleConfig = useMemo(
    () => ({
      weeksInCycle,
      startDate: new Date(`${startDate}T00:00:00`),
      monthsHorizon,
      fallbackPeriod1Start: timesMissing ? fallbackStart : undefined,
      fallbackPeriodMinutes: timesMissing ? fallbackDuration : undefined,
      interPeriodBreakMinutes: fallbackBreak,
      defaultLocation: defaultLocation || undefined,
    }),
    [weeksInCycle, startDate, monthsHorizon, timesMissing, fallbackStart, fallbackDuration, fallbackBreak, defaultLocation],
  );

  const preview12 = useMemo(() => {
    if (!extracted) return [];
    try {
      return expandCycle(extracted, cycleConfig, extracted.days);
    } catch {
      return [];
    }
  }, [extracted, cycleConfig]);

  const goToCycle = async () => {
    // Count existing imported blocks to warn about replace-vs-merge
    const existing = await db.timetableBlocks.filter((b) => b.source === 'imported').count();
    setExistingImportedCount(existing);
    setStep('cycle');
  };

  // ── ICS handlers ──────────────────────────────────────────────────────────

  const handleIcsFile = useCallback(async (f: File) => {
    setIcsFile(f);
    setIcsPreview(null);
    setError(null);
    try {
      const text = await f.text();
      const { blocks, skipped } = parseICSToBlocks(text);
      setIcsPreview({
        count: blocks.length,
        skipped,
        sample: blocks.slice(0, 5).map((b) => b.title),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const applyIcsImport = useCallback(async () => {
    if (!icsFile) return;
    setBusy(true);
    setError(null);
    try {
      const text = await icsFile.text();
      const { blocks } = parseICSToBlocks(text);
      const now = Date.now();
      const withTs = blocks.map((b) => ({ ...b, createdAt: now }));

      let removed = 0;
      if (icsConflictMode === 'replace') {
        const toRemove = await db.timetableBlocks.filter((b) => b.source === 'imported').toArray();
        removed = toRemove.length;
        await db.timetableBlocks.bulkDelete(toRemove.map((b) => b.id));
      }
      await db.timetableBlocks.bulkAdd(withTs);
      setResult({ added: withTs.length, removed });
      setStep('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [icsFile, icsConflictMode, db]);

  const applyImport = useCallback(async () => {
    if (!extracted) return;
    setBusy(true);
    setError(null);
    try {
      const tag = `${weeksInCycle}wk-${startDate}`;
      const expanded = expandCycle(extracted, cycleConfig, extracted.days);
      const newBlocks = buildClassBlocks(expanded, tag);

      let removed = 0;
      if (conflictMode === 'replace') {
        const toRemove = await db.timetableBlocks.filter((b) => b.source === 'imported').toArray();
        removed = toRemove.length;
        await db.timetableBlocks.bulkDelete(toRemove.map((b) => b.id));
      }
      await db.timetableBlocks.bulkAdd(newBlocks);
      setResult({ added: newBlocks.length, removed });
      setStep('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [extracted, cycleConfig, conflictMode, weeksInCycle, startDate, db]);

  // ── Extracted table editors ──
  const setPeriod = (idx: number, patch: Partial<ExtractedPeriod>) => {
    if (!extracted) return;
    const periods = extracted.periods.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    setExtracted({ ...extracted, periods });
  };

  const setBlock = (idx: number, patch: Partial<ExtractedBlock>) => {
    if (!extracted) return;
    const blocks = extracted.blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b));
    setExtracted({ ...extracted, blocks });
  };

  const addBlock = () => {
    if (!extracted) return;
    const day = extracted.days[0] ?? 'Monday';
    const pn = extracted.periods[0]?.number ?? 1;
    setExtracted({
      ...extracted,
      blocks: [...extracted.blocks, { day, periodNumber: pn, subject: 'New class', week: 1 }],
    });
  };

  const removeBlock = (idx: number) => {
    if (!extracted) return;
    setExtracted({ ...extracted, blocks: extracted.blocks.filter((_, i) => i !== idx) });
  };

  const addPeriod = () => {
    if (!extracted) return;
    const maxNum = extracted.periods.reduce((m, p) => Math.max(m, p.number), 0);
    setExtracted({ ...extracted, periods: [...extracted.periods, { number: maxNum + 1, startTime: null, endTime: null }] });
  };

  const removePeriod = (idx: number) => {
    if (!extracted) return;
    setExtracted({ ...extracted, periods: extracted.periods.filter((_, i) => i !== idx) });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl max-h-[92vh] bg-bg-panel border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3 mb-3">
            <div className={clsx('p-1.5 rounded border', mode === 'ics' ? 'bg-accent-amber/10 border-accent-amber/30' : 'bg-accent-cyan/10 border-accent-cyan/30')}>
              {mode === 'ics' ? <Calendar size={14} className="text-accent-amber" /> : <ImageIcon size={14} className="text-accent-cyan" />}
            </div>
            <h2 className="font-orbitron text-sm font-bold text-text-primary tracking-wider flex-1">
              {mode === 'ics' ? 'IMPORT FROM .ICS CALENDAR FILE' : 'IMPORT TIMETABLE FROM IMAGE / PDF'}
            </h2>
            <button onClick={onClose} className="p-1 text-text-dim hover:text-text-primary transition-colors"><X size={16} /></button>
          </div>

          {/* Mode tabs — only visible on upload step */}
          {step === 'upload' && (
            <div className="flex gap-1 mb-1">
              <button
                onClick={() => { setMode('image'); setError(null); }}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-[10px] font-rajdhani font-bold uppercase tracking-wider transition-all border',
                  mode === 'image' ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan' : 'border-border text-text-dim hover:text-text-secondary',
                )}
              >
                <ImageIcon size={10} /> Image / PDF
              </button>
              <button
                onClick={() => { setMode('ics'); setError(null); }}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-[10px] font-rajdhani font-bold uppercase tracking-wider transition-all border',
                  mode === 'ics' ? 'bg-accent-amber/10 border-accent-amber text-accent-amber' : 'border-border text-text-dim hover:text-text-secondary',
                )}
              >
                <Calendar size={10} /> .ics File
              </button>
            </div>
          )}

          {/* Step breadcrumb — image mode only */}
          {mode === 'image' && (
            <div className="flex items-center gap-2 mt-1">
              {(['upload', 'review', 'cycle', 'done'] as const).map((s, i) => (
                <div key={s} className="flex items-center gap-1">
                  <span className={clsx(
                    'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all',
                    step === s ? 'bg-accent-cyan text-bg-base' :
                      (['upload', 'review', 'cycle', 'done'] as const).indexOf(step) > i
                        ? 'bg-accent-green/80 text-bg-base'
                        : 'bg-bg-panel border border-border text-text-dim',
                  )}>
                    {i + 1}
                  </span>
                  <span className={clsx('text-[10px] font-rajdhani font-semibold uppercase tracking-wider', step === s ? 'text-accent-cyan' : 'text-text-dim')}>{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-5">
          {step === 'upload' && mode === 'ics' && (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div
                className={clsx(
                  'w-full max-w-xl border-2 border-dashed rounded-lg p-10 text-center transition-all cursor-pointer',
                  icsFile ? 'border-accent-amber/60 bg-accent-amber/5' : 'border-border hover:border-accent-amber/50 hover:bg-accent-amber/5',
                )}
                onClick={() => icsRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleIcsFile(f); }}
              >
                <input
                  ref={icsRef}
                  type="file"
                  accept=".ics,text/calendar"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleIcsFile(f); e.target.value = ''; }}
                />
                {!icsFile ? (
                  <>
                    <Calendar size={32} className="mx-auto text-text-dim mb-3" />
                    <p className="text-sm text-text-primary font-rajdhani font-semibold mb-1">Drop your .ics calendar file here</p>
                    <p className="text-[11px] font-mono text-text-dim mb-1">Exported from Apple iCloud, Google Calendar, Outlook, or any iCalendar app</p>
                    <p className="text-[10px] font-mono text-text-dim opacity-60">Drag & drop or click to browse</p>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Calendar size={32} className="mx-auto text-accent-amber" />
                    <p className="text-xs font-mono text-text-secondary">{icsFile.name} · {(icsFile.size / 1024).toFixed(0)} KB</p>
                    {icsPreview && (
                      <div className="mt-3 p-3 rounded-btn border border-border bg-bg-base text-left space-y-1">
                        <p className="text-[11px] text-accent-amber font-bold">{icsPreview.count} events found{icsPreview.skipped > 0 ? ` · ${icsPreview.skipped} skipped` : ''}</p>
                        {icsPreview.sample.map((t, i) => (
                          <p key={i} className="text-[10px] font-mono text-text-dim truncate">· {t}</p>
                        ))}
                        {icsPreview.count > 5 && <p className="text-[10px] text-text-dim">…and {icsPreview.count - 5} more</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* How to export instructions */}
              <div className="w-full max-w-xl grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-btn border border-border bg-bg-elevated space-y-1">
                  <div className="text-[10px] font-rajdhani font-bold uppercase tracking-wider text-text-dim flex items-center gap-1.5"><Calendar size={10} /> From Apple iCloud</div>
                  <ol className="text-[10px] text-text-dim space-y-0.5 list-decimal list-inside">
                    <li>Open <span className="text-text-secondary">Calendar.app</span> on Mac</li>
                    <li>File → Export → Export…</li>
                    <li>Save as <span className="font-mono">.ics</span> and upload here</li>
                  </ol>
                </div>
                <div className="p-3 rounded-btn border border-border bg-bg-elevated space-y-1">
                  <div className="text-[10px] font-rajdhani font-bold uppercase tracking-wider text-text-dim flex items-center gap-1.5"><Calendar size={10} /> From Google Calendar</div>
                  <ol className="text-[10px] text-text-dim space-y-0.5 list-decimal list-inside">
                    <li>Open <span className="text-text-secondary">Google Calendar</span> settings</li>
                    <li>Import &amp; export → Export</li>
                    <li>Unzip, pick a <span className="font-mono">.ics</span> and upload here</li>
                  </ol>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-btn border border-red-500/40 bg-red-500/10 max-w-xl w-full">
                  <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              {/* Conflict mode */}
              {icsPreview && icsPreview.count > 0 && (
                <div className="w-full max-w-xl p-3 rounded-btn border border-border bg-bg-elevated space-y-2">
                  <p className="text-[10px] font-mono text-text-dim uppercase tracking-wider">Conflict with existing imports</p>
                  <div className="flex gap-2">
                    <button onClick={() => setIcsConflictMode('merge')} className={clsx('flex-1 px-3 py-1.5 rounded-btn border text-[11px] font-rajdhani font-semibold uppercase tracking-wider', icsConflictMode === 'merge' ? 'border-accent-amber bg-accent-amber/10 text-accent-amber' : 'border-border text-text-secondary')}>Merge</button>
                    <button onClick={() => setIcsConflictMode('replace')} className={clsx('flex-1 px-3 py-1.5 rounded-btn border text-[11px] font-rajdhani font-semibold uppercase tracking-wider', icsConflictMode === 'replace' ? 'border-red-500 bg-red-500/10 text-red-400' : 'border-border text-text-secondary')}>Replace existing imports</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'upload' && mode === 'image' && (
            <div
              className="flex flex-col items-center justify-center gap-4 py-8"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
            >
              <div
                className={clsx(
                  'w-full max-w-xl border-2 border-dashed rounded-lg p-10 text-center transition-all cursor-pointer',
                  file ? 'border-accent-cyan/60 bg-accent-cyan/5' : 'border-border hover:border-accent-cyan/50 hover:bg-accent-cyan/5',
                )}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                {!file ? (
                  <>
                    <Upload size={32} className="mx-auto text-text-dim mb-3" />
                    <p className="text-sm text-text-primary font-rajdhani font-semibold mb-1">Drop timetable screenshot or PDF here</p>
                    <p className="text-[11px] font-mono text-text-dim mb-1">PNG · JPG · WEBP · PDF (first page)</p>
                    <p className="text-[10px] font-mono text-text-dim opacity-60">or paste an image with Ctrl+V / Cmd+V</p>
                  </>
                ) : (
                  <div className="space-y-2">
                    {preview ? (
                      <img src={preview} alt={file.name} className="max-h-64 mx-auto rounded border border-border" />
                    ) : (
                      <FileText size={32} className="mx-auto text-accent-cyan" />
                    )}
                    <p className="text-xs font-mono text-text-secondary">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                )}
              </div>

              {!anthropicKey && !openaiKey && (
                <div className="flex items-start gap-2 p-3 rounded-btn border border-accent-amber/40 bg-accent-amber/10 max-w-xl">
                  <AlertTriangle size={14} className="text-accent-amber shrink-0 mt-0.5" />
                  <p className="text-xs text-accent-amber">
                    No vision-capable API key found. Add either an Anthropic (Claude) or OpenAI key in Settings to continue.
                  </p>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-btn border border-red-500/40 bg-red-500/10 max-w-xl">
                  <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              <button
                onClick={runImport}
                disabled={!file || busy || (!anthropicKey && !openaiKey)}
                className={clsx(
                  'px-5 py-2 rounded-btn font-rajdhani font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2',
                  !file || busy || (!anthropicKey && !openaiKey)
                    ? 'bg-bg-elevated border border-border text-text-dim cursor-not-allowed'
                    : 'bg-accent-cyan text-bg-base hover:brightness-110',
                )}
              >
                {busy ? <><Loader2 size={13} className="animate-spin" />Analysing…</> : <><Sparkles size={13} />Extract with {anthropicKey ? 'Claude Opus' : 'GPT-4o'}</>}
              </button>
            </div>
          )}

          {step === 'review' && extracted && (
            <div className="space-y-5">
              <div>
                <h3 className="font-rajdhani font-bold text-sm text-text-primary uppercase tracking-wider mb-1">Review extracted timetable</h3>
                <p className="text-xs text-text-dim">Correct any misread values before expanding to the calendar.</p>
              </div>

              {/* Periods */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] font-mono text-text-dim uppercase tracking-wider flex items-center gap-1"><Clock size={11} />Periods</h4>
                  <button onClick={addPeriod} className="text-[10px] text-accent-cyan hover:text-text-primary font-rajdhani font-semibold uppercase tracking-wider flex items-center gap-1"><Plus size={10} />Add</button>
                </div>
                {timesMissing && (
                  <div className="mb-2 p-2 rounded-btn border border-accent-amber/30 bg-accent-amber/10 flex items-start gap-2">
                    <AlertTriangle size={11} className="text-accent-amber shrink-0 mt-0.5" />
                    <p className="text-[11px] text-accent-amber">Your screenshot didn't show period times. You'll set Period 1 start + duration on the next step.</p>
                  </div>
                )}
                <div className="border border-border rounded-btn overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-bg-elevated">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-rajdhani font-semibold uppercase tracking-wider text-[10px] text-text-dim">#</th>
                        <th className="px-2 py-1.5 text-left font-rajdhani font-semibold uppercase tracking-wider text-[10px] text-text-dim">Start</th>
                        <th className="px-2 py-1.5 text-left font-rajdhani font-semibold uppercase tracking-wider text-[10px] text-text-dim">End</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {extracted.periods.map((p, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-2 py-1"><input type="number" value={p.number} onChange={(e) => setPeriod(i, { number: +e.target.value })} className="input text-xs py-1 w-14" /></td>
                          <td className="px-2 py-1"><input type="time" value={p.startTime ?? ''} onChange={(e) => setPeriod(i, { startTime: e.target.value || null })} className="input text-xs py-1" /></td>
                          <td className="px-2 py-1"><input type="time" value={p.endTime ?? ''} onChange={(e) => setPeriod(i, { endTime: e.target.value || null })} className="input text-xs py-1" /></td>
                          <td><button onClick={() => removePeriod(i)} className="p-1 text-text-dim hover:text-red-400"><Trash2 size={11} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Blocks */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] font-mono text-text-dim uppercase tracking-wider">Class blocks ({extracted.blocks.length})</h4>
                  <button onClick={addBlock} className="text-[10px] text-accent-cyan hover:text-text-primary font-rajdhani font-semibold uppercase tracking-wider flex items-center gap-1"><Plus size={10} />Add</button>
                </div>
                <div className="border border-border rounded-btn overflow-hidden max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-bg-elevated sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-rajdhani font-semibold uppercase tracking-wider text-[10px] text-text-dim">Day</th>
                        <th className="px-2 py-1.5 text-left font-rajdhani font-semibold uppercase tracking-wider text-[10px] text-text-dim">Period</th>
                        <th className="px-2 py-1.5 text-left font-rajdhani font-semibold uppercase tracking-wider text-[10px] text-text-dim">Week</th>
                        <th className="px-2 py-1.5 text-left font-rajdhani font-semibold uppercase tracking-wider text-[10px] text-text-dim">Subject</th>
                        <th className="px-2 py-1.5 text-left font-rajdhani font-semibold uppercase tracking-wider text-[10px] text-text-dim">Class code</th>
                        <th className="px-2 py-1.5 text-left font-rajdhani font-semibold uppercase tracking-wider text-[10px] text-text-dim">Room</th>
                        <th className="px-2 py-1.5 text-left font-rajdhani font-semibold uppercase tracking-wider text-[10px] text-text-dim">Teacher</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {extracted.blocks.map((b, i) => (
                        <tr key={i} className="border-t border-border hover:bg-bg-elevated/50">
                          <td className="px-2 py-1">
                            <select value={b.day} onChange={(e) => setBlock(i, { day: e.target.value })} className="input text-xs py-1">
                              {extracted.days.map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1"><input type="number" value={b.periodNumber} onChange={(e) => setBlock(i, { periodNumber: +e.target.value })} className="input text-xs py-1 w-14" /></td>
                          <td className="px-2 py-1"><input type="number" min={1} value={b.week ?? 1} onChange={(e) => setBlock(i, { week: +e.target.value })} className="input text-xs py-1 w-14" /></td>
                          <td className="px-2 py-1"><input value={b.subject} onChange={(e) => setBlock(i, { subject: e.target.value })} className="input text-xs py-1" /></td>
                          <td className="px-2 py-1"><input value={b.classCode ?? ''} onChange={(e) => setBlock(i, { classCode: e.target.value || null })} className="input text-xs py-1 w-20" /></td>
                          <td className="px-2 py-1"><input value={b.room ?? ''} onChange={(e) => setBlock(i, { room: e.target.value || null })} className="input text-xs py-1 w-20" /></td>
                          <td className="px-2 py-1"><input value={b.teacher ?? ''} onChange={(e) => setBlock(i, { teacher: e.target.value || null })} className="input text-xs py-1 w-28" /></td>
                          <td><button onClick={() => removeBlock(i)} className="p-1 text-text-dim hover:text-red-400"><Trash2 size={11} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {step === 'cycle' && extracted && (
            <div className="space-y-5 max-w-2xl">
              <div>
                <h3 className="font-rajdhani font-bold text-sm text-text-primary uppercase tracking-wider mb-1 flex items-center gap-2"><CalendarDays size={14} />Schedule pattern</h3>
                <p className="text-xs text-text-dim">Configure how this timetable repeats across the coming year.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label>
                  <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Cycle length</div>
                  <select value={weeksInCycle} onChange={(e) => setWeeksInCycle(+e.target.value)} className="input text-sm">
                    <option value={1}>1 week</option>
                    <option value={2}>2 weeks (A/B)</option>
                    <option value={6}>6 weeks</option>
                    <option value={10}>10 weeks (term)</option>
                  </select>
                </label>
                <label>
                  <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Cycle start date (Monday)</div>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input text-sm" />
                </label>
                <label>
                  <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Expand for (months)</div>
                  <input type="number" min={1} max={24} value={monthsHorizon} onChange={(e) => setMonthsHorizon(+e.target.value)} className="input text-sm" />
                </label>
                <label>
                  <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Default room fallback (optional)</div>
                  <input value={defaultLocation} onChange={(e) => setDefaultLocation(e.target.value)} placeholder="e.g. M12" className="input text-sm" />
                </label>
              </div>

              {timesMissing && (
                <div className="p-3 rounded-btn border border-accent-amber/40 bg-accent-amber/10 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={12} className="text-accent-amber shrink-0 mt-0.5" />
                    <p className="text-xs text-accent-amber">Your screenshot didn't show period times. Set when Period 1 starts and how long each period is.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <label>
                      <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Period 1 start</div>
                      <input type="time" value={fallbackStart} onChange={(e) => setFallbackStart(e.target.value)} className="input text-sm" />
                    </label>
                    <label>
                      <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Period duration (min)</div>
                      <input type="number" min={20} max={120} step={5} value={fallbackDuration} onChange={(e) => setFallbackDuration(+e.target.value)} className="input text-sm" />
                    </label>
                    <label>
                      <div className="text-[10px] font-mono text-text-dim uppercase mb-1">Inter-period break (min)</div>
                      <input type="number" min={0} max={30} step={1} value={fallbackBreak} onChange={(e) => setFallbackBreak(+e.target.value)} className="input text-sm" />
                    </label>
                  </div>
                </div>
              )}

              {existingImportedCount != null && existingImportedCount > 0 && (
                <div className="p-3 rounded-btn border border-border bg-bg-elevated space-y-2">
                  <p className="text-xs text-text-secondary">You have <span className="text-accent-amber font-bold">{existingImportedCount}</span> existing imported class blocks.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setConflictMode('merge')} className={clsx('flex-1 px-3 py-1.5 rounded-btn border text-[11px] font-rajdhani font-semibold uppercase tracking-wider', conflictMode === 'merge' ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan' : 'border-border text-text-secondary')}>Merge (keep existing)</button>
                    <button onClick={() => setConflictMode('replace')} className={clsx('flex-1 px-3 py-1.5 rounded-btn border text-[11px] font-rajdhani font-semibold uppercase tracking-wider', conflictMode === 'replace' ? 'border-red-500 bg-red-500/10 text-red-400' : 'border-border text-text-secondary')}>Replace (delete old imports)</button>
                  </div>
                </div>
              )}

              <div className="p-3 rounded-btn border border-border bg-bg-base">
                <div className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-1">Preview</div>
                <p className="text-xs text-text-secondary">
                  <span className="text-accent-cyan font-bold">{preview12.length}</span> class blocks will be created between{' '}
                  <span className="text-text-primary">{startDate}</span> and the next {monthsHorizon} months.
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-btn border border-red-500/40 bg-red-500/10">
                  <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}
            </div>
          )}

          {step === 'done' && result && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <div className="p-3 rounded-full bg-accent-green/10 border border-accent-green/30">
                <Check size={32} className="text-accent-green" />
              </div>
              <h3 className="font-orbitron text-lg font-bold text-text-primary">IMPORT COMPLETE</h3>
              <p className="text-sm text-text-secondary">
                Added <span className="text-accent-green font-bold">{result.added}</span> class blocks
                {result.removed > 0 && <> · Removed <span className="text-red-400 font-bold">{result.removed}</span> old imports</>}
              </p>
            </div>
          )}
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-border bg-bg-elevated flex items-center gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
          <div className="flex-1" />

          {/* ICS mode footer */}
          {mode === 'ics' && step === 'upload' && icsPreview && icsPreview.count > 0 && (
            <button
              onClick={applyIcsImport}
              disabled={busy}
              className={clsx(
                'px-4 py-2 rounded-btn font-rajdhani font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1',
                busy ? 'bg-bg-elevated border border-border text-text-dim cursor-not-allowed' : 'bg-accent-amber text-bg-base hover:brightness-110',
              )}
            >
              {busy ? <><Loader2 size={11} className="animate-spin" />Importing…</> : <><Check size={11} />Import {icsPreview.count} events</>}
            </button>
          )}

          {/* Image mode footer */}
          {mode === 'image' && step === 'review' && (
            <button onClick={() => setStep('upload')} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1"><ArrowLeft size={11} />Back</button>
          )}
          {mode === 'image' && step === 'cycle' && (
            <button onClick={() => setStep('review')} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1"><ArrowLeft size={11} />Back</button>
          )}
          {mode === 'image' && step === 'review' && extracted && extracted.blocks.length > 0 && (
            <button onClick={goToCycle} className="px-4 py-2 rounded-btn bg-accent-cyan text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-1">
              Configure cycle<ArrowRight size={11} />
            </button>
          )}
          {mode === 'image' && step === 'cycle' && (
            <button
              onClick={applyImport}
              disabled={busy || preview12.length === 0}
              className={clsx(
                'px-4 py-2 rounded-btn font-rajdhani font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1',
                busy || preview12.length === 0 ? 'bg-bg-elevated border border-border text-text-dim cursor-not-allowed' : 'bg-accent-amber text-bg-base hover:brightness-110',
              )}
            >
              {busy ? <><Loader2 size={11} className="animate-spin" />Importing…</> : <><Check size={11} />Create {preview12.length} blocks</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
