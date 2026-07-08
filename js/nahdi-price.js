/**
 * On-demand price fallback via the Nahdi product API.
 *
 * Used when an item IS found in the master but its price cell is empty. We look
 * the item up by SKU through the Nahdi API (which only allows its own origin,
 * so a browser page cannot call it directly) and read the retail price from the
 * response.
 *
 * Two ways past CORS, tried in order:
 *   1. NAHDI_PROXY_BASE — an optional self-hosted Cloudflare Worker (most
 *      reliable; see nahdi-proxy-worker.js). Leave empty to skip.
 *   2. CORS_PROXIES — public CORS proxies. This is the same approach the old,
 *      working transfersregister app used (old/transfersregister/js/nahdi-api.js)
 *      and needs no deployment, so the fallback works out of the box.
 */
export const NAHDI_PROXY_BASE = ''; // optional: 'https://nahdi-proxy.you.workers.dev'

// Full Nahdi product endpoint. The extra params match the old working app.
var API_BASE = 'https://www.nahdionline.com/api/analytics/product';

// Public CORS proxies, tried in order until one returns JSON. Ported verbatim
// from the old working nahdi-api.js.
var CORS_PROXIES = [
    function (url) { return 'https://corsproxy.io/?' + encodeURIComponent(url); },
    function (url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); },
];

// sku -> resolved Nahdi item object, or null (looked up, nothing usable).
// Shared by price and brand lookups so a SKU is fetched at most once.
var itemCache = Object.create(null);

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
 * Build the list of proxied URLs to try for one SKU, in priority order:
 * the self-hosted Worker first (if configured), then the public CORS proxies.
 * @param {string} sku
 * @returns {string[]}
 */
function proxyUrlsForSku(sku) {
    var urls = [];
    if (NAHDI_PROXY_BASE) {
        urls.push(
            NAHDI_PROXY_BASE.replace(/\/+$/, '') + '/?skus=' + encodeURIComponent(sku)
        );
    }
    // Public proxies wrap the FULL Nahdi API URL (with the params the old app used).
    var apiUrl =
        API_BASE +
        '?skus=' + encodeURIComponent(sku) +
        '&language=en&region=SA&category_id=15125';
    for (var i = 0; i < CORS_PROXIES.length; i++) {
        urls.push(CORS_PROXIES[i](apiUrl));
    }
    return urls;
}

/**
 * Fetch a single SKU's Nahdi product object through a proxy. Cached per SKU.
 * Tries each proxy in turn and uses the first that returns usable JSON — same
 * strategy as the old working nahdi-api.js. Returns the product object (with
 * `price`, `shelf_price`, `item_brand`, …) or null.
 * @param {string|number} sku
 * @returns {Promise<object|null>}
 */
export async function fetchNahdiItem(sku) {
    sku = String(sku == null ? '' : sku).trim();
    if (!sku) return null;
    if (sku in itemCache) return itemCache[sku];

    var urls = proxyUrlsForSku(sku);
    var data = null;

    for (var i = 0; i < urls.length; i++) {
        try {
            var res = await fetch(urls[i], { headers: { Accept: 'application/json' } });
            if (res.ok) {
                data = await res.json();
                if (data) break;
            }
        } catch (_err) {
            /* try next proxy */
        }
    }

    if (!data) {
        console.warn('NahdiApi: all proxies failed for SKU ' + sku);
        itemCache[sku] = null;
        return null;
    }

    var obj = Array.isArray(data) ? data[0] : data;
    itemCache[sku] = obj || null;
    return itemCache[sku];
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
 * True when a price fallback path exists. Public CORS proxies are always
 * available, so this is now always on.
 */
export function nahdiEnabled() {
    return true;
}
