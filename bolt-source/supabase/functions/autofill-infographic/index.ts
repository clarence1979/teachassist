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

    const { title } = await req.json() as { title?: string };
    if (!title?.trim()) {
      return new Response(JSON.stringify({ error: "title is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a research assistant that summarizes academic papers and research topics for infographic posters.
Given a paper or topic title, produce concise, factual content for each section of an infographic.
If the title matches a known paper, use accurate information about it.
If it's a general topic, synthesize well-known knowledge about it.
Respond ONLY with a valid JSON object — no markdown, no explanation, no code fences.`;

    const userPrompt = `Title: "${title}"

Return a JSON object with exactly these keys:
{
  "motivation": "2-4 bullet points explaining the problem this addresses and the core idea (plain text, use • for bullets)",
  "method": "2-4 bullet points describing the approach, architecture, or methodology",
  "results": "3-5 benchmark/result rows as: BenchmarkName, OurScore, PriorBest, +Delta | separated by newlines. Example: GLUE, 89.4, 87.1, +2.3",
  "analysis": "2-4 bullet points of key findings from ablations or analysis experiments",
  "takeaways": "Exactly 4 short takeaways separated by | — each max 8 words. Example: Pre-training boosts few-shot performance | Scale improves generalization | ..."
}`;

    const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 800,
        response_format: { type: "json_object" },
      }),
    });

    if (!chatRes.ok) {
      const err = await chatRes.json().catch(() => ({}));
      const msg = (err as { error?: { message?: string } })?.error?.message ?? `OpenAI error ${chatRes.status}`;
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chatData = await chatRes.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = chatData.choices?.[0]?.message?.content ?? "";

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: "AI returned invalid JSON: " + raw.slice(0, 200) }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(parsed), {
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
