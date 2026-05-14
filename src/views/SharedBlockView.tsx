import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Calendar, Clock, MapPin, StickyNote, Paperclip, Download, ExternalLink,
  FileText, Image as ImageIcon, BookOpen, ClipboardList, Layers, Star, Lock, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { fetchShare, type SharedBlockPayload } from '../lib/timetable/share';
import { TeachAssistIcon } from '../components/TeachAssistLogo';

type Artifact = SharedBlockPayload['artifacts_data'][number];

function artifactIcon(type: Artifact['type']) {
  switch (type) {
    case 'image': return ImageIcon;
    case 'quiz': return ClipboardList;
    case 'slides': return Layers;
    case 'worksheet': return FileText;
    case 'notes': return BookOpen;
    case 'rubric': return Star;
    default: return FileText;
  }
}

const TYPE_COLORS: Record<string, string> = {
  class: '#06b6d4',
  prep: '#f59e0b',
  meeting: '#10b981',
  duty: '#ef4444',
  pd: '#ec4899',
  personal: '#a78bfa',
  custom: '#06b6d4',
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}
function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const src = `data:${artifact.mediaType};base64,${artifact.data}`;
  if (artifact.mediaType?.startsWith('image/')) {
    return <img src={src} alt={artifact.title} className="w-full max-h-[70vh] object-contain rounded-lg bg-black/5" />;
  }
  if (artifact.mediaType === 'application/pdf') {
    return <iframe src={src} className="w-full rounded-lg border border-slate-200" style={{ height: '70vh' }} title={artifact.title} />;
  }
  if (artifact.mediaType === 'text/html') {
    let html = '';
    try { html = atob(artifact.data); } catch { html = ''; }
    return (
      <iframe
        srcDoc={html}
        sandbox="allow-scripts"
        className="w-full rounded-lg border border-slate-200 bg-white"
        style={{ height: '70vh' }}
        title={artifact.title}
      />
    );
  }
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-500 text-sm rounded-lg border border-slate-200 bg-slate-50">
      <FileText size={28} className="opacity-40" />
      <p>No inline preview. Download to view.</p>
    </div>
  );
}

export function SharedBlockView() {
  const { shareId } = useParams<{ shareId: string }>();
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; payload: SharedBlockPayload }
  >({ kind: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!shareId) {
      setState({ kind: 'error', message: 'Missing share id.' });
      return;
    }
    let cancelled = false;
    fetchShare(shareId)
      .then((payload) => {
        if (cancelled) return;
        if (!payload) setState({ kind: 'error', message: 'This share link is invalid or has been revoked.' });
        else {
          setState({ kind: 'loaded', payload });
          if (payload.artifacts_data.length > 0) setSelectedId(payload.artifacts_data[0].id);
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setState({ kind: 'error', message: e.message });
      });
    return () => { cancelled = true; };
  }, [shareId]);

  const download = (artifact: Artifact) => {
    const a = document.createElement('a');
    a.href = `data:${artifact.mediaType};base64,${artifact.data}`;
    const ext = artifact.mediaType === 'application/pdf' ? 'pdf'
      : artifact.mediaType?.startsWith('image/') ? (artifact.mediaType.split('/')[1] || 'png')
      : artifact.mediaType?.includes('presentation') ? 'pptx'
      : artifact.mediaType?.includes('wordprocessing') ? 'docx'
      : artifact.mediaType === 'text/html' ? 'html'
      : 'bin';
    a.download = `${artifact.title}.${ext}`;
    a.click();
  };

  if (state.kind === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-2 text-slate-600">
          <Loader2 size={18} className="animate-spin" />
          <span className="font-medium">Loading shared block…</span>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-slate-200 p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
            <Lock size={22} className="text-red-500" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900 mb-2">Unavailable</h1>
          <p className="text-sm text-slate-600">{state.message}</p>
        </div>
      </div>
    );
  }

  const { block_data: block, artifacts_data: artifacts } = state.payload;
  const color = block.color || TYPE_COLORS[block.type as string] || '#06b6d4';
  const selected = artifacts.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-10 space-y-6">
        {/* Header */}
        <header className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="h-1.5" style={{ background: color }} />
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="shrink-0 w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: `${color}18`, color }}>
                <Calendar size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1 flex items-center gap-2">
                  <span>Shared timetable block</span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    <Lock size={9} />Read-only
                  </span>
                </div>
                <h1 className="text-2xl font-semibold leading-tight text-slate-900">{block.title}</h1>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                  <span className="inline-flex items-center gap-1.5"><Clock size={14} className="text-slate-400" />{fmt(block.startISO)} – {fmtTime(block.endISO)}</span>
                  {block.location && (
                    <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-slate-400" />{block.location}</span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                    <span className="capitalize">{block.type}{block.subtype ? ` · ${block.subtype}` : ''}</span>
                  </span>
                </div>
              </div>
            </div>

            {block.notes && (
              <div className="mt-5 p-4 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1"><StickyNote size={10} />Notes</div>
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{block.notes}</p>
              </div>
            )}
          </div>
        </header>

        {/* Materials */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Paperclip size={14} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-700">Attached materials</h2>
            <span className="text-xs text-slate-500">· {artifacts.length}</span>
          </div>

          {artifacts.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No materials attached.</div>
          ) : (
            <div className="grid md:grid-cols-[16rem_1fr]">
              {/* List */}
              <div className="border-b md:border-b-0 md:border-r border-slate-200 max-h-[28rem] overflow-auto">
                {artifacts.map((a) => {
                  const Icon = artifactIcon(a.type);
                  const active = selectedId === a.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => setSelectedId(a.id)}
                      className={clsx(
                        'w-full flex items-center gap-2.5 px-4 py-3 text-left border-b border-slate-100 transition-colors',
                        active ? 'bg-sky-50 border-l-4 border-l-sky-500' : 'hover:bg-slate-50',
                      )}
                    >
                      <Icon size={16} className={active ? 'text-sky-600' : 'text-slate-400'} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">{a.title}</div>
                        <div className="text-[11px] text-slate-500 capitalize">{a.type}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Preview */}
              <div className="p-5">
                {!selected ? (
                  <div className="h-64 flex items-center justify-center text-sm text-slate-500">Select a material to preview.</div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-semibold text-slate-900 truncate">{selected.title}</h3>
                        <p className="text-xs text-slate-500 capitalize">{selected.type}</p>
                      </div>
                      <button
                        onClick={() => download(selected)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <Download size={13} />Download
                      </button>
                    </div>
                    <ArtifactPreview artifact={selected} />
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <footer className="flex items-center justify-center gap-2 py-4 text-xs text-slate-500">
          <TeachAssistIcon size={14} className="opacity-70" />
          <span>Shared via</span>
          <a
            href={window.location.origin + window.location.pathname}
            className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900"
          >
            Teach Assist <ExternalLink size={10} />
          </a>
        </footer>
      </div>
    </div>
  );
}
