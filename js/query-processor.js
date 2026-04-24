import { parseCSVLine } from './csv-utils.js';

/**
 * Extract lookup codes from a query CSV (e.g. 1-TAG,code,1 → use middle column).
 * @param {string} text
 * @returns {string[]}
 */
export function extractQueryCodes(text) {
    var lines = text.split(/\r?\n/).filter(function (ln) {
        return ln.length > 0;
    });
    var codes = [];
    var i;
    var cols;
    var id;

    for (i = 0; i < lines.length; i++) {
        cols = parseCSVLine(lines[i]);
        if (cols.length >= 2) {
            id = cols[1].trim();
        } else {
            id = (cols[0] || '').trim();
        }
        if (id) codes.push(id);
    }
    return codes;
}
