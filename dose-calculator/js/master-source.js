/**
 * Barcode → SKU bridge.
 *
 * imFile.csv is keyed by SKU only, so a scanned barcode/GTIN cannot be resolved
 * from it. `items.csv` — the master the main lookup page already loads — has both,
 * so this module reuses that master to turn any scanned code into a SKU:
 *
 *     scanned code ──▶ items.csv (lookupRowIndex) ──▶ sku ──▶ imFile.csv
 *
 * The master is indexed with the very same worker and resolution rules as the main
 * page ([js/master-worker.js](../../js/master-worker.js) and
 * [js/search-logic.js](../../js/search-logic.js)) so a code resolves identically on
 * both pages.
 *
 * The file itself is not copied anywhere: the main page parks its
 * `FileSystemFileHandle` in IndexedDB and this page reads it back. Permission for
 * that handle may need a click, hence `restoreMaster` vs `requestStoredMaster`.
 */

import { MASTER_FILENAME } from '../../js/config.js';
import { lookupRowIndex } from '../../js/search-logic.js';
import {
    loadMasterHandle,
    saveMasterHandle,
    clearMasterHandle,
} from '../../js/master-handle-store.js';

let indexes = null;
let worker = null;

/** @returns {boolean} */
export function masterReady() {
    return indexes !== null;
}

/** @returns {number} */
export function masterRowCount() {
    return indexes ? indexes.rows.length : 0;
}

/** @returns {boolean} true in Chrome/Edge */
export function filePickerSupported() {
    return typeof window.showOpenFilePicker === 'function';
}

function disposeWorker() {
    if (worker) {
        worker.terminate();
        worker = null;
    }
}

/**
 * Hand the master text to the shared indexing worker.
 * @param {string} text
 * @returns {Promise<number>} indexed row count
 */
function buildIndexes(text) {
    return new Promise(function (resolve, reject) {
        disposeWorker();
        worker = new Worker(new URL('../../js/master-worker.js', import.meta.url), {
            type: 'module',
        });

        worker.onmessage = function (ev) {
            const d = ev.data;
            if (!d || d.type !== 'done') return;
            indexes = {
                rows: d.rows,
                bySku: d.bySku,
                byBarcodeStr: d.byBarcodeStr,
                byBarcodeNum: d.byBarcodeNum,
                byGtin: d.byGtin,
            };
            disposeWorker();
            resolve(indexes.rows.length);
        };

        worker.onerror = function (err) {
            disposeWorker();
            reject(err instanceof Error ? err : new Error('Worker error while indexing.'));
        };

        worker.postMessage({ type: 'build', text: text });
    });
}

async function readAndIndex(handle) {
    const file = await handle.getFile();
    const text = await file.text();
    return buildIndexes(text);
}

/**
 * Is there a master file remembered from the main page at all?
 * @returns {Promise<boolean>}
 */
export async function hasStoredMaster() {
    const handle = await loadMasterHandle();
    return !!handle;
}

/**
 * Load the remembered master **without prompting** — only succeeds when the
 * permission grant is still live. Call this on page load.
 *
 * @returns {Promise<'loaded'|'needs-permission'|'none'>}
 */
export async function restoreMaster() {
    if (indexes) return 'loaded';

    const handle = await loadMasterHandle();
    if (!handle) return 'none';

    let perm = 'denied';
    try {
        perm = await handle.queryPermission({ mode: 'read' });
    } catch (err) {
        return 'needs-permission';
    }
    if (perm !== 'granted') return 'needs-permission';

    try {
        await readAndIndex(handle);
        return 'loaded';
    } catch (err) {
        // The file was moved, renamed or deleted since the main page saw it.
        await clearMasterHandle();
        return 'none';
    }
}

/**
 * Load the remembered master, asking for permission if needed. **Must be called
 * from a user gesture** — `requestPermission` throws otherwise.
 *
 * @returns {Promise<number>} indexed row count
 */
export async function requestStoredMaster() {
    const handle = await loadMasterHandle();
    if (!handle) {
        throw new Error('No ' + MASTER_FILENAME + ' has been loaded on the main page yet.');
    }

    const perm = await handle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') {
        throw new Error('Permission to read ' + MASTER_FILENAME + ' was declined.');
    }

    try {
        return await readAndIndex(handle);
    } catch (err) {
        await clearMasterHandle();
        throw new Error(
            'The remembered ' + MASTER_FILENAME + ' could not be read — pick it again.'
        );
    }
}

/**
 * Pick `items.csv` here instead of on the main page. Applies the same
 * exact-filename rule as `onPickMasterFile` in [js/app.js](../../js/app.js), and
 * remembers the handle so both pages can use it.
 *
 * @returns {Promise<number>} indexed row count
 */
export async function pickMaster() {
    if (!filePickerSupported()) {
        throw new Error('This browser cannot pick files here. Use Chrome or Edge.');
    }

    const handles = await window.showOpenFilePicker({
        types: [
            {
                description: 'Master CSV',
                accept: { 'text/csv': ['.csv'], 'text/plain': ['.csv'] },
            },
        ],
        excludeAcceptAllOption: false,
        multiple: false,
    });

    if (!handles || !handles.length) {
        throw new Error('No file selected.');
    }

    const fh = handles[0];
    if (fh.name.toLowerCase() !== MASTER_FILENAME.toLowerCase()) {
        throw new Error(
            'The file must be named exactly "' + MASTER_FILENAME + '". You selected: "' +
                fh.name + '".'
        );
    }

    const count = await readAndIndex(fh);
    saveMasterHandle(fh);
    return count;
}

/**
 * Resolve a scanned code against the master.
 *
 * @param {string} rawCode — barcode, SKU or GTIN
 * @returns {{sku: string, nameEn: string, nameAr: string, barcode: string, gtin: string}|null}
 */
export function masterLookup(rawCode) {
    if (!indexes) return null;
    const ix = lookupRowIndex(indexes, rawCode);
    if (ix < 0) return null;
    const row = indexes.rows[ix];
    return {
        sku: row.sku || '',
        nameEn: row.nameEn || '',
        nameAr: row.nameAr || '',
        barcode: row.barcode || '',
        gtin: row.gtin || '',
    };
}
