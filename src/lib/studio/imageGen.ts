const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/generate-image`;

export interface ImageGenRequest {
  prompt: string;
  aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
}

export interface ImageGenResult {
  b64: string;
  mediaType: 'image/jpeg';
}

/** Returns base64-encoded JPEG data. */
export async function generateImage(req: ImageGenRequest): Promise<ImageGenResult> {
  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      prompt: req.prompt,
      aspect_ratio: req.aspect_ratio ?? '16:9',
    }),
  });

  if (!res.ok) {
    let msg = `Image generation failed (HTTP ${res.status})`;
    try {
      const errBody = await res.json();
      msg = (errBody as { error?: string })?.error ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json() as { b64?: string; mediaType?: string; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.b64) throw new Error('No image returned.');
  return { b64: data.b64, mediaType: 'image/jpeg' };
}
