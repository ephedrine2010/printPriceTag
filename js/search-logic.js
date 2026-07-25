/**
 * Barcode / SKU / GTIN resolution (same rules as transfers register database.js).
 */

/**
 * @param {string|number} barcode
 * @returns {string}
 */
export function extractBarcode(barcode) {
    barcode = String(barcode).trim();
    if (barcode.length > 16) {
        barcode = barcode.substring(2, 16);
    }
    return barcode;
}

/**
 * @param {object} indexes — from worker: { rows, bySku, byBarcodeStr, byBarcodeNum, byGtin }
 * @param {string} rawCode
 * @returns {number} row index, or -1
 */
export function lookupRowIndex(indexes, rawCode) {
    const code = extractBarcode(rawCode);
    if (!code) return -1;

    const len = code.length;
    const {
        bySku,
        byBarcodeStr,
        byBarcodeNum,
        byGtin,
    } = indexes;

    let idx = -1;

    if (len === 9) {
        const skuKey = parseInt(code, 10);
        if (!isNaN(skuKey) && bySku[skuKey] !== undefined) {
            idx = bySku[skuKey];
        }
        if (idx < 0) {
            const bc = parseInt(code, 10);
            if (!isNaN(bc)) {
                if (byBarcodeNum[bc] !== undefined) idx = byBarcodeNum[bc];
                else if (byBarcodeStr[code] !== undefined) idx = byBarcodeStr[code];
            }
        }
    } else if (len < 9) {
        const n = parseFloat(code);
        if (!isNaN(n) && byBarcodeNum[n] !== undefined) idx = byBarcodeNum[n];
        else if (byBarcodeStr[code] !== undefined) idx = byBarcodeStr[code];
    } else if (len < 14 && len > 9) {
        const n = parseFloat(code);
        if (!isNaN(n) && byBarcodeNum[n] !== undefined) idx = byBarcodeNum[n];
        else if (byBarcodeStr[code] !== undefined) idx = byBarcodeStr[code];
        if (idx < 0 && byGtin[code] !== undefined) idx = byGtin[code];
    } else if (len > 13) {
        if (byGtin[code] !== undefined) idx = byGtin[code];
    }

    return idx;
}

/**
 * Code to show in the Query column for a matched row.
 *
 * When the queried code is the item's SKU, or is longer than 16 chars (the same
 * threshold extractBarcode truncates at), it is not a usable barcode — show the
 * item's GTIN instead. A GTIN of "-" is a placeholder in the master, so fall
 * back to the item's barcode column. Unmatched queries are shown as typed.
 *
 * @param {object|null} row — { sku, barcode, gtin, ... }
 * @param {string} rawCode
 * @returns {string}
 */
export function displayCode(row, rawCode) {
    const code = String(rawCode).trim();
    if (!row) return code;

    const sku = row.sku ? String(row.sku).trim() : '';
    const isSku = sku !== '' && code === sku;
    if (!isSku && code.length <= 16) return code;

    const gtin = row.gtin ? String(row.gtin).trim() : '';
    if (gtin && gtin !== '-') return gtin;

    const barcode = row.barcode ? String(row.barcode).trim() : '';
    return barcode || code;
}

/**
 * @param {object} row — { nameEn, nameAr, itemPrice, vat }
 * @param {boolean} vatRequired
 */
export function priceWithVat(row, vatRequired) {
    if (row.itemPrice == null || row.itemPrice === '') return null;
    const base = parseFloat(row.itemPrice);
    if (isNaN(base)) return null;
    if (!vatRequired) return base;
    const vat = parseFloat(row.vat) || 0;
    const mult = (vat + 100) / 100;
    return parseFloat((base * mult).toFixed(2));
}
