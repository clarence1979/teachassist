/**
 * Anthropic Files API CORS relay — Cloudflare Worker (free tier is plenty).
 *
 * Why: api.anthropic.com allows browser calls to /v1/messages, but rejects browser
 * origins for /v1/files/* ("Disallowed CORS origin"). Teach Assist needs /v1/files to
 *   • download the DOCX / PPTX / XLSX / PDF files Claude creates with its Skills, and
 *   • upload your attachments (Word, Excel, CSV…) into Claude's code sandbox.
 *
 * This Worker forwards ONLY /v1/files/* requests to api.anthropic.com. It passes
 * through the x-api-key header that the browser already sends, stores nothing, logs
 * nothing, and holds no key of its own. Everything else (chat, streaming, search,
 * code execution) still goes straight from your browser to Anthropic.
 *
 * Deploy (about two minutes):
 *   1. https://dash.cloudflare.com → Workers & Pages → Create → "Hello World" Worker.
 *   2. Replace the code with this file. Deploy.
 *   3. (Optional, recommended) Settings → Variables → add ALLOWED_ORIGIN, e.g.
 *      "https://yourname.github.io" or "null" if you open the HTML from disk (file://).
 *   4. Copy the worker URL (https://xxx.workers.dev) into Teach Assist → Settings →
 *      "Claude files relay URL".
 */

const ALLOW_PATH = /^\/v1\/files(\/|$)/;
const PASS_HEADERS = ['x-api-key', 'authorization', 'anthropic-version', 'anthropic-beta', 'content-type'];

function corsHeaders(origin, env) {
  const allowed = env && env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN : '*';
  return {
    'Access-Control-Allow-Origin': allowed === '*' ? '*' : (origin === allowed ? origin : 'null'),
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'x-api-key, authorization, anthropic-version, anthropic-beta, anthropic-dangerous-direct-browser-access, content-type',
    'Access-Control-Expose-Headers': 'content-type, content-length, content-disposition, request-id',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (env && env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*' && origin !== env.ALLOWED_ORIGIN) {
      return new Response('Origin not allowed', { status: 403, headers: cors });
    }
    if (!ALLOW_PATH.test(url.pathname)) return new Response('Not found', { status: 404, headers: cors });
    if (!request.headers.get('x-api-key') && !request.headers.get('authorization')) {
      return new Response('Missing x-api-key', { status: 401, headers: cors });
    }

    const headers = new Headers();
    for (const h of PASS_HEADERS) { const v = request.headers.get(h); if (v) headers.set(h, v); }
    if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');

    const upstream = await fetch('https://api.anthropic.com' + url.pathname + url.search, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });

    const out = new Headers();
    for (const h of ['content-type', 'content-length', 'content-disposition', 'request-id']) {
      const v = upstream.headers.get(h); if (v) out.set(h, v);
    }
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
