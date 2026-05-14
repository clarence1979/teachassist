/**
 * OpenAI Whisper transcription.
 * Used for voice input in chat regardless of the active LLM provider,
 * so transcription accuracy doesn't depend on the chosen chat model.
 */

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

export interface WhisperRequest {
  apiKey: string;
  audio: Blob;
  filename?: string;
  language?: string;
  model?: string;
}

export async function transcribeWithWhisper(req: WhisperRequest): Promise<string> {
  const form = new FormData();
  form.append('file', req.audio, req.filename ?? 'recording.webm');
  form.append('model', req.model ?? 'whisper-1');
  if (req.language) form.append('language', req.language);
  form.append('response_format', 'json');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${req.apiKey}` },
    body: form,
  });

  if (!res.ok) {
    let msg = `Whisper transcription failed (HTTP ${res.status})`;
    try {
      const body = await res.json();
      msg = body?.error?.message ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json();
  return (data?.text as string | undefined) ?? '';
}
