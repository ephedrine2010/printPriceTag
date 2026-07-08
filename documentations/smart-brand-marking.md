# Smart-brand marking on printed tags

Some printed price tags carry a small **solid black square** — the "smart" mark.
An item gets this mark when **its brand is on a curated list** of smart brands.
This document explains where the mark comes from, how a brand is discovered, how a
match is decided, and the decisions baked into it.

---

## 1. What the mark is

The Dart-identical print shell ([`js/print/dart-print-shell.html`](../js/print/dart-print-shell.html))
renders the square from a per-item flag, in two places (large and small tag layouts):

```html
<span style="… visibility: ${item.is_smart ? 'visible' : 'hidden'};">&#x25A0;</span>
```

So printing a smart mark is entirely a matter of setting `is_smart: true` on the item
object handed to the shell. The shell itself is **frozen** (a verbatim copy of the legacy
Dart page) — we never edit it; we only feed it the right flag.

---

## 2. The one obstacle: the master has no brand

`items.csv` has no brand column (columns are barcode, sku, name_en, name_ar, price,
gtin, vat — see [`js/config.js`](../js/config.js)). So the app **cannot** know an item's
brand from the master alone.

The brand instead comes from the **Nahdi product API**, which returns an `item_brand`
field keyed by SKU. This is the same API already used for the
[price fallback](./nahdi-price-fallback.md) — we reuse its per-SKU fetch and cache.

```
found item (has SKU)  ──▶  Nahdi API  ──▶  item_brand  ──▶  in smart list?  ──▶  is_smart
```

---

## 3. The smart list

- **File:** [`assets/SL-updates.csv`](../assets/SL-updates.csv)
- **Format:** one brand per line, single column (no header, no commas). Blank lines are
  ignored. To add or remove a smart brand, edit this file — nothing else.

It is loaded once at runtime by [`js/smart-brands.js`](../js/smart-brands.js) via `fetch()`
and indexed into a set of normalized keys.

---

## 4. Matching rule — "normalized exact"

Brand spellings are inconsistent on both sides (`LOccitane` vs `L'Occitane`,
`Nature'S Bounty` vs `Nature's Bounty`, `Holland & Barrett`, `R+Co`). To make them agree
without risking false matches, both the list entry and the Nahdi brand are **normalized**
and then compared for **whole-string equality**:

```js
// js/smart-brands.js
normalizeBrand(s) = String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
```

i.e. lowercase and **drop every non-alphanumeric character** (spaces, apostrophes,
hyphens, ampersands, `+`, …). Examples that then match:

| Nahdi `item_brand` | normalized | matches list entry |
|---|---|---|
| `L'Occitane` | `loccitane` | `LOccitane` |
| `Nature's Bounty` | `naturesbounty` | `Nature'S Bounty` |
| `Holland & Barrett` | `hollandbarrett` | `Holland & Barrett` |
| `R+Co` | `rco` | `R+Co` |
| `Panadol` | `panadol` | *(not in list → no mark)* |

Stripping rather than merely collapsing punctuation is deliberate — it is what lets the
apostrophe/space variants above line up. It is still "exact" in that the **whole** brand
must equal a list entry; a brand is not matched by being a substring of a longer name.

---

## 5. Runtime behavior

After every lookup (query file, manual entry, or VAT re-run), `autoFillNahdiData()` in
[`js/app.js`](../js/app.js):

1. Collects **all found rows that have a SKU** and were not tried yet.
   > Note this is wider than the price fallback, which only fetches rows with an *empty*
   > price. To mark every smart item we need the brand of every item, so the brand pass
   > covers all found rows. Each SKU is still fetched **at most once** (shared cache in
   > [`js/nahdi-price.js`](../js/nahdi-price.js)), with **max 4 concurrent** requests.
2. For each fetched item: fills the price if the master price was empty (unchanged
   behavior), **and** sets `row.isSmart = isSmartBrand(item_brand)`.
3. [`js/print/open-price-tags-print.js`](../js/print/open-price-tags-print.js) copies
   `row.isSmart` into the item's `is_smart`, which the print shell renders as the square.

### Printing waits for the brand pass

The brand fetch runs in the background. If you press **Print tags** while it is still
running, the button shows `Preparing…` and the app **awaits the in-flight pass** before
building the sheet — so tags print with the smart squares resolved rather than blank.

---

## 6. Price vs. brand — one fetch, two uses

The brand feature is layered onto the existing Nahdi price fallback and shares its plumbing:

- [`js/nahdi-price.js`](../js/nahdi-price.js) now exposes `fetchNahdiItem(sku)`, which
  fetches and **caches the whole product object**. `fetchNahdiPrice()` (price) and the
  brand lookup both read from that one cached object, so enabling smart marking does **not**
  double the requests for an item that also needs a price.

---

## 7. Files

| File | Role |
|---|---|
| [`assets/SL-updates.csv`](../assets/SL-updates.csv) | The smart-brand list (edit to add/remove brands) |
| [`js/smart-brands.js`](../js/smart-brands.js) | Loads/indexes the list; `normalizeBrand()`, `loadSmartBrands()`, `isSmartBrand()` |
| [`js/nahdi-price.js`](../js/nahdi-price.js) | `fetchNahdiItem()` (full object + per-SKU cache), `fetchNahdiPrice()`, `fetchNahdiBrand()` |
| [`js/app.js`](../js/app.js) | `autoFillNahdiData()` sets `row.isSmart`; print awaits the pass |
| [`js/print/open-price-tags-print.js`](../js/print/open-price-tags-print.js) | Maps `row.isSmart` → item `is_smart` |
| [`js/print/dart-print-shell.html`](../js/print/dart-print-shell.html) | Frozen shell that renders the square from `is_smart` |

---

## 8. Notes & limits

- **Depends on the Nahdi API.** Brand discovery uses the same CORS-proxied Nahdi endpoint
  as the price fallback (see [nahdi-price-fallback.md](./nahdi-price-fallback.md)). If those
  proxies are down or a SKU is unknown to Nahdi, the brand cannot be resolved and the item
  is **not** marked smart (fail-safe: no false squares).
- **Items with no SKU are never marked** — there is no brand source for them.
- **More API calls than price-only.** Marking requires a Nahdi call for every found item
  with a SKU, not just empty-price ones. Calls are capped at 4 concurrent and cached per
  SKU, but a large query file means many requests.
- **Matching is exact after normalization.** A brand whose Nahdi spelling normalizes to
  something not present in `SL-updates.csv` will be missed. The fix is to add that spelling
  to the list — matching is intentionally strict to avoid marking the wrong items.
