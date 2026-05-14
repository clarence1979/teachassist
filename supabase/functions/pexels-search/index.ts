const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PEXELS_KEY = Deno.env.get("PEXELS_API_KEY") ?? "XHyIpHGG88PResHuh8lWpD0q4bMBzS1MShsrYy27Tl6SrJiieDBzZZdL";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    small: string;
    portrait: string;
    landscape: string;
    tiny: string;
  };
  alt: string;
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
  total_results: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (!PEXELS_KEY) {
      return new Response(
        JSON.stringify({ error: "PEXELS_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let query = "";
    let orientation = "landscape";
    let perPage = 5;
    let returnImage = false;

    if (req.method === "GET") {
      const u = new URL(req.url);
      query = u.searchParams.get("query") ?? "";
      orientation = u.searchParams.get("orientation") ?? "landscape";
      perPage = Number(u.searchParams.get("per_page") ?? "5");
      returnImage = u.searchParams.get("return_image") === "1";
    } else {
      const body = await req.json().catch(() => ({}));
      query = String(body.query ?? "");
      orientation = String(body.orientation ?? "landscape");
      perPage = Number(body.per_page ?? 5);
      returnImage = !!body.return_image;
    }

    if (!query.trim()) {
      return new Response(
        JSON.stringify({ error: "Missing query" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const searchUrl = new URL("https://api.pexels.com/v1/search");
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("orientation", orientation);
    searchUrl.searchParams.set("per_page", String(Math.min(Math.max(perPage, 1), 15)));

    const searchRes = await fetch(searchUrl.toString(), {
      headers: { Authorization: PEXELS_KEY },
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      return new Response(
        JSON.stringify({ error: `Pexels ${searchRes.status}`, details: errText }),
        { status: searchRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = (await searchRes.json()) as PexelsSearchResponse;
    const first = json.photos?.[0];

    if (!first) {
      return new Response(
        JSON.stringify({ imageUrl: null, total: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const imageUrl = first.src.large;

    if (returnImage) {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        return new Response(
          JSON.stringify({ error: `Image fetch ${imgRes.status}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const buf = new Uint8Array(await imgRes.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
      }
      const base64 = btoa(binary);
      const mime = imgRes.headers.get("content-type") ?? "image/jpeg";

      return new Response(
        JSON.stringify({
          imageBase64: base64,
          mime,
          photographer: first.photographer,
          sourceUrl: first.url,
          alt: first.alt,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        imageUrl,
        photographer: first.photographer,
        sourceUrl: first.url,
        alt: first.alt,
        total: json.total_results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e instanceof Error ? e.message : e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
