# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A client-side, no-build web app that looks up product prices from a large master CSV
(`items.csv`) and prints price tags. All logic runs in the browser — there is no
backend, no package.json, and no dependencies to install. The print sheet is the only
part that pulls third-party libraries (Bootstrap, jQuery, JsBarcode), and it loads them
from CDNs at print time.

## Running / developing

- **Serve over HTTP** — do not open `index.html` via `file://`. The app uses ES modules,
  a Web Worker (`js/master-worker.js`), and `fetch()` for the print shell, all of which
  fail under `file://`. Any static server works, e.g. `python -m http.server` from the
  repo root, then open the served `index.html`.
- **Chrome or Edge required.** Master-file loading uses the File System Access API
  (`window.showOpenFilePicker`); the app shows an error banner in browsers without it.
- There is no build, lint, or test tooling in this repo.

## Data contracts (easy to get wrong)

- The master file **must be named exactly `items.csv`** — `onPickMasterFile` in
  [js/app.js](js/app.js) rejects any other filename.
- `items.csv` is **headerless** with fixed column positions defined in
  [js/config.js](js/config.js) (`COL`): barcode=0, sku=1, name_en=2, name_ar=3,
  price=4, gtin=7, vat=9. Rows with fewer than `MASTER_MIN_COLS` (10) columns are skipped.
- The **query/prices file** is a separate CSV. `extractQueryCodes` in
  [js/query-processor.js](js/query-processor.js) reads the **second column** as the lookup
  code when a row has ≥2 columns, otherwise the first — a format like `1-TAG,<code>,1`.

## Architecture

The flow is: load master → build indexes in a worker → look up codes → render results →
print matched rows.

1. **Master indexing (off main thread).** [js/app.js](js/app.js) reads `items.csv` text
   and posts it to [js/master-worker.js](js/master-worker.js), which parses every line and
   builds four lookup maps returned to the main thread: `bySku`, `byBarcodeStr`,
   `byBarcodeNum`, `byGtin`, plus a `rows` array of `{nameEn, nameAr, itemPrice, vat}`.
   The worker is recreated per load (`disposeWorker` → `ensureWorker`).

2. **Code resolution.** [js/search-logic.js](js/search-logic.js) `lookupRowIndex`
   picks which index to consult **based on the code's length** (9 → SKU then barcode,
   <9 → barcode, 10–13 → barcode then GTIN, >13 → GTIN). `extractBarcode` truncates
   codes longer than 16 chars to `substring(2,16)`. This length-based logic is ported
   verbatim from a legacy Dart app's `database.js` — preserve its behavior when editing.

3. **Pricing.** `priceWithVat` in [js/search-logic.js](js/search-logic.js) applies
   `(vat+100)/100` when VAT-inclusive pricing is on. The VAT toggle
   (`#chk-vat-inclusive`, currently hidden in [index.html](index.html)) re-runs lookups
   over the existing result queries on change.

4. **Results.** [js/results-export.js](js/results-export.js) `runLookups` maps codes to
   result rows (`status: 'found' | 'not_found'`). [js/app.js](js/app.js) owns the
   `lastResults` array and renders the table, including per-row removal and a running
   found-count. Manual single-code lookups (`#manual-code`) append one row at a time.

5. **Printing.** [js/print/open-price-tags-print.js](js/print/open-price-tags-print.js)
   filters to `status === 'found'`, converts each row to a Dart-style item object,
   fetches [js/print/dart-print-shell.html](js/print/dart-print-shell.html) as a template,
   substitutes `__ITEMS_JSON__` and `__RIYAL_JSON__` (a data-URL of `assets/riyal.png`),
   and writes the result into a `window.open()` popup. The shell is a **verbatim copy of a
   legacy Dart print page** (`printhtmlpage.dart`) that renders barcodes with JsBarcode —
   treat it as frozen output; changing it means diverging from the reference layout.

   The shell's `is_smart` flag (a small black "smart" square on the tag) is populated
   dynamically: an item's brand is fetched from the Nahdi API (the master has no brand
   column) and matched against the curated list in `assets/SL-updates.csv`. See
   [documentations/smart-brand-marking.md](documentations/smart-brand-marking.md).

## Editing conventions

- Keep the ported logic (barcode length rules, print shell) faithful to its Dart origin
  rather than "cleaning it up" — matching the legacy system's output is the point.
- Core lookup/parse modules (`csv-utils`, `config`, `search-logic`, `results-export`) are
  plain ES modules and are shared by both the main thread and the worker; avoid adding
  DOM or browser-only dependencies to them.
