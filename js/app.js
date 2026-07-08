import { MASTER_FILENAME } from './config.js';
import { extractQueryCodes } from './query-processor.js';
import { runLookups } from './results-export.js';
import { lookupRowIndex, priceWithVat } from './search-logic.js';
import { openPriceTagsPrint } from './print/open-price-tags-print.js';
import { fetchNahdiItem, pickNahdiPrice, nahdiEnabled } from './nahdi-price.js';
import { loadSmartBrands, isSmartBrand } from './smart-brands.js';

(function () {
    var masterIndexes = null;
    var worker = null;

    var elPickMasterFile = document.getElementById('btn-pick-master-file');
    var elMasterStatus = document.getElementById('master-status');
    var elMasterSpinner = document.getElementById('master-spinner');

    var elQueryInput = document.getElementById('query-file');
    var elRunQuery = document.getElementById('btn-run-query');
    var elVatInclusive = document.getElementById('chk-vat-inclusive');
    var elPrintTags = document.getElementById('btn-print-tags');

    var elManualCode = document.getElementById('manual-code');
    var elManualLookup = document.getElementById('btn-manual-lookup');

    var elResultsSection = document.getElementById('results-section');
    var elResultsBody = document.getElementById('results-body');
    var elResultsMeta = document.getElementById('results-meta');

    var lastResults = [];
    // Latest in-flight autoFillNahdiData() promise, awaited before printing so
    // smart-brand marks (and any online prices) are resolved on the tags.
    var pendingNahdi = null;

    function setMasterStatus(text, kind) {
        elMasterStatus.textContent = text;
        elMasterStatus.className = 'status-pill ' + (kind || '');
    }

    function setMasterLoading(loading) {
        elMasterSpinner.hidden = !loading;
    }

    function ensureWorker() {
        if (worker) return worker;
        worker = new Worker(new URL('./master-worker.js', import.meta.url), {
            type: 'module',
        });
        return worker;
    }

    function disposeWorker() {
        if (worker) {
            worker.terminate();
            worker = null;
        }
    }

    function setMasterReadyControls(ready) {
        elRunQuery.disabled = !ready;
        elManualLookup.disabled = !ready;
        elManualCode.disabled = !ready;
        if (!ready) {
            elManualCode.value = '';
        }
    }

    function resetMasterSession() {
        setMasterReadyControls(false);
        setMasterLoading(false);
        masterIndexes = null;
        lastResults = [];
        elResultsBody.innerHTML = '';
        elResultsSection.hidden = true;
        elPrintTags.disabled = true;
    }

    function runMasterIndexFromText(text) {
        setMasterStatus('Indexing…', 'loading');
        setMasterLoading(true);

        disposeWorker();
        var w = ensureWorker();

        w.onmessage = function (ev) {
            var d = ev.data;
            if (d.type === 'progress') {
                /* spinner only — no row counts */
            } else if (d.type === 'done') {
                masterIndexes = {
                    rows: d.rows,
                    bySku: d.bySku,
                    byBarcodeStr: d.byBarcodeStr,
                    byBarcodeNum: d.byBarcodeNum,
                    byGtin: d.byGtin,
                };
                setMasterStatus('', '');
                setMasterReadyControls(true);
                setMasterLoading(false);
            }
        };

        w.onerror = function (err) {
            console.error(err);
            setMasterStatus('Worker error while indexing.', 'error');
            setMasterLoading(false);
        };

        w.postMessage({ type: 'build', text: text });
    }

    async function onPickMasterFile() {
        if (!window.showOpenFilePicker) {
            setMasterStatus(
                'This browser does not support file picking here. Try Chrome or Edge.',
                'error'
            );
            return;
        }

        resetMasterSession();
        setMasterStatus('Opening file dialog…', '');

        try {
            var handles = await window.showOpenFilePicker({
                types: [
                    {
                        description: 'Master CSV',
                        accept: {
                            'text/csv': ['.csv'],
                            'text/plain': ['.csv'],
                        },
                    },
                ],
                excludeAcceptAllOption: false,
                multiple: false,
            });

            if (!handles || !handles.length) {
                setMasterStatus('No file selected.', '');
                return;
            }

            var fh = handles[0];
            if (fh.name.toLowerCase() !== MASTER_FILENAME.toLowerCase()) {
                setMasterStatus(
                    'The file must be named exactly "' +
                        MASTER_FILENAME +
                        '". You selected: "' +
                        fh.name +
                        '".',
                    'error'
                );
                return;
            }

            var file = await fh.getFile();
            setMasterStatus('Reading ' + MASTER_FILENAME + ' (' + file.size.toLocaleString() + ' bytes)…', '');
            var text = await file.text();
            runMasterIndexFromText(text);
        } catch (err) {
            if (err && err.name === 'AbortError') {
                setMasterStatus('File selection cancelled.', '');
            } else {
                console.error(err);
                setMasterStatus(
                    err && err.message ? err.message : 'Could not read master file.',
                    'error'
                );
            }
            setMasterLoading(false);
        }
    }

    function priceCellHtml(r) {
        if (r._fetchingPrice) {
            return '<span title="Fetching price from Nahdi…">…</span>';
        }
        if (r.price === '' || r.price == null) {
            return '—';
        }
        var html = escapeHtml(String(r.price));
        if (r.priceSource === 'nahdi') {
            html +=
                ' <span class="badge badge-online" title="Price fetched from Nahdi online (master price was empty)">online</span>';
        }
        return html;
    }

    function resultRowToTr(r, rowIndex) {
        var tr = document.createElement('tr');
        if (r.status !== 'found') tr.className = 'row-miss';
        else if (r.priceSource === 'nahdi') tr.className = 'row-nahdi';
        tr.innerHTML =
            '<td class="mono">' +
            escapeHtml(r.query) +
            '</td>' +
            '<td class="mono">' +
            (r.sku ? escapeHtml(String(r.sku)) : '—') +
            '</td>' +
            '<td>' +
            escapeHtml(r.nameEn) +
            '</td>' +
            '<td dir="rtl">' +
            escapeHtml(r.nameAr) +
            '</td>' +
            '<td class="num">' +
            priceCellHtml(r) +
            '</td>' +
            '<td class="num">' +
            escapeHtml(String(r.vat)) +
            '</td>' +
            '<td class="results-col-remove">' +
            '<button type="button" class="btn-remove-row" data-row-index="' +
            rowIndex +
            '" aria-label="Remove this row">Remove</button>' +
            '</td>';
        return tr;
    }

    function removeResultAtIndex(ix) {
        if (ix < 0 || ix >= lastResults.length) {
            return;
        }
        lastResults.splice(ix, 1);
        elResultsBody.innerHTML = '';
        var i;
        for (i = 0; i < lastResults.length; i++) {
            elResultsBody.appendChild(resultRowToTr(lastResults[i], i));
        }
        updateResultsMeta();
        updatePrintTagsButton();
        if (lastResults.length === 0) {
            elResultsSection.hidden = true;
        }
    }

    function updateResultsMeta() {
        var found = 0;
        var i;
        for (i = 0; i < lastResults.length; i++) {
            if (lastResults[i].status === 'found') found++;
        }
        elResultsMeta.textContent =
            lastResults.length.toLocaleString() +
            ' rows — ' +
            found.toLocaleString() +
            ' matched';
    }

    function updatePrintTagsButton() {
        var i;
        var hasFound = false;
        for (i = 0; i < lastResults.length; i++) {
            if (lastResults[i].status === 'found') {
                hasFound = true;
                break;
            }
        }
        elPrintTags.disabled = !hasFound;
    }

    function renderResults(rows) {
        lastResults = rows;
        elResultsBody.innerHTML = '';
        var i;
        for (i = 0; i < rows.length; i++) {
            elResultsBody.appendChild(resultRowToTr(rows[i], i));
        }
        updateResultsMeta();
        updatePrintTagsButton();
        elResultsSection.hidden = false;
    }

    function appendResultRows(rows) {
        var i;
        for (i = 0; i < rows.length; i++) {
            lastResults.push(rows[i]);
            elResultsBody.appendChild(resultRowToTr(rows[i], lastResults.length - 1));
        }
        updateResultsMeta();
        updatePrintTagsButton();
        elResultsSection.hidden = false;
    }

    function updateRowTr(rowObj) {
        var i = lastResults.indexOf(rowObj);
        if (i < 0) return;
        var oldTr = elResultsBody.children[i];
        if (!oldTr) return;
        elResultsBody.replaceChild(resultRowToTr(rowObj, i), oldTr);
    }

    /**
     * Kick off (and track) a Nahdi enrichment pass. Stored on `pendingNahdi` so
     * printing can await it.
     */
    function startAutoFillNahdi() {
        pendingNahdi = autoFillNahdiData();
        return pendingNahdi;
    }

    /**
     * Enrich found rows via the Nahdi API (by SKU), with limited concurrency so
     * we never burst the endpoint:
     *   - fill the price for rows whose master price is empty, and
     *   - set `isSmart` from the item's brand (Nahdi has no brand in the master).
     * Each SKU is fetched at most once (cached in nahdi-price.js). No-op when no
     * price/brand path is available.
     */
    async function autoFillNahdiData() {
        if (!nahdiEnabled()) return;
        await loadSmartBrands(); // ensure the smart list is ready before we decide isSmart

        var targets = [];
        var i;
        for (i = 0; i < lastResults.length; i++) {
            var r = lastResults[i];
            if (r.status === 'found' && r.sku && !r._nahdiTried) {
                r._nahdiTried = true;
                r._needPrice = r.price === '' || r.price == null;
                if (r._needPrice) r._fetchingPrice = true;
                targets.push(r);
            }
        }
        if (!targets.length) return;

        for (i = 0; i < targets.length; i++) updateRowTr(targets[i]);

        var next = 0;
        var CONCURRENCY = 4;

        async function runner() {
            while (next < targets.length) {
                var row = targets[next++];
                try {
                    var obj = await fetchNahdiItem(row.sku);
                    if (obj) {
                        if (row._needPrice) {
                            var price = pickNahdiPrice(obj);
                            if (price != null) {
                                row.price = price;
                                row.priceSource = 'nahdi';
                            }
                        }
                        row.isSmart = isSmartBrand(obj.item_brand);
                    }
                } catch (err) {
                    console.error('Nahdi fetch failed for SKU', row.sku, err);
                }
                row._fetchingPrice = false;
                updateRowTr(row);
                updateResultsMeta();
                updatePrintTagsButton();
            }
        }

        var runners = [];
        var c = Math.min(CONCURRENCY, targets.length);
        for (i = 0; i < c; i++) runners.push(runner());
        await Promise.all(runners);
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function performManualLookup() {
        if (!masterIndexes) {
            setMasterStatus('Load ' + MASTER_FILENAME + ' first.', 'error');
            return;
        }

        var raw = elManualCode.value.trim();
        if (!raw) {
            return;
        }

        var vatOn = elVatInclusive.checked;
        var ix = lookupRowIndex(masterIndexes, raw);
        var one;

        if (ix < 0) {
            one = {
                query: raw,
                status: 'not_found',
                nameEn: '',
                nameAr: '',
                price: '',
                vat: '',
                sku: '',
            };
        } else {
            var row = masterIndexes.rows[ix];
            var p = priceWithVat(row, vatOn);
            one = {
                query: raw,
                status: 'found',
                nameEn: row.nameEn,
                nameAr: row.nameAr,
                price: p != null ? p : '',
                vat: row.vat,
                sku: row.sku || '',
            };
        }

        appendResultRows([one]);
        elManualCode.value = '';
        elManualCode.focus();
        startAutoFillNahdi();
    }

    function onRunQuery() {
        if (!masterIndexes) {
            setMasterStatus('Load ' + MASTER_FILENAME + ' first.', 'error');
            return;
        }

        var f = elQueryInput.files && elQueryInput.files[0];
        if (!f) {
            alert('Choose a prices file first.');
            return;
        }

        var reader = new FileReader();
        reader.onload = function () {
            var text = reader.result;
            var codes = extractQueryCodes(text);
            if (codes.length === 0) {
                alert('No codes found in the prices file.');
                return;
            }
            var vatOn = elVatInclusive.checked;
            renderResults(runLookups(codes, masterIndexes, vatOn));
            startAutoFillNahdi();
        };
        reader.readAsText(f, 'UTF-8');
    }

    async function onPrintTags() {
        try {
            // Wait for the Nahdi pass (smart-brand marks + any online prices) so
            // tags print with the black smart box resolved rather than blank.
            if (pendingNahdi) {
                var prevLabel = elPrintTags.textContent;
                elPrintTags.disabled = true;
                elPrintTags.textContent = 'Preparing…';
                try {
                    await pendingNahdi;
                } finally {
                    elPrintTags.textContent = prevLabel;
                    elPrintTags.disabled = false;
                }
            }
            await openPriceTagsPrint(lastResults);
        } catch (err) {
            console.error(err);
            setMasterStatus(
                err && err.message ? err.message : 'Could not prepare print.',
                'error'
            );
        }
    }

    var queryLabel = document.querySelector('label[for="query-file"]');

    elQueryInput.addEventListener('change', function () {
        var f = elQueryInput.files && elQueryInput.files[0];
        queryLabel.textContent = f ? f.name : 'Choose prices file';
    });

    elPickMasterFile.addEventListener('click', onPickMasterFile);
    elRunQuery.addEventListener('click', onRunQuery);
    elManualLookup.addEventListener('click', performManualLookup);
    elManualCode.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            performManualLookup();
        }
    });
    elVatInclusive.addEventListener('change', function () {
        if (!masterIndexes || lastResults.length === 0) return;
        var codes = lastResults.map(function (r) {
            return r.query;
        });
        renderResults(runLookups(codes, masterIndexes, elVatInclusive.checked));
        startAutoFillNahdi();
    });
    elPrintTags.addEventListener('click', onPrintTags);

    elResultsBody.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest && e.target.closest('.btn-remove-row');
        if (!btn || !elResultsBody.contains(btn)) {
            return;
        }
        var ix = parseInt(btn.getAttribute('data-row-index'), 10);
        if (isNaN(ix)) {
            return;
        }
        removeResultAtIndex(ix);
    });

    if (!window.showOpenFilePicker) {
        setMasterStatus('Use Chrome or Edge to load the master file.', 'error');
    }
})();
