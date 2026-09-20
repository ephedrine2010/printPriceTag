/**
 * On-demand price fallback via the Nahdi product API.
 *
 * Used when an item IS found in the master but its price cell is empty. We look
 * the item up by SKU through the Nahdi API and read the retail price from the
 * response.
 *
 * The API replies with a fixed `Access-Control-Allow-Origin:
 * https://www.nahdionline.com`, so a browser page cannot call it directly. All
 * requests therefore go through NAHDI_PROXY_BASE — a self-hosted Cloudflare
 * Worker (see nahdi-proxy-worker.js) that re-serves the JSON with
 * `Access-Control-Allow-Origin: *` and adds the browser User-Agent that Nahdi's
 * CloudFront WAF requires.
 *
 * Public CORS proxies are deliberately NOT used as a fallback: corsproxy.io now
 * rejects keyless URLs (403), allorigins `/raw` returns 522, and allorigins
 * `/get` answered roughly 1 request in 5 when measured. A backstop that
 * unreliable only turns a clean failure into a slow one.
 */
export const NAHDI_PROXY_BASE = 'https://nahdi-proxy.ephedrine2010.workers.dev';

var FETCH_TIMEOUT_MS = 10000;

// sku -> resolved Nahdi item object, or null (looked up, nothing usable).
// Shared by price and brand lookups so a SKU is fetched at most once.
var itemCache = Object.create(null);

// sku -> in-flight promise, so concurrent callers share one request.
var pending = Object.create(null);

/**
 * Choose the tag price from a Nahdi product object.
 *
 * Ported from the legacy Dart startScrap(): there, the VAT-adjust branches only
 * fired when the website price equalled the *local* master price. In our case
 * the master price is empty (that's why we're here), so those branches never
 * apply and the logic reduces to choosing between `price` and `shelf_price` —
 * legacy takes the higher. Nahdi prices are already VAT-inclusive retail, so no
 * VAT is added.
 *
 * @param {object} obj — one element of the Nahdi response array
 * @returns {number|null}
 */
export function pickNahdiPrice(obj) {
    if (!obj) return null;
    var price = toNum(obj.price);
    var shelf = toNum(obj.shelf_price);
    if (price == null && shelf == null) return null;
    if (price == null) return shelf;
    if (shelf == null) return price;
    if (price === shelf) return price;
    return price > shelf ? price : shelf;
}

function toNum(v) {
    if (v == null || v === '') return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
}

/**
 * Build the Worker URL for one SKU.
 *
 * The param is `sku` (singular) — that is what the deployed Worker expects;
 * `?skus=` gets a `400 bad sku`.
 * @param {string} sku
 * @returns {string}
 */
function proxyUrlForSku(sku) {
    return (
        NAHDI_PROXY_BASE.replace(/\/+$/, '') + '/?sku=' + encodeURIComponent(sku)
    );
}

/**
 * Fetch a single SKU's Nahdi product object through the Worker. Cached per SKU
 * and de-duplicated per in-flight SKU. Returns the product object (with
 * `price`, `shelf_price`, `item_brand`, …) or null.
 * @param {string|number} sku
 * @returns {Promise<object|null>}
 */
export async function fetchNahdiItem(sku) {
    sku = String(sku == null ? '' : sku).trim();
    if (!sku || !nahdiEnabled()) return null;
    if (sku in itemCache) return itemCache[sku];
    if (pending[sku]) return pending[sku];

    pending[sku] = doFetch(sku);
    try {
        return await pending[sku];
    } finally {
        delete pending[sku];
    }
}

/**
 * Internal: one request, with a timeout.
 *
 * An empty answer means Nahdi does not know the SKU, which IS cached. A network
 * or Worker failure is usually transient, so that is NOT cached and a later
 * lookup retries.
 */
async function doFetch(sku) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
    try {
        var res = await fetch(proxyUrlForSku(sku), {
            headers: { Accept: 'application/json' },
            signal: controller.signal
        });
        if (res.ok) {
            var data = await res.json();
            var obj = Array.isArray(data) ? data[0] : data;
            itemCache[sku] = obj || null;
            return itemCache[sku];
        }
        console.warn('NahdiApi: proxy returned ' + res.status + ' for SKU ' + sku);
    } catch (_err) {
        console.warn('NahdiApi: proxy request failed for SKU ' + sku);
    } finally {
        clearTimeout(timer);
    }
    return null;
}

/**
 * Fetch a single SKU's tag price (see pickNahdiPrice). Cached per SKU.
 * @param {string|number} sku
 * @returns {Promise<number|null>}
 */
export async function fetchNahdiPrice(sku) {
    var obj = await fetchNahdiItem(sku);
    return obj ? pickNahdiPrice(obj) : null;
}

/**
 * Fetch a single SKU's brand (`item_brand`). Cached per SKU. Returns '' when
 * unknown.
 * @param {string|number} sku
 * @returns {Promise<string>}
 */
export async function fetchNahdiBrand(sku) {
    var obj = await fetchNahdiItem(sku);
    return obj && obj.item_brand != null ? String(obj.item_brand) : '';
}

/**
 * True when a price fallback path exists. With the Worker as the only route,
 * that means NAHDI_PROXY_BASE is configured.
 */
export function nahdiEnabled() {
    return !!NAHDI_PROXY_BASE;
}
