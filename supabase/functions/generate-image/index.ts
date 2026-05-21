import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const REPLICATE_API_KEY = Deno.env.get("REPLICATE_API_KEY") ?? "";

async function pollUntilDone(pollUrl: string, deadline: number): Promise<string[] | null> {
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${REPLICATE_API_KEY}` },
    });
    if (!res.ok) return null;
    const body = await res.json() as { status: string; output?: string[]; error?: string };
    if (body.status === "succeeded") return body.output ?? null;
    if (body.status === "failed" || body.status === "canceled") return null;
  }
  return null;
}

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

    const { prompt, aspect_ratio = "16:9" } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use "jpeg" — valid Replicate output_format value (not "jpg")
    const createRes = await fetch(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
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
            megapixels: "1",
            num_outputs: 1,
            aspect_ratio,
            output_format: "jpg",
            output_quality: 90,
            num_inference_steps: 4,
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

    // If not done yet, poll
    if (!output && prediction.urls?.get) {
      const polled = await pollUntilDone(prediction.urls.get, Date.now() + 90_000);
      if (polled) output = polled;
    }

    const imageOutput = output?.[0];
    if (!imageOutput) {
      return new Response(JSON.stringify({ error: "No image returned from Replicate." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let b64: string;

    // Replicate flux-schnell sometimes returns base64 data URIs directly
    if (imageOutput.startsWith("data:")) {
      const commaIdx = imageOutput.indexOf(",");
      b64 = commaIdx !== -1 ? imageOutput.slice(commaIdx + 1) : imageOutput;
    } else {
      // It's a URL — fetch and encode with Deno's standard library (no stack overflow)
      const imgRes = await fetch(imageOutput);
      if (!imgRes.ok) {
        return new Response(JSON.stringify({ error: "Failed to fetch generated image." }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
      b64 = encodeBase64(imgBytes);
    }

    return new Response(JSON.stringify({ b64, mediaType: "image/jpeg" }), {
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
