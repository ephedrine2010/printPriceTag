/**
 * Persist the picked `items.csv` handle so other pages can reuse it.
 *
 * The File System Access API hands back a `FileSystemFileHandle` that survives a
 * structured clone, so it can be parked in IndexedDB and read back on a different
 * page of the same origin. Re-reading the file still needs permission: Chrome
 * usually keeps the grant for the tab/session, otherwise `requestPermission` must
 * be called from a user gesture (a button click).
 *
 * Every function here fails soft — a browser without IndexedDB or the File System
 * Access API just means "no remembered master file".
 */

const DB_NAME = 'web-print-prices';
const DB_VERSION = 1;
const STORE = 'handles';
const MASTER_KEY = 'master-file';

function openDb() {
    return new Promise(function (resolve, reject) {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB is not available in this browser.'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE);
            }
        };
        req.onsuccess = function () {
            resolve(req.result);
        };
        req.onerror = function () {
            reject(req.error || new Error('Could not open IndexedDB.'));
        };
    });
}

function withStore(mode, run) {
    return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE, mode);
            const req = run(tx.objectStore(STORE));
            tx.oncomplete = function () {
                db.close();
                resolve(req ? req.result : undefined);
            };
            tx.onabort = tx.onerror = function () {
                db.close();
                reject(tx.error || new Error('IndexedDB transaction failed.'));
            };
        });
    });
}

/**
 * Remember the master-file handle. Never throws.
 * @param {FileSystemFileHandle} handle
 * @returns {Promise<boolean>} true when it was stored
 */
export function saveMasterHandle(handle) {
    if (!handle) return Promise.resolve(false);
    return withStore('readwrite', function (store) {
        return store.put(handle, MASTER_KEY);
    }).then(
        function () {
            return true;
        },
        function (err) {
            console.warn('Could not remember the master file handle.', err);
            return false;
        }
    );
}

/**
 * Read back the remembered master-file handle. Never throws.
 * @returns {Promise<FileSystemFileHandle|null>}
 */
export function loadMasterHandle() {
    return withStore('readonly', function (store) {
        return store.get(MASTER_KEY);
    }).then(
        function (handle) {
            return handle || null;
        },
        function (err) {
            console.warn('Could not read the remembered master file handle.', err);
            return null;
        }
    );
}

/**
 * Forget the remembered handle (e.g. after it goes stale). Never throws.
 * @returns {Promise<void>}
 */
export function clearMasterHandle() {
    return withStore('readwrite', function (store) {
        return store.delete(MASTER_KEY);
    }).then(
        function () {},
        function () {}
    );
}
