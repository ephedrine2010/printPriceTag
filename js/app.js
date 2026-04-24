import { MASTER_FILENAME } from './config.js';
import { extractQueryCodes } from './query-processor.js';
import { runLookups } from './results-export.js';
import { lookupRowIndex, priceWithVat } from './search-logic.js';
import { openPriceTagsPrint } from './print/open-price-tags-print.js';

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

    function resultRowToTr(r, rowIndex) {
        var tr = document.createElement('tr');
        if (r.status !== 'found') tr.className = 'row-miss';
        tr.innerHTML =
            '<td class="mono">' +
            escapeHtml(r.query) +
            '</td>' +
            '<td><span class="badge ' +
            (r.status === 'found' ? 'badge-ok' : 'badge-miss') +
            '">' +
            (r.status === 'found' ? 'Found' : 'Not found') +
            '</span></td>' +
            '<td>' +
            escapeHtml(r.nameEn) +
            '</td>' +
            '<td dir="rtl">' +
            escapeHtml(r.nameAr) +
            '</td>' +
            '<td class="num">' +
            (r.price === '' ? '—' : escapeHtml(String(r.price))) +
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
            };
        }

        appendResultRows([one]);
        elManualCode.value = '';
        elManualCode.focus();
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
        };
        reader.readAsText(f, 'UTF-8');
    }

    async function onPrintTags() {
        try {
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
