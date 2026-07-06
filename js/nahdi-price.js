/**
 * On-demand price fallback via the Nahdi product API.
 *
 * Used when an item IS found in the master but its price cell is empty. We look
 * the item up by SKU through a CORS proxy (the Nahdi API only allows its own
 * origin, so a browser page cannot call it directly — see nahdi-proxy-worker.js)
 * and read the retail price from the response.
 *
 * >>> CONFIGURE ME <<<
 * Paste your deployed Cloudflare Worker URL here. While this is empty, the
 * fallback is simply skipped and the app behaves exactly as before.
 */
export const NAHDI_PROXY_BASE = ''; // e.g. 'https://nahdi-proxy.you.workers.dev'

// sku -> resolved price (number) or null (looked up, no price). Avoids refetching.
var priceCache = Object.create(null);

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
 * Fetch a single SKU's price through the proxy. Cached per SKU.
 * @param {string|number} sku
 * @returns {Promise<number|null>}
 */
export async function fetchNahdiPrice(sku) {
    sku = String(sku == null ? '' : sku).trim();
    if (!sku) return null;
    if (sku in priceCache) return priceCache[sku];
    if (!NAHDI_PROXY_BASE) {
        throw new Error('NAHDI_PROXY_BASE is not configured in js/nahdi-price.js');
    }

    var url =
        NAHDI_PROXY_BASE.replace(/\/+$/, '') +
        '/?skus=' +
        encodeURIComponent(sku);

    var res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
        priceCache[sku] = null;
        return null;
    }
    var data = await res.json();
    var obj = Array.isArray(data) ? data[0] : data;
    var price = obj ? pickNahdiPrice(obj) : null;
    priceCache[sku] = price;
    return price;
}

/** True when a proxy URL has been configured. */
export function nahdiEnabled() {
    return !!NAHDI_PROXY_BASE;
}
