/**
 * Dose calculator page controller.
 *
 * Replaces the legacy Dart `DoseCalculatorCubit` + `DoseCalculatorHomePage` pair with
 * plain DOM wiring, in the same style as the main app's [js/app.js](../../js/app.js).
 *
 * Flow: type a name (or scan a barcode) -> pick from the suggestion list ->
 * enter dose / frequency / days -> the pack count lands in the box beside the name.
 */

import { loadImFile, searchByName, findBySku } from './imfile-store.js';
import { calculate, inputsUsedBy } from './dose-calculation-service.js';
import {
    restoreMaster,
    requestStoredMaster,
    pickMaster,
    masterLookup,
    masterReady,
    filePickerSupported,
} from './master-source.js';

(function () {
    /** Suggestions shown at once — a dropdown, not a results page. */
    const SUGGEST_LIMIT = 12;

    const elSearch = document.getElementById('dose-search');
    const elSuggest = document.getElementById('dose-suggest');
    const elSearchStatus = document.getElementById('search-status');

    const elMasterDot = document.getElementById('master-dot');
    const elMasterState = document.getElementById('master-state');
    const elUseMaster = document.getElementById('btn-use-master');
    const elPickMaster = document.getElementById('btn-pick-master');

    const elInputsCard = document.getElementById('inputs-card');
    const elSelectedName = document.getElementById('selected-name');
    const elSelectedMeta = document.getElementById('selected-meta');
    const elResultBox = document.getElementById('result-box');
    const elResultNumber = document.getElementById('result-number');
    const elResultUnit = document.getElementById('result-unit');

    const elDose = document.getElementById('in-dose');
    const elFrequency = document.getElementById('in-frequency');
    const elDays = document.getElementById('in-days');
    const elBupa = document.getElementById('chk-bupa');
    const elCalculate = document.getElementById('btn-calculate');
    const elCalcError = document.getElementById('calc-error');

    const FIELDS = { dose: elDose, frequency: elFrequency, days: elDays };

    /** Items in the open dropdown. */
    let suggestions = [];
    /** Keyboard-highlighted row, or -1. */
    let activeIndex = -1;
    /** The picked item, or null. */
    let selected = null;

    // ---------------------------------------------------------------- helpers

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function setSearchStatus(text, kind) {
        elSearchStatus.hidden = !text;
        elSearchStatus.textContent = text || '';
        elSearchStatus.className = 'status-pill ' + (kind || '');
    }

    function setCalcError(text) {
        elCalcError.hidden = !text;
        elCalcError.textContent = text || '';
    }

    /** Trim trailing zeros so 1.50 reads as 1.5 and 30.00 as 30. */
    function tidyNumber(n) {
        if (!isFinite(n)) return '0';
        return String(parseFloat(n.toFixed(2)));
    }

    function unitLabel(unitType, n) {
        const u = String(unitType || 'pack').toLowerCase();
        if (u === 'box') return n === 1 ? 'box' : 'boxes';
        if (u === 'pen/vial') return n === 1 ? 'pen / vial' : 'pen / vials';
        return n === 1 ? u : u + 's';
    }

    function itemMeta(item) {
        return (
            (item.itemType || 'unknown') +
            ' · ' +
            tidyNumber(item.units) +
            ' per ' +
            (item.unitType || 'pack')
        );
    }

    // ----------------------------------------------------- items.csv (master)

    function renderMasterState(state, detail) {
        elUseMaster.hidden = true;
        elPickMaster.hidden = true;
        elMasterDot.className = 'master-dot master-dot--' + state;

        if (state === 'ready') {
            elMasterState.textContent =
                'items.csv loaded — barcode search is on.';
            return;
        }

        if (state === 'busy') {
            elMasterState.textContent = detail || 'Loading items.csv…';
            return;
        }

        if (state === 'needs-permission') {
            elMasterState.textContent =
                detail || 'items.csv is remembered from the main page.';
            elUseMaster.hidden = false;
            elPickMaster.hidden = !filePickerSupported();
            return;
        }

        // 'none'
        elMasterState.textContent =
            detail || 'No items.csv — name search works, barcode search needs it.';
        elPickMaster.hidden = !filePickerSupported();
    }

    async function initMaster() {
        if (!filePickerSupported()) {
            renderMasterState(
                'none',
                'This browser cannot read items.csv (Chrome or Edge is needed) — name search still works.'
            );
            return;
        }

        renderMasterState('busy', 'Checking for a remembered items.csv…');
        let state = 'none';
        try {
            state = await restoreMaster();
        } catch (err) {
            console.warn(err);
        }

        if (state === 'loaded') renderMasterState('ready');
        else renderMasterState(state === 'needs-permission' ? 'needs-permission' : 'none');
    }

    async function withMasterLoad(run) {
        renderMasterState('busy', 'Reading items.csv…');
        try {
            await run();
            renderMasterState('ready');
            setSearchStatus('');
            // A barcode the user already typed can now be resolved.
            const pending = elSearch.value.trim();
            if (pending && looksLikeCode(pending)) searchCode(pending);
        } catch (err) {
            console.error(err);
            if (err && err.name === 'AbortError') {
                renderMasterState('none', 'File selection cancelled.');
            } else {
                renderMasterState(
                    'none',
                    err && err.message ? err.message : 'Could not load items.csv.'
                );
            }
        }
    }

    // ------------------------------------------------------- suggestion list

    /** A run of six or more digits is a scan, not a name. */
    function looksLikeCode(query) {
        return /^\d{6,}$/.test(query);
    }

    function closeSuggest() {
        elSuggest.hidden = true;
        elSuggest.innerHTML = '';
        elSearch.setAttribute('aria-expanded', 'false');
        elSearch.removeAttribute('aria-activedescendant');
        suggestions = [];
        activeIndex = -1;
    }

    function markActive() {
        const rows = elSuggest.querySelectorAll('.suggest-item');
        for (let i = 0; i < rows.length; i++) {
            const on = i === activeIndex;
            rows[i].classList.toggle('is-active', on);
            rows[i].setAttribute('aria-selected', on ? 'true' : 'false');
            if (on) {
                elSearch.setAttribute('aria-activedescendant', rows[i].id);
                rows[i].scrollIntoView({ block: 'nearest' });
            }
        }
        if (activeIndex < 0) elSearch.removeAttribute('aria-activedescendant');
    }

    function openSuggest(items) {
        suggestions = items;
        activeIndex = -1;
        elSuggest.innerHTML = '';

        if (!items.length) {
            elSuggest.innerHTML = '<li class="suggest-empty">No match</li>';
        } else {
            for (let i = 0; i < items.length; i++) {
                const li = document.createElement('li');
                li.className = 'suggest-item';
                li.id = 'suggest-' + i;
                li.setAttribute('role', 'option');
                li.setAttribute('aria-selected', 'false');
                li.dataset.index = String(i);
                li.innerHTML =
                    '<span class="suggest-name">' + escapeHtml(items[i].nameEn) + '</span>' +
                    '<span class="suggest-meta">' + escapeHtml(itemMeta(items[i])) + '</span>';
                elSuggest.appendChild(li);
            }
        }

        elSuggest.hidden = false;
        elSearch.setAttribute('aria-expanded', 'true');
    }

    function onSearchInput() {
        const query = elSearch.value.trim();
        setSearchStatus('');

        // Typing past the picked item drops it, so the result box can never show
        // a number that belongs to a name no longer in the search box.
        if (selected && query !== selected.nameEn) clearSelection();

        if (!query || looksLikeCode(query)) {
            closeSuggest();
            return;
        }
        openSuggest(searchByName(query, SUGGEST_LIMIT));
    }

    /** Enter: take the highlighted suggestion, else resolve a scan, else the top hit. */
    function commitSearch() {
        if (activeIndex >= 0 && suggestions[activeIndex]) {
            selectItem(suggestions[activeIndex]);
            return;
        }

        const query = elSearch.value.trim();
        if (!query) return;

        if (looksLikeCode(query)) {
            searchCode(query);
            return;
        }
        if (suggestions.length) selectItem(suggestions[0]);
    }

    // --------------------------------------------------------- barcode / SKU

    function searchCode(code) {
        closeSuggest();

        // The dose list is keyed by SKU, so a scanned SKU needs no master at all.
        const direct = findBySku(code);
        if (direct) {
            setSearchStatus('');
            selectItem(direct);
            return;
        }

        if (!masterReady()) {
            setSearchStatus('Barcode search needs items.csv — load it below.', 'error');
            return;
        }

        const hit = masterLookup(code);
        if (!hit || !hit.sku) {
            setSearchStatus('No item in items.csv matches "' + code + '".', 'error');
            return;
        }

        const item = findBySku(hit.sku);
        if (!item) {
            setSearchStatus(
                '"' + (hit.nameEn || code) + '" is not in the dose list.',
                'error'
            );
            return;
        }

        setSearchStatus('');
        selectItem(item);
    }

    // ------------------------------------------------------------- selection

    /**
     * Mark the inputs an item's formula ignores, and pre-fill them with 1.
     *
     * The Dart cubit validates all three inputs as "> 0" whatever the item type,
     * even the one its formula never reads — pre-filling keeps that validation
     * intact without making the user invent a number.
     */
    function applyFieldUsage(item) {
        const used = inputsUsedBy(item.itemType);
        const names = ['dose', 'frequency', 'days'];
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const input = FIELDS[name];
            const wrap = document.querySelector('.field[data-field="' + name + '"]');
            const note = wrap ? wrap.querySelector('.field-note') : null;
            if (used[name]) {
                if (wrap) wrap.classList.remove('is-unused');
                if (note) note.textContent = '';
            } else {
                if (wrap) wrap.classList.add('is-unused');
                if (note) note.textContent = 'not used';
                if (!input.value) input.value = '1';
            }
        }
    }

    function clearResult() {
        elResultBox.dataset.empty = 'true';
        elResultNumber.textContent = '—';
        elResultUnit.textContent = '';
    }

    function clearSelection() {
        selected = null;
        elInputsCard.hidden = true;
        elDose.value = '';
        elFrequency.value = '';
        elDays.value = '';
        setCalcError('');
        clearResult();
    }

    function selectItem(item) {
        selected = item;
        closeSuggest();
        setCalcError('');
        clearResult();

        elSearch.value = item.nameEn;
        elSelectedName.textContent = item.nameEn;
        elSelectedMeta.textContent = itemMeta(item) + (item.note ? ' · ' + item.note : '');

        applyFieldUsage(item);
        elInputsCard.hidden = false;

        const used = inputsUsedBy(item.itemType);
        const first = used.dose ? elDose : used.frequency ? elFrequency : elDays;
        first.focus();
        first.select();
    }

    // ------------------------------------------------------------ calculating

    function doCalculate() {
        // Same guards, and the same wording, as DoseCalculatorCubit.calculateDose.
        if (!selected) {
            setCalcError('Please select a medicine first');
            return;
        }

        const dose = parseFloat(elDose.value);
        const frequency = parseFloat(elFrequency.value);
        const days = parseFloat(elDays.value);

        if (isNaN(dose) || dose <= 0) {
            setCalcError('Please enter a valid dose greater than 0');
            return;
        }
        if (isNaN(frequency) || frequency <= 0) {
            setCalcError('Please enter a valid frequency greater than 0');
            return;
        }
        if (isNaN(days) || days <= 0) {
            setCalcError('Please enter a valid number of days greater than 0');
            return;
        }

        setCalcError('');

        const packs = calculate(selected, dose, frequency, days, elBupa.checked);
        elResultBox.dataset.empty = 'false';
        elResultNumber.textContent = String(packs);
        elResultUnit.textContent = unitLabel(selected.unitType, packs);
    }

    // ---------------------------------------------------------------- wiring

    elSearch.addEventListener('input', onSearchInput);

    elSearch.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!suggestions.length) return;
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            activeIndex = (activeIndex + step + suggestions.length + 1) % (suggestions.length + 1);
            if (activeIndex === suggestions.length) activeIndex = -1;
            markActive();
            return;
        }
        if (e.key === 'Enter') {
            // Barcode scanners type the code then send Enter.
            e.preventDefault();
            commitSearch();
            return;
        }
        if (e.key === 'Escape') {
            closeSuggest();
        }
    });

    elSearch.addEventListener('focus', function () {
        const query = elSearch.value.trim();
        if (query && !looksLikeCode(query) && !selected) onSearchInput();
    });

    // mousedown, not click — the input blurs before a click lands.
    elSuggest.addEventListener('mousedown', function (e) {
        const li = e.target && e.target.closest && e.target.closest('.suggest-item');
        if (!li) return;
        e.preventDefault();
        const ix = parseInt(li.dataset.index, 10);
        if (!isNaN(ix) && suggestions[ix]) selectItem(suggestions[ix]);
    });

    document.addEventListener('click', function (e) {
        if (!elSuggest.hidden && !elSearch.contains(e.target) && !elSuggest.contains(e.target)) {
            closeSuggest();
        }
    });

    elCalculate.addEventListener('click', doCalculate);

    [elDose, elFrequency, elDays].forEach(function (input) {
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                doCalculate();
            }
        });
        input.addEventListener('input', clearResult);
    });

    elBupa.addEventListener('change', function () {
        // Keep a shown result honest when the rounding rule changes under it.
        if (elResultBox.dataset.empty === 'false') doCalculate();
    });

    elUseMaster.addEventListener('click', function () {
        withMasterLoad(requestStoredMaster);
    });

    elPickMaster.addEventListener('click', function () {
        withMasterLoad(pickMaster);
    });

    // ------------------------------------------------------------------ boot

    elSearch.disabled = true;
    setSearchStatus('Loading the dose list…', 'loading');

    loadImFile().then(
        function (count) {
            elSearch.disabled = false;
            setSearchStatus('');
            elSearch.placeholder =
                'Search ' + count.toLocaleString() + ' medicines, or scan a barcode';
            elSearch.focus();
        },
        function (err) {
            console.error(err);
            setSearchStatus(
                err && err.message
                    ? err.message
                    : 'Could not load the dose list (assets/imFile.csv).',
                'error'
            );
        }
    );

    initMaster();
})();
