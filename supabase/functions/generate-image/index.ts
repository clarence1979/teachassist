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
      return new Response(JSON.stringify({ error: "Image generation is not configured (missing REPLICATE_API_KEY)." }), {
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

    const createRes = await fetch(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions",
      {
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
            guidance: 3.5,
            megapixels: "1",
            num_outputs: 1,
            aspect_ratio,
            output_format: "webp",
            output_quality: 80,
            prompt_strength: 0.8,
            num_inference_steps: 28,
          },
        }),
      }
    );

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
      error?: string;
    };

    if (prediction.error) {
      return new Response(JSON.stringify({ error: prediction.error }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let output: string[] | undefined = prediction.output;

    // Poll as fallback if Prefer: wait didn't resolve
    if (!output && prediction.urls?.get) {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(prediction.urls!.get, {
          headers: { Authorization: `Bearer ${REPLICATE_API_KEY}` },
        });
        if (!pollRes.ok) break;
        const body = await pollRes.json() as { status: string; output?: string[]; error?: string };
        if (body.status === "succeeded") { output = body.output; break; }
        if (body.status === "failed" || body.status === "canceled") {
          return new Response(JSON.stringify({ error: body.error ?? "Generation failed" }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const imageUrl = output?.[0];
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "No image returned from Replicate." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the image and convert to base64
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch generated image." }), {
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
