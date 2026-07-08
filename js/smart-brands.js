/**
 * Smart-brand list.
 *
 * `assets/SL-updates.csv` is a one-brand-per-line list of brands whose printed
 * price tag should show the small black "smart" square (the `is_smart` box in
 * the Dart print shell). The master CSV has no brand column, so an item's brand
 * is taken from the Nahdi API (`item_brand`, see nahdi-price.js) and checked
 * against this list.
 *
 * Matching is "normalized exact": both sides are lowercased and stripped of
 * every non-alphanumeric character, then compared for equality. Stripping (not
 * just collapsing) punctuation lets inconsistent spellings agree, e.g.
 * "LOccitane" vs "L'Occitane", "Nature'S Bounty" vs "Nature's Bounty".
 */

var SL_CSV_URL = new URL('../assets/SL-updates.csv', import.meta.url);

// Set of normalized brand keys (object used as a set). null until loaded.
var brandSet = null;
var loadPromise = null;

/**
 * Normalize a brand for comparison: lowercase, drop every non-alphanumeric
 * character (spaces, apostrophes, hyphens, ampersands, …).
 * @param {*} s
 * @returns {string}
 */
export function normalizeBrand(s) {
    return String(s == null ? '' : s)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Load and index the smart-brand list once. Safe to call repeatedly — later
 * calls return the same in-flight/resolved promise. On failure the list is
 * treated as empty (nothing gets marked smart) and the error is logged.
 * @returns {Promise<object>}
 */
export function loadSmartBrands() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(SL_CSV_URL)
        .then(function (res) {
            if (!res.ok) throw new Error('SL-updates.csv HTTP ' + res.status);
            return res.text();
        })
        .then(function (text) {
            var set = Object.create(null);
            var lines = text.split(/\r?\n/);
            for (var i = 0; i < lines.length; i++) {
                var key = normalizeBrand(lines[i]);
                if (key) set[key] = true;
            }
            brandSet = set;
            return set;
        })
        .catch(function (err) {
            console.warn('smart-brands: failed to load list', err);
            brandSet = Object.create(null); // empty => nothing marked smart
            return brandSet;
        });
    return loadPromise;
}

/**
 * True when the given brand string matches an entry in the smart list. Returns
 * false until loadSmartBrands() has resolved.
 * @param {*} brand
 * @returns {boolean}
 */
export function isSmartBrand(brand) {
    if (!brandSet) return false;
    var key = normalizeBrand(brand);
    return !!key && !!brandSet[key];
}
