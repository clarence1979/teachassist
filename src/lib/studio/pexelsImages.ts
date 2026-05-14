import type { SlideSpec } from './slideSchema';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'you', 'he', 'she', 'we', 'they', 'them', 'their', 'our', 'your', 'my',
  'me', 'us', 'him', 'her', 'from', 'up', 'down', 'out', 'over', 'under',
  'so', 'if', 'then', 'than', 'when', 'where', 'why', 'how', 'what', 'which',
  'who', 'whom', 'whose', 'not', 'no', 'yes', 'all', 'any', 'some', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'such', 'only', 'own',
  'same', 'too', 'very', 's', 't', 'just', 'one', 'two', 'three', 'also',
  'like', 'about', 'into', 'through', 'between', 'among', 'here', 'there',
  'introduction', 'conclusion', 'summary', 'slide', 'lesson', 'today', 'class',
  'students', 'learn', 'learning', 'use', 'using', 'used', 'make', 'makes',
  'many', 'much', 'because', 'while', 'after', 'before', 'during', 'without',
  'example', 'examples', 'question', 'questions', 'answer', 'answers',
]);

function extractKeywords(slide: SlideSpec, deckTopic?: string): string {
  const titleTokens = tokenize(slide.title);
  const bulletTokens = slide.bullets.flatMap(tokenize);

  const freq = new Map<string, number>();
  for (const t of titleTokens) freq.set(t, (freq.get(t) ?? 0) + 3);
  for (const t of bulletTokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  const ranked = [...freq.entries()]
    .filter(([w]) => !STOPWORDS.has(w) && w.length > 2 && !/^\d+$/.test(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);

  const parts: string[] = [];
  if (ranked.length) parts.push(ranked.join(' '));
  if (deckTopic) parts.push(deckTopic);
  const query = parts.join(' ').trim();
  return query || slide.title || deckTopic || 'education';
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

interface PexelsResult {
  imageBase64?: string;
  mime?: string;
  photographer?: string;
  sourceUrl?: string;
  alt?: string;
}

async function fetchPexelsImage(query: string): Promise<PexelsResult | null> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pexels-search`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        orientation: 'landscape',
        per_page: 3,
        return_image: true,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.imageBase64) return null;
    return data as PexelsResult;
  } catch {
    return null;
  }
}

export interface SlidePexelsOptions {
  deckTopic?: string;
  onProgress?: (completed: number, total: number) => void;
  concurrency?: number;
}

/**
 * Populate `imageBase64` on each content slide using Pexels. Mutates `slides` in place.
 * Slides that already have `imageBase64` (e.g. from OpenAI) are skipped.
 * Title slides (layout === 'title') are skipped.
 */
export async function populatePexelsImages(
  slides: SlideSpec[],
  opts: SlidePexelsOptions = {},
): Promise<void> {
  const targets = slides
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.imageBase64 && s.layout !== 'title');

  const concurrency = Math.max(1, opts.concurrency ?? 3);
  let completed = 0;
  const total = targets.length;
  opts.onProgress?.(0, total);

  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let k = 0; k < concurrency; k++) {
    workers.push((async () => {
      while (cursor < targets.length) {
        const idx = cursor++;
        const { s } = targets[idx];
        const query = extractKeywords(s, opts.deckTopic);
        const result = await fetchPexelsImage(query);
        if (result?.imageBase64) {
          s.imageBase64 = result.imageBase64;
        }
        completed++;
        opts.onProgress?.(completed, total);
      }
    })());
  }
  await Promise.all(workers);
}
