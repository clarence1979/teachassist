import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const REPLICATE_API_KEY = Deno.env.get("REPLICATE_API_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (!REPLICATE_API_KEY) {
      return new Response(JSON.stringify({ error: "Image generation is not configured." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { prompt, aspect_ratio = "1:1" } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create prediction with Prefer: wait so we get the result immediately
    const createRes = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_KEY}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt,
          go_fast: true,
          megapixels: "1",
          num_outputs: 1,
          aspect_ratio,
          output_format: "webp",
          output_quality: 80,
          num_inference_steps: 4,
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      const msg = (err as { detail?: string })?.detail ?? `Replicate error ${createRes.status}`;
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prediction = await createRes.json() as {
      id: string;
      status: string;
      output?: string[];
      urls?: { get: string };
    };

    // Poll if not immediately done
    let output: string[] | undefined = prediction.output;
    if (!output && prediction.status !== "succeeded" && prediction.urls?.get) {
      const pollUrl = prediction.urls.get;
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const pollRes = await fetch(pollUrl, {
          headers: { Authorization: `Bearer ${REPLICATE_API_KEY}` },
        });
        if (!pollRes.ok) break;
        const polled = await pollRes.json() as { status: string; output?: string[] };
        if (polled.status === "succeeded") { output = polled.output; break; }
        if (polled.status === "failed" || polled.status === "canceled") break;
      }
    }

    const imageUrl = output?.[0];
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "No image returned from Replicate." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the image and convert to base64 safely (chunked to avoid stack overflow)
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch generated image." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    // Chunk the conversion to avoid maximum call stack errors on large images
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < imgBytes.length; i += chunkSize) {
      binary += String.fromCharCode(...imgBytes.subarray(i, i + chunkSize));
    }
    const b64 = btoa(binary);

    return new Response(JSON.stringify({ b64, mediaType: "image/webp" }), {
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
