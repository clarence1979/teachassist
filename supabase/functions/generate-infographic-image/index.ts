import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

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

    const { imagePrompt } = await req.json() as { imagePrompt?: string };
    if (!imagePrompt) {
      return new Response(JSON.stringify({ error: "imagePrompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: imagePrompt,
        size: "1536x1024",
        quality: "high",
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
      const b64 = btoa(String.fromCharCode(...imgBytes));
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
