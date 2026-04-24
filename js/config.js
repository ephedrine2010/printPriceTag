/**
 * Column indices for items.csv (0-based, no header row).
 */
export const COL = {
    BARCODE: 0,
    SKU: 1,
    NAME_EN: 2,
    NAME_AR: 3,
    ITEM_PRICE: 4,
    GTIN: 7,
    VAT: 9,
};

export const MASTER_FILENAME = 'items.csv';

/** Minimum columns required on each master row */
export const MASTER_MIN_COLS = 10;
