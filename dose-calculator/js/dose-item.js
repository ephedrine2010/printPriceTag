/**
 * The `DoseItem` model — a JS port of the legacy Dart `dose_item_model.dart`.
 *
 * The Dart app read these rows from a local SQLite table called `imfile`; here the
 * same rows come straight from the headerless CSV in
 * [assets/imFile.csv](../assets/imFile.csv), so the column positions below stand in
 * for the table's columns.
 */

/** Column indices for imFile.csv (0-based, no header row). */
export const IM_COL = {
    SKU: 0,
    NAME_AR: 1,
    NAME_EN: 2,
    ITEM_TYPE: 3,
    UNITS: 4,
    UNIT_TYPE: 5,
    DOSE_FREQUENCY: 6,
    NOTE: 7,
    IMAGE_URL: 8,
};

/** Rows with fewer columns than this are skipped. */
export const IMFILE_MIN_COLS = 7;

/** Nahdi's "no picture" placeholder — treated as no image at all. */
const PLACEHOLDER_IMAGE = 'reds-404.png';

function cell(cols, i) {
    const v = cols[i];
    return v == null ? '' : String(v).trim();
}

/** The imFile exports "NULL" for empty note cells. */
function optionalCell(cols, i) {
    const v = cell(cols, i);
    return v.toUpperCase() === 'NULL' ? '' : v;
}

function toDouble(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
}

/**
 * Build a DoseItem from one parsed CSV row.
 *
 * @param {string[]} cols — output of `parseCSVLine`
 * @returns {{
 *   id: string, sku: string, nameEn: string, nameAr: string, itemType: string,
 *   units: number, unitType: string, doseFrequency: string, note: string,
 *   imageUrl: string
 * }|null} null when the row is unusable
 */
export function doseItemFromRow(cols) {
    if (!cols || cols.length < IMFILE_MIN_COLS) return null;

    const sku = cell(cols, IM_COL.SKU);
    const nameEn = cell(cols, IM_COL.NAME_EN);
    if (!sku || !nameEn) return null;

    const imageUrl = cell(cols, IM_COL.IMAGE_URL);

    return {
        // The SQLite table had its own `id`; the CSV does not, and the SKU is
        // unique in it, so it doubles as the row identity.
        id: sku,
        sku: sku,
        nameEn: nameEn,
        nameAr: cell(cols, IM_COL.NAME_AR),
        itemType: cell(cols, IM_COL.ITEM_TYPE).toLowerCase(),
        units: toDouble(cell(cols, IM_COL.UNITS)),
        unitType: cell(cols, IM_COL.UNIT_TYPE),
        // Dart parsed this as a double, which always yielded 0 — the column
        // actually holds a period ("day" / "week"), so it is kept as text here
        // and only ever displayed. It takes no part in the maths.
        doseFrequency: cell(cols, IM_COL.DOSE_FREQUENCY),
        note: optionalCell(cols, IM_COL.NOTE),
        imageUrl: imageUrl.indexOf(PLACEHOLDER_IMAGE) === -1 ? imageUrl : '',
    };
}

