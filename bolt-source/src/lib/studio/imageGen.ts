const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/generate-image`;

export interface ImageGenRequest {
  prompt: string;
  aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
}

export interface ImageGenResult {
  b64: string;
  mediaType: 'image/webp' | 'image/png' | 'image/jpeg';
}

/** Returns base64-encoded image data from Replicate flux-dev. */
export async function generateImage(req: ImageGenRequest): Promise<ImageGenResult> {
  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      prompt: req.prompt,
      aspect_ratio: req.aspect_ratio ?? '1:1',
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
  return { b64: data.b64, mediaType: (data.mediaType as 'image/webp') || 'image/webp' };
}

/** Generates an image and returns it as PNG base64 (PDF/PPTX embedding only accepts PNG/JPEG). */
export async function generateImagePng(req: ImageGenRequest): Promise<string> {
  const { b64, mediaType } = await generateImage(req);
  if (mediaType === 'image/png') return b64;
  const img = new Image();
  img.src = `data:${mediaType};base64,${b64}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Canvas not available to convert image.');
  c.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}
