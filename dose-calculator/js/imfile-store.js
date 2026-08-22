/**
 * Loads and searches [assets/imFile.csv](../assets/imFile.csv) — the dose list.
 *
 * This replaces the Dart app's SQLite `imfile` table. The file is small (under a
 * thousand rows), so it is fetched once and kept in memory; `searchByName` is the
 * port of the Dart service's
 * `SELECT * FROM imfile WHERE name_en LIKE '%q%' LIMIT 50`.
 */

import { parseCSVLine } from '../../js/csv-utils.js';
import { doseItemFromRow } from './dose-item.js';

const IMFILE_URL = new URL('../assets/imFile.csv', import.meta.url);

/** Same cap as the legacy SQL query. */
export const SEARCH_LIMIT = 50;

let items = null;
let bySku = null;
let loading = null;

/**
 * imFile.csv is written with bare CR line endings, so the shared `splitLines`
 * (which only knows CRLF/LF) would hand back the whole file as one line.
 * @param {string} text
 * @returns {string[]}
 */
function splitAnyLines(text) {
    return text.split(/\r\n|\r|\n/).filter(function (ln) {
        return ln.length > 0;
    });
}

function parseImFile(text) {
    const lines = splitAnyLines(text);
    const out = [];
    const index = Object.create(null);

    for (let i = 0; i < lines.length; i++) {
        const item = doseItemFromRow(parseCSVLine(lines[i]));
        if (!item) continue;
        const at = out.length;
        out.push(item);
        if (index[item.sku] === undefined) index[item.sku] = at;
    }

    items = out;
    bySku = index;
}

/**
 * Fetch and index the dose list. Safe to call repeatedly — the work happens once.
 * @returns {Promise<number>} number of usable rows
 */
export function loadImFile() {
    if (items) return Promise.resolve(items.length);
    if (loading) return loading;

    loading = fetch(IMFILE_URL)
        .then(function (res) {
            if (!res.ok) {
                throw new Error(
                    'Could not load imFile.csv (' + res.status + ' ' + res.statusText + ').'
                );
            }
            return res.text();
        })
        .then(function (text) {
            parseImFile(text);
            loading = null;
            return items.length;
        })
        .catch(function (err) {
            loading = null;
            throw err;
        });

    return loading;
}

/** @returns {boolean} */
export function imFileReady() {
    return items !== null;
}

/** @returns {number} */
export function itemCount() {
    return items ? items.length : 0;
}

/**
 * How well a name matches — lower is better. Only used to order the suggestion
 * list; which names match at all is still the SQL's plain substring test.
 */
function matchRank(name, q) {
    const at = name.indexOf(q);
    if (at === -1) return -1;
    if (at === 0) return 0; // name starts with the query
    if (name.charAt(at - 1) === ' ') return 1; // query starts a word
    return 2;
}

/**
 * Case-insensitive substring match on the English name — the `LIKE '%q%'` port.
 *
 * The matched *set* is the SQL's; the order is not. The suggestion dropdown wants
 * the closest names first, so hits are ranked (starts-with, then word-start, then
 * anywhere) and shorter names win ties, instead of the SQL's raw file order.
 *
 * @param {string} query
 * @param {number} [limit=SEARCH_LIMIT]
 * @returns {object[]}
 */
export function searchByName(query, limit) {
    if (!items) return [];
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];

    const hits = [];
    for (let i = 0; i < items.length; i++) {
        const name = items[i].nameEn.toLowerCase();
        const rank = matchRank(name, q);
        if (rank >= 0) hits.push({ item: items[i], rank: rank, len: name.length });
    }

    hits.sort(function (a, b) {
        return a.rank - b.rank || a.len - b.len;
    });

    const cap = limit === undefined ? SEARCH_LIMIT : limit;
    return hits.slice(0, cap).map(function (h) {
        return h.item;
    });
}

/**
 * Exact SKU lookup. Leading zeros are ignored so a scanner that pads the code
 * still lands on the right row.
 *
 * @param {string|number} sku
 * @returns {object|null}
 */
export function findBySku(sku) {
    if (!items) return null;
    const key = String(sku == null ? '' : sku).trim();
    if (!key) return null;

    if (bySku[key] !== undefined) return items[bySku[key]];

    const unpadded = key.replace(/^0+/, '');
    if (unpadded && unpadded !== key && bySku[unpadded] !== undefined) {
        return items[bySku[unpadded]];
    }
    return null;
}
