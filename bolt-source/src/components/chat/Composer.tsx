import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Send,
  Paperclip,
  Image as ImageIcon,
  X,
  FileText,
  Loader2,
  Square,
  Brain,
  Mic,
  MicOff,
  Wand2,
} from 'lucide-react';
import { parseFile, type ParsedFile } from '../../lib/fileParsers';
import { useAppStore } from '../../store/appStore';
import { useCredentials } from '../../contexts/CredentialsContext';
import { transcribeWithWhisper } from '../../lib/voice/whisper';
import { enhancePrompt } from '../../lib/chat/enhancePrompt';

export interface PendingAttachment extends ParsedFile {
  id: string;
}

interface Props {
  onSend: (text: string, attachments: PendingAttachment[]) => void;
  onStop?: () => void;
  busy?: boolean;
  initialValue?: string;
  /** Compact mode for iframe on mobile — reduces padding and hides non-essential UI */
  compact?: boolean;
}

export function Composer({ onSend, onStop, busy, initialValue, compact = false }: Props) {
  const memoryEnabled = useAppStore((s) => s.memoryEnabled);
  const setMemoryEnabled = useAppStore((s) => s.setMemoryEnabled);
  const { getKey } = useCredentials();
  const { activeProvider, activeModel } = useAppStore();
  const [text, setText] = useState(initialValue ?? '');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Whisper voice state — uses OpenAI Whisper regardless of active provider
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const hasVoice = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  React.useEffect(() => {
    if (initialValue !== undefined) setText(initialValue);
  }, [initialValue]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setParsing(true);
    setError('');
    try {
      const parsed: PendingAttachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) {
          setError(`${file.name} exceeds 20 MB`);
          continue;
        }
        const p = await parseFile(file);
        parsed.push({ ...p, id: crypto.randomUUID() });
      }
      setAttachments((prev) => [...prev, ...parsed]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setParsing(false);
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (busy) return;
    if (isRecording) {
      mediaRecorderRef.current?.stop();
    }
    onSend(trimmed, attachments);
    setText('');
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const pastedFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length) {
      e.preventDefault();
      const dt = new DataTransfer();
      pastedFiles.forEach((f) => dt.items.add(f));
      handleFiles(dt.files);
    }
  };

  const dragCounter = useRef(0);
  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const toggleVoice = async () => {
    setVoiceError('');
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    const openaiKey = getKey('openai');
    if (!openaiKey) {
      setVoiceError('Add an OpenAI API key in Settings to enable Whisper voice input.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const supported = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const recorder = new MediaRecorder(stream, supported ? { mimeType: supported } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => { if (ev.data.size > 0) audioChunksRef.current.push(ev.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        if (audioChunksRef.current.length === 0) return;
        setTranscribing(true);
        try {
          const type = recorder.mimeType || 'audio/webm';
          const blob = new Blob(audioChunksRef.current, { type });
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          const transcript = await transcribeWithWhisper({
            apiKey: openaiKey,
            audio: blob,
            filename: `recording.${ext}`,
          });
          if (transcript.trim()) {
            setText((prev) => {
              const sep = prev && !prev.endsWith(' ') ? ' ' : '';
              return prev + sep + transcript.trim();
            });
            requestAnimationFrame(() => {
              if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, compact ? 128 : 208) + 'px';
                textareaRef.current.focus();
              }
            });
          }
        } catch (err) {
          setVoiceError(err instanceof Error ? err.message : 'Whisper transcription failed');
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Microphone access denied');
    }
  };

  const handleEnhancePrompt = async () => {
    const current = text.trim();
    if (!current || enhancing || busy) return;
    const openaiKey = getKey('openai') ?? undefined;
    const anthropicKey = getKey('anthropic') ?? undefined;
    if (!openaiKey && !anthropicKey) {
      setError('Add an OpenAI or Anthropic key to enhance prompts.');
      return;
    }
    setEnhancing(true);
    setError('');
    try {
      const enhanced = await enhancePrompt({
        prompt: current,
        provider: activeProvider,
        model: activeModel,
        anthropicKey,
        openaiKey,
      });
      if (enhanced && enhanced !== current) {
        setText(enhanced);
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, compact ? 128 : 208) + 'px';
          }
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prompt enhancement failed');
    } finally {
      setEnhancing(false);
    }
  };

  const px = compact ? 'px-2 py-2' : 'px-4 py-3';
  const btnPad = compact ? 'p-1.5' : 'p-2';
  const iconSize = compact ? 13 : 14;

  return (
    <div
      className={clsx('border-t border-border bg-bg-panel relative transition-colors', px, isDragOver && 'bg-accent-cyan/5 ring-2 ring-inset ring-accent-cyan/60')}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10 bg-bg-base/70">
          <div className="px-4 py-2 rounded-btn border border-accent-cyan bg-bg-panel font-rajdhani font-bold text-sm text-accent-cyan uppercase tracking-wider flex items-center gap-2">
            <Paperclip size={14} /> Drop to attach
          </div>
        </div>
      )}
      {/* Attachments preview */}
      {(attachments.length > 0 || parsing || error || voiceError) && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-1.5 px-2 py-0.5 bg-bg-elevated border border-border rounded-btn text-xs"
            >
              {a.kind === 'image' ? (
                <ImageIcon size={11} className="text-accent-cyan" />
              ) : (
                <FileText size={11} className="text-accent-cyan" />
              )}
              <span className="font-mono text-text-secondary truncate max-w-32">{a.name}</span>
              {!compact && <span className="font-mono text-text-dim">{Math.ceil(a.size / 1024)}KB</span>}
              <button
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.name}`}
                className="text-text-dim hover:text-accent-red transition-colors"
              >
                <X size={11} />
              </button>
            </div>
          ))}
          {parsing && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-text-dim">
              <Loader2 size={11} className="animate-spin" /> Parsing…
            </span>
          )}
          {error && (
            <span className="px-2 py-0.5 text-xs text-accent-red font-mono">{error}</span>
          )}
          {voiceError && (
            <span className="px-2 py-0.5 text-xs text-accent-red font-mono">{voiceError}</span>
          )}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-1.5">
        {/* File attachment buttons */}
        <div className="flex gap-1 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            className={clsx('rounded-btn border border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan transition-colors', btnPad)}
          >
            <Paperclip size={iconSize} />
          </button>
          <button
            onClick={() => imageInputRef.current?.click()}
            aria-label="Attach image"
            className={clsx('rounded-btn border border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan transition-colors', btnPad)}
          >
            <ImageIcon size={iconSize} />
          </button>
        </div>

        {/* Textarea with interim voice text overlay */}
        <div className="relative flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              isRecording
                ? 'Recording… click mic to stop'
                : transcribing
                ? 'Transcribing with Whisper…'
                : compact
                ? 'Ask anything…'
                : 'Ask Teach Assist anything… (paste, drop files, or Shift+Enter for newline)'
            }
            rows={1}
            className={clsx(
              'w-full bg-bg-elevated border border-border rounded-btn px-3 font-inter text-text-primary placeholder:text-text-dim focus:outline-none caret-accent-cyan resize-none transition-colors',
              compact ? 'py-1.5 text-sm max-h-32' : 'py-2 text-sm max-h-52',
              isRecording && 'border-accent-red/60 focus:border-accent-red',
            )}
            style={{ minHeight: compact ? '34px' : '38px' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, compact ? 128 : 208) + 'px';
            }}
          />
          {(isRecording || transcribing) && (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
              {transcribing ? (
                <Loader2 size={12} className="animate-spin text-accent-cyan" />
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-pulse [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-pulse [animation-delay:300ms]" />
                </>
              )}
            </div>
          )}
        </div>

        {/* Prompt Enhance button — researches & expands the prompt */}
        <button
          onClick={handleEnhancePrompt}
          disabled={enhancing || busy || !text.trim()}
          aria-label="Enhance prompt"
          title="Enhance prompt — researches and expands your request for better artifacts"
          className={clsx(
            'rounded-btn border transition-all shrink-0',
            btnPad,
            enhancing
              ? 'border-accent-amber text-accent-amber bg-accent-amber/10 animate-pulse'
              : text.trim()
                ? 'border-border text-text-dim hover:border-accent-amber hover:text-accent-amber'
                : 'border-border text-text-dim opacity-40 cursor-not-allowed',
          )}
        >
          {enhancing ? <Loader2 size={iconSize} className="animate-spin" /> : <Wand2 size={iconSize} />}
        </button>

        {/* Voice button — OpenAI Whisper transcription */}
        {hasVoice && (
          <button
            onClick={toggleVoice}
            disabled={transcribing}
            aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
            title={isRecording ? 'Stop & transcribe' : 'Voice input (Whisper)'}
            className={clsx(
              'rounded-btn border transition-all shrink-0',
              btnPad,
              isRecording
                ? 'border-accent-red text-accent-red bg-accent-red/10 animate-pulse'
                : transcribing
                  ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/10'
                  : 'border-border text-text-dim hover:border-accent-cyan hover:text-accent-cyan',
            )}
          >
            {isRecording ? <MicOff size={iconSize} /> : <Mic size={iconSize} />}
          </button>
        )}

        {/* Send / Stop */}
        {busy ? (
          <button
            onClick={onStop}
            aria-label="Stop generation"
            className={clsx('rounded-btn border border-accent-red text-accent-red hover:bg-accent-red/10 transition-colors shrink-0', btnPad)}
          >
            <Square size={iconSize} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            aria-label="Send message"
            disabled={!text.trim() && attachments.length === 0}
            className={clsx(
              'rounded-btn border transition-colors shrink-0',
              btnPad,
              text.trim() || attachments.length > 0
                ? 'border-accent-cyan text-accent-cyan hover:bg-accent-cyan/10'
                : 'border-border text-text-dim opacity-50 cursor-not-allowed',
            )}
          >
            <Send size={iconSize} />
          </button>
        )}
      </div>

      {/* Memory toggle row — hidden in compact mode to save vertical space */}
      {!compact && (
        <div className="flex items-center justify-between mt-2">
          <label className="flex items-center gap-2 cursor-pointer group select-none">
            <input
              type="checkbox"
              checked={memoryEnabled}
              onChange={(e) => setMemoryEnabled(e.target.checked)}
              className="accent-accent-cyan"
            />
            <Brain size={12} className={clsx('transition-colors', memoryEnabled ? 'text-accent-cyan' : 'text-text-dim')} />
            <span className="text-[11px] font-mono tracking-wider text-text-secondary group-hover:text-text-primary transition-colors">
              Enable memory from previous chats
            </span>
          </label>
          <span className="text-[10px] font-mono text-text-dim">
            {memoryEnabled ? 'ON — AI sees summaries of past conversations' : 'OFF — each chat is isolated'}
          </span>
        </div>
      )}
    </div>
  );
}
