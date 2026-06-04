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
      return new Response(JSON.stringify({ error: "Image generation is not configured (missing OPENAI_API_KEY)." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { prompt, aspect_ratio = "16:9" } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Map aspect ratios to OpenAI's supported sizes for gpt-image-1
    const sizeMap: Record<string, string> = {
      "1:1": "1024x1024",
      "16:9": "1536x1024",
      "9:16": "1024x1536",
      "4:3": "1536x1024",
      "3:4": "1024x1536",
    };
    const size = sizeMap[aspect_ratio] ?? "1536x1024";

    const createRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size,
        quality: "high",
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg = (err?.error as Record<string, unknown>)?.message ?? `OpenAI error ${createRes.status}`;
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await createRes.json() as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    const imageData = result.data?.[0];
    if (!imageData) {
      return new Response(JSON.stringify({ error: "No image returned from OpenAI." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let b64: string;

    if (imageData.b64_json) {
      b64 = imageData.b64_json;
    } else if (imageData.url) {
      const imgRes = await fetch(imageData.url);
      if (!imgRes.ok) {
        return new Response(JSON.stringify({ error: "Failed to fetch generated image from URL." }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < imgBytes.length; i += CHUNK) {
        const slice = imgBytes.subarray(i, i + CHUNK);
        binary += String.fromCharCode(...slice);
      }
      b64 = btoa(binary);
    } else {
      return new Response(JSON.stringify({ error: "Unexpected response format from OpenAI." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ b64, mediaType: "image/png" }), {
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
