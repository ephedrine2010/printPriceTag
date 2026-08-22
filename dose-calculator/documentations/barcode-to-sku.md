# Barcode → SKU, and how `items.csv` reaches this page

`imFile.csv` is keyed by **SKU only** — it has no barcode and no GTIN column. A scanned
barcode therefore cannot be answered from the dose list alone.

`items.csv`, the master the main lookup page already loads, has barcode, SKU **and** GTIN
on every row. So the dose calculator borrows it:

```
scanned code ──▶ items.csv (lookupRowIndex) ──▶ sku ──▶ imFile.csv (findBySku) ──▶ dose item
```

All of this lives in [`js/master-source.js`](../js/master-source.js).

---

## 1. Resolution is the shared code, not a copy of it

The master is indexed by the **same worker** the main page uses
([`js/master-worker.js`](../../js/master-worker.js)) and codes are resolved by the **same
function** ([`lookupRowIndex`](../../js/search-logic.js)). Nothing about the length-based
barcode rules is reimplemented here, so a code that resolves on the price page resolves
identically on this one.

That means the master's data contract applies unchanged: exactly `items.csv` by name,
headerless, `COL` positions from [`js/config.js`](../../js/config.js), rows with fewer than
10 columns skipped.

Only the SKU is taken from the matched row. Prices, VAT and the Nahdi enrichment are the
price page's business and play no part here.

---

## 2. Getting the file here without asking for it twice

The File System Access API returns a `FileSystemFileHandle`, and a handle **survives a
structured clone** — so it can be parked in IndexedDB and read back on another page of the
same origin. That is the whole mechanism:

| Where | What happens |
| --- | --- |
| Main page, `onPickMasterFile` | on a successful read, `saveMasterHandle(fh)` stores the handle |
| Dose page, on load | `restoreMaster()` reads it back and re-reads the file **if permission is still granted** |
| Dose page, "Use it now" | `requestStoredMaster()` — same, but asks for permission first |
| Dose page, "Choose items.csv…" | `pickMaster()` — picks the file here, and stores the handle for the main page too |

The store is [`js/master-handle-store.js`](../../js/master-handle-store.js) (database
`web-print-prices`, object store `handles`, key `master-file`). Every function in it fails
soft: no IndexedDB, or no stored handle, just means "no remembered master file".

**The file itself is never copied.** Nothing is cached in IndexedDB, `localStorage` or
anywhere else — only the handle, which is a pointer. The master is re-read and re-indexed
from disk on each page load, so this page can never serve a stale price list.

### Why permission sometimes needs a click

Chrome keeps the read grant for a while, but not forever, and `requestPermission()` throws
outside a user gesture. So the page never prompts on load: `restoreMaster()` only calls
`queryPermission()` and reports one of three states, which the status line under the
search box renders:

| State | Line shown | Buttons |
| --- | --- | --- |
| `loaded` | `items.csv loaded — barcode search is on.` | — |
| `needs-permission` | `items.csv is remembered from the main page.` | **Use it now**, **Choose items.csv…** |
| `none` | `No items.csv — name search works, barcode search needs it.` | **Choose items.csv…** |

Loading the master from either button re-resolves a code still sitting in the search box,
so a scan that arrived before the file did needs no re-scan.

A handle whose file has since been moved, renamed or deleted throws on read; that clears
the stored handle and drops the page back to `none`.

---

## 3. The lookup order, and what each miss means

`searchCode()` in [`js/dose-app.js`](../js/dose-app.js):

1. **`findBySku(code)`** — the code *is* a SKU in the dose list. Common, since SKUs are
   scannable, and it needs no master at all.
2. **`masterLookup(code)`** → SKU → `findBySku(sku)`.

Each way it can fail says something different, because the fixes are different:

| Message | Meaning |
| --- | --- |
| `Barcode search needs items.csv — load it below.` | no master, and the code is not a dose-list SKU |
| `No item in items.csv matches "…"` | the master does not know this barcode (or its row has no SKU) |
| `"<name>" is not in the dose list.` | a real product, but **no dose rules exist for it** — it needs adding to `imFile.csv` |

That last one is the useful one: it names the product, so it is clear the scan worked and
the gap is in the dose list, not the scanner. A successful scan says nothing at all — it
just selects the item.

---

## 4. Leading zeros

`findBySku` retries with leading zeros stripped, so a scanner that pads `100012594` to
`0100012594` still lands on the right row. The master side needs no such help —
`lookupRowIndex` already switches index by code length and parses numerically.
