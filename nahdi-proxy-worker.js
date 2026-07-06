/**
 * Cloudflare Worker — CORS proxy for the Nahdi price API.
 *
 * WHY THIS EXISTS
 *   The Nahdi endpoint returns a fixed `Access-Control-Allow-Origin:
 *   https://www.nahdionline.com`, so a browser page on any other origin
 *   (GitHub Pages, localhost) is blocked from reading the response.
 *   This Worker runs server-side (no CORS there), calls Nahdi, and re-serves
 *   the JSON with `Access-Control-Allow-Origin: *` so the app can read it.
 *   It also sends a browser User-Agent, which is required to get past Nahdi's
 *   CloudFront WAF (a bare request gets a 403).
 *
 * DEPLOY (once)
 *   1. https://dash.cloudflare.com  ->  Workers & Pages  ->  Create Worker
 *   2. Paste this file, Deploy. You get a URL like
 *        https://nahdi-proxy.<you>.workers.dev
 *   3. Test in a browser:
 *        https://nahdi-proxy.<you>.workers.dev/?skus=<REAL_SKU>
 *      A JSON array should appear -> paste it back so we finalize field names.
 *
 * USAGE FROM THE APP
 *   fetch('https://nahdi-proxy.<you>.workers.dev/?skus=123456789')
 *   (comma-separate to try batching: ?skus=111,222,333)
 */

const NAHDI = 'https://www.nahdionline.com/api/analytics/product';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const inUrl = new URL(request.url);
    const skus = inUrl.searchParams.get('skus') || inUrl.searchParams.get('sku');
    if (!skus) {
      return json({ error: 'missing ?skus=' }, 400);
    }

    const out = new URL(NAHDI);
    out.searchParams.set('skus', skus);
    out.searchParams.set('language', inUrl.searchParams.get('language') || 'en');
    out.searchParams.set('region', inUrl.searchParams.get('region') || 'SA');
    out.searchParams.set('category_id',
      inUrl.searchParams.get('category_id') || '15125');

    try {
      const res = await fetch(out.toString(), {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
      });
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: {
          ...CORS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    } catch (err) {
      return json({ error: 'upstream fetch failed', detail: String(err) }, 502);
    }
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
