import { lookupRowIndex, priceWithVat } from './search-logic.js';

/**
 * @param {string[]} codes
 * @param {object} indexes
 * @param {boolean} vatRequired
 * @returns {{ query: string, status: string, nameEn: string, nameAr: string, price: string|number, vat: string }[]}
 */
export function runLookups(codes, indexes, vatRequired) {
    var out = [];
    var i;
    var code;
    var ix;
    var row;
    var p;

    for (i = 0; i < codes.length; i++) {
        code = codes[i];
        ix = lookupRowIndex(indexes, code);
        row = ix >= 0 ? indexes.rows[ix] : null;

        if (row) {
            p = priceWithVat(row, vatRequired);
            out.push({
                query: code,
                status: 'found',
                nameEn: row.nameEn,
                nameAr: row.nameAr,
                price: p != null ? p : '',
                vat: row.vat,
            });
        } else {
            out.push({
                query: code,
                status: 'not_found',
                nameEn: '',
                nameAr: '',
                price: '',
                vat: '',
            });
        }
    }
    return out;
}

function escapeCsvField(val) {
    var s = String(val);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

/**
 * @param {{ query: string, status: string, nameEn: string, nameAr: string, price: string|number, vat: string }[]} rows
 * @returns {string}
 */
export function resultsToCsv(rows) {
    var header = [
        'query',
        'status',
        'name_en',
        'name_ar',
        'price',
        'vat',
    ].join(',');
    var lines = [header];
    var i;
    var r;

    for (i = 0; i < rows.length; i++) {
        r = rows[i];
        lines.push(
            [
                escapeCsvField(r.query),
                escapeCsvField(r.status),
                escapeCsvField(r.nameEn),
                escapeCsvField(r.nameAr),
                escapeCsvField(r.price),
                escapeCsvField(r.vat),
            ].join(',')
        );
    }
    return lines.join('\n');
}
