import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

interface PosterRequest {
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
  heroImageB64?: string;
  heroMediaType?: string;
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

    const body = await req.json() as PosterRequest;
    const { prompt, size = "1024x1536", heroImageB64, heroMediaType } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let apiRes: Response;

    if (heroImageB64) {
      // Use images/edits endpoint which accepts a reference image
      const binaryStr = atob(heroImageB64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const ext = (heroMediaType ?? "image/jpeg").includes("png") ? "png" : "jpg";
      const mimeType = ext === "png" ? "image/png" : "image/jpeg";
      const blob = new Blob([bytes], { type: mimeType });

      const formData = new FormData();
      formData.append("image", blob, `hero.${ext}`);
      formData.append("prompt", prompt);
      formData.append("model", "gpt-image-2");
      formData.append("size", size);
      formData.append("quality", "high");
      formData.append("n", "1");

      apiRes = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: formData,
      });
    } else {
      apiRes = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt,
          size,
          quality: "high",
          n: 1,
        }),
      });
    }

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
