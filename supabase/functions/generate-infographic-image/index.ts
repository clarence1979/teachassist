import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

interface PosterPayload {
  title: string;
  authors: string;
  organization: string;
  year: string;
  motivation: string;
  method: string;
  results: string;
  analysis: string;
  takeaways: string;
  theme: string; // "blue-white" | "dark-navy" | "green-teal" | "purple"
}

const THEME_PALETTES: Record<string, { bg: string; header: string; primary: string; accent: string }> = {
  "blue-white":  { bg: "white",      header: "dark navy blue",  primary: "blue",       accent: "bright blue" },
  "dark-navy":   { bg: "dark navy",  header: "near-black navy", primary: "sky blue",   accent: "cyan" },
  "green-teal":  { bg: "light mint", header: "deep forest green", primary: "emerald", accent: "teal" },
  "purple":      { bg: "lavender white", header: "deep purple", primary: "violet",   accent: "bright purple" },
};

function buildStructuredPrompt(p: PosterPayload): string {
  const palette = THEME_PALETTES[p.theme] ?? THEME_PALETTES["blue-white"];

  // Parse bullets from free-form text
  const motBullets = p.motivation.split(/\n|•|;/).map(s => s.replace(/^[-*\s]+/, '').trim()).filter(Boolean).slice(0, 5);
  const methBullets = p.method.split(/\n|•|;/).map(s => s.replace(/^[-*\s]+/, '').trim()).filter(Boolean).slice(0, 5);
  const anaBullets = p.analysis.split(/\n|•|;/).map(s => s.replace(/^[-*\s]+/, '').trim()).filter(Boolean).slice(0, 5);
  const resultRows = p.results.split('\n').map(r => r.split(/[,|]/).map(s => s.trim())).filter(r => r.length >= 2 && r[0]).slice(0, 7);
  const takeaways = p.takeaways.split('|').map(s => s.trim()).filter(Boolean).slice(0, 4);

  const motText = motBullets.map((b, i) => `• ${b}`).join('\n');
  const methText = methBullets.map((b, i) => `${i + 1}. ${b}`).join('\n');
  const anaText = anaBullets.map((b, i) => `• ${b}`).join('\n');
  const resultsTable = [
    'Benchmark | Score | Prior | Δ',
    '----------|-------|-------|---',
    ...resultRows.map(r => `${r[0]} | ${r[1] ?? ''} | ${r[2] ?? ''} | ${r[3] ?? ''}`)
  ].join('\n');
  const takeawayText = takeaways.map((t, i) => `[${i + 1}] ${t}`).join('  ');

  return `Create a professional research paper infographic poster in landscape format (1536×1024).

EXACT TEXT TO RENDER — render every word exactly as written, do not paraphrase or abbreviate:

HEADER BAND (full width, ${palette.header} background):
  Title: "${p.title}"
  Subtitle: "${p.authors}${p.organization ? ' · ' + p.organization : ''} · ${p.year}"

6-PANEL GRID (2 rows × 3 columns, panels have ${palette.bg} background with colored headers):

PANEL 1 — top-left — header: "MOTIVATION & KEY IDEA" (${palette.primary} header, white text):
${motText}

PANEL 2 — top-center — header: "METHOD" (blue header, white text):
${methText}

PANEL 3 — top-right — header: "TASK OVERVIEW" (teal header, white text):
  Draw a simple pipeline: [Input] → [Process] → [Transform] → [Output]
  Then list 4 short colored labels: Classification, Entailment, Similarity, Multi-Choice

PANEL 4 — bottom-left — header: "ANALYSIS" (${palette.accent} header, white text):
${anaText}

PANEL 5 — bottom-center — header: "MAIN RESULTS" (orange header, white text):
Render this as a data table with clear column headers and alternating row shading:
${resultsTable}
  (positive Δ values in green, negative in red)

PANEL 6 — bottom-right — header: "PERFORMANCE CHART" (teal header, white text):
  Draw a simple line chart with 2 curves showing increasing performance over depth/iterations.
  Label axes: Y="Performance", X="Depth"

FOOTER BAR (full width, ${palette.header} background):
  4 numbered boxes side by side: ${takeawayText}

DESIGN RULES:
- Background: ${palette.bg}
- All panel header text: white, bold, uppercase, 13-14pt
- Body text: dark, clean sans-serif, 13-15pt, fully legible at this resolution
- Benchmark table: monospaced numbers, clear grid lines, alternating row tints
- Use thin borders and subtle drop shadows on panels
- No decorative textures — clean, minimal, professional academic poster style
- Every single word in the EXACT TEXT sections must appear verbatim in the final image`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as PosterPayload & { imagePrompt?: string };

    // Support legacy imagePrompt pass-through OR new structured payload
    const prompt = body.imagePrompt ?? buildStructuredPrompt(body as PosterPayload);

    const apiRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-2-2026-04-21",
        prompt,
        size: "1536x1024",
        quality: "high",
        response_format: "b64_json",
        n: 1,
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({}));
      const msg = (err as { error?: { message?: string } })?.error?.message ?? `OpenAI error ${apiRes.status}`;
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await apiRes.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = data.data?.[0];

    if (!item) {
      return new Response(JSON.stringify({ error: "No image returned from OpenAI." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (item.b64_json) {
      return new Response(JSON.stringify({ b64: item.b64_json, mediaType: "image/png" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (item.url) {
      const imgRes = await fetch(item.url);
      if (!imgRes.ok) {
        return new Response(JSON.stringify({ error: "Failed to fetch generated image." }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
      let b64 = "";
      const chunkSize = 8192;
      for (let i = 0; i < imgBytes.length; i += chunkSize) {
        b64 += btoa(String.fromCharCode(...imgBytes.slice(i, i + chunkSize)));
      }
      return new Response(JSON.stringify({ b64, mediaType: "image/png" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "No image data in response." }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
