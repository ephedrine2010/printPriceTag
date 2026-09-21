/**
 * Offline cache of Nahdi lookups, committed to the repo.
 *
 * WHY THIS EXISTS
 *   Some devices sit behind a web filter that allows only a short list of
 *   domains. Measured on one of them: `workers.dev` (our proxy),
 *   `azurewebsites.net` and `azurestaticapps.net` are all blocked, while
 *   GitHub and the app's own origin are fine. Generic app-hosting domains are
 *   blocked as a category, so moving the proxy elsewhere does not help.
 *
 *   `assets/nahdi-cache.json` ships inside the repo, so it loads **same-origin**
 *   from GitHub Pages. No CORS, no proxy, no third-party host: if a device can
 *   open the app at all, it can read this file.
 *
 * HOW IT FILLS UP
 *   A device that *can* reach the Worker (your own PC) fetches live as usual,
 *   and every result is recorded here. The entries survive across sessions in
 *   localStorage, and "Save price cache" writes the merged file for you to
 *   commit. Restricted devices then read what you saved.
 *
 * ENTRY SHAPE
 *   The file stores the already-resolved price (what pickNahdiPrice chose) and
 *   the brand, keyed by SKU:
 *       { "updated": "<ISO date>", "items": { "100015980": { "price": 8,
 *                                                           "brand": "Panadol" } } }
 *   Reads are handed back as a Nahdi-shaped object so callers can keep using
 *   pickNahdiPrice() and `item_brand` without caring where the data came from.
 */

var CACHE_URL = new URL('../assets/nahdi-cache.json', import.meta.url);
var LS_KEY = 'nahdiCachePending';

// sku -> { price, brand } from the committed file. null until loaded.
var fileItems = null;
var loadPromise = null;

// sku -> { price, brand } fetched live and not yet written to the file.
var pendingItems = readPending();

/**
 * Load the committed cache once. Safe to call repeatedly — later calls return
 * the same in-flight/resolved promise. A missing or malformed file is treated
 * as empty, since the app must still work before the file exists.
 * @returns {Promise<object>} sku -> { price, brand }
 */
export function loadNahdiCache() {
    if (loadPromise) return loadPromise;

    loadPromise = fetch(CACHE_URL, { cache: 'no-cache' })
        .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(function (data) {
            fileItems = (data && data.items) || {};
            return fileItems;
        })
        .catch(function (err) {
            console.warn('NahdiCache: no usable cache file (' + err.message + ')');
            fileItems = Object.create(null);
            return fileItems;
        });

    return loadPromise;
}

/**
 * Look a SKU up in the cache (committed file first, then anything fetched live
 * this session). Returns a Nahdi-shaped object, or null when not cached.
 *
 * `loadNahdiCache()` must have resolved first; callers in nahdi-price.js await
 * it before asking.
 * @param {string} sku
 * @returns {object|null}
 */
export function cacheLookup(sku) {
    var e = pendingItems[sku] || (fileItems && fileItems[sku]);
    if (!e) return null;
    // Both price fields carry the resolved value so pickNahdiPrice returns it
    // unchanged, whichever branch it takes.
    return {
        item_id: sku,
        price: e.price,
        shelf_price: e.price,
        item_brand: e.brand || '',
        _fromCache: true
    };
}

/**
 * Record a live Nahdi result so it can be exported later. Called only for
 * genuine fetches — replaying a cache hit back into the cache is pointless.
 * @param {string} sku
 * @param {number|null} price — already resolved by pickNahdiPrice
 * @param {string} brand
 */
export function recordNahdiItem(sku, price, brand) {
    var existing = (fileItems && fileItems[sku]) || null;
    if (existing && existing.price === price && (existing.brand || '') === (brand || '')) {
        return; // unchanged — nothing to save
    }
    pendingItems[sku] = { price: price == null ? null : price, brand: brand || '' };
    writePending();
}

/**
 * How much the cache holds: entries in the committed file, and entries fetched
 * live that are not in it yet.
 * @returns {{ inFile: number, pending: number }}
 */
export function nahdiCacheStats() {
    return {
        inFile: fileItems ? Object.keys(fileItems).length : 0,
        pending: Object.keys(pendingItems).length
    };
}

/**
 * Build the merged cache file and hand it to the browser as a download. Save it
 * over `assets/nahdi-cache.json` and commit it; restricted devices pick it up
 * on the next deploy.
 * @returns {number} how many SKUs the written file holds
 */
export function exportNahdiCache() {
    var merged = Object.create(null);
    var sku;
    for (sku in (fileItems || {})) merged[sku] = fileItems[sku];
    for (sku in pendingItems) merged[sku] = pendingItems[sku];

    // Sorted keys keep the committed file's diffs readable.
    var keys = Object.keys(merged).sort();
    var items = {};
    for (var i = 0; i < keys.length; i++) items[keys[i]] = merged[keys[i]];

    var text = JSON.stringify({ updated: new Date().toISOString(), items: items }, null, 1);
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nahdi-cache.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);

    return keys.length;
}

/**
 * Forget the live-fetched entries that have not been written to the file. Used
 * after a successful export, once the user confirms they saved it.
 */
export function clearPendingNahdiCache() {
    pendingItems = Object.create(null);
    writePending();
}

// ─── localStorage persistence ───────────────────────────────────────────
// Keeps accumulated lookups across sessions so a day's work is not lost if the
// user forgets to export. Every access is guarded: storage can be disabled or
// full, and the feature must survive that.

function readPending() {
    try {
        var raw = localStorage.getItem(LS_KEY);
        if (raw) return JSON.parse(raw) || Object.create(null);
    } catch (_err) {
        /* private window, blocked storage, or corrupt JSON — start empty */
    }
    return Object.create(null);
}

function writePending() {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(pendingItems));
    } catch (_err) {
        /* quota or blocked storage — the in-memory copy still works this session */
    }
}
