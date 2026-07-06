# Price fallback via the Nahdi API

When an item is **found in the master but its price cell is empty**, the app looks the
price up online from the Nahdi product API (by SKU) and fills it in automatically.
This document explains what it does, why it is built the way it is, how to enable it,
and the decisions baked into it.

---

## 1. Why this exists

`items.csv` has many rows with a name but **no price**. Before this feature such items
were still treated as *found*, showed a `—` in the price column, and — worse — were
**included on the printed sheet as blank-price tags** (only the SAR icon, no number).

The old Dart scanner app solved the same problem in `scannerSearchMethods.dart`
(`startScrap()`), which fetched prices from the Nahdi website API. This feature ports
that idea to the web app.

---

## 2. The one obstacle: CORS

The Nahdi endpoint replies with a **fixed** header:

```
Access-Control-Allow-Origin: https://www.nahdionline.com
```

It does **not** reflect the caller's origin. So a browser page on any other origin
(GitHub Pages, `localhost`, …) is blocked by the browser from reading the response —
even though the request itself succeeds. This was verified by sending a `github.io`
`Origin`; the server still returned the fixed value above.

The old Dart app never hit this because native HTTP clients (Dio) ignore CORS entirely.
A browser `fetch()` cannot.

> **Postman / curl / the address bar all "work" — those bypass CORS.**
> The only case that is blocked is a browser page making `fetch()`, which is exactly
> what our app does.

### Solution: a tiny server-side proxy

A **Cloudflare Worker** ([`nahdi-proxy-worker.js`](../nahdi-proxy-worker.js)) sits between
the app and Nahdi. It runs server-side (no CORS there), forwards the request, and
re-serves the JSON with `Access-Control-Allow-Origin: *`.

```
GitHub Pages app  ──fetch──▶  your Worker  ──▶  Nahdi API
                  ◀── JSON + Access-Control-Allow-Origin: * ──
```

The Worker also sends a browser `User-Agent`, which is **required** — Nahdi's CloudFront
WAF returns `403` to requests without one.

---

## 3. Enabling the feature

1. **Deploy the Worker** (once):
   - Cloudflare dashboard → *Workers & Pages* → *Create Worker*
   - Paste [`nahdi-proxy-worker.js`](../nahdi-proxy-worker.js), Deploy.
   - You get a URL like `https://nahdi-proxy.<you>.workers.dev`.
   - Sanity check in a browser: `https://nahdi-proxy.<you>.workers.dev/?skus=100015980`
     should return a JSON array.
2. **Point the app at it:** set `NAHDI_PROXY_BASE` at the top of
   [`js/nahdi-price.js`](../js/nahdi-price.js):
   ```js
   export const NAHDI_PROXY_BASE = 'https://nahdi-proxy.you.workers.dev';
   ```

While `NAHDI_PROXY_BASE` is empty the feature is a **silent no-op** — the app behaves
exactly as before (empty prices stay `—`).

---

## 4. The API

**Endpoint**

```
GET https://www.nahdionline.com/api/analytics/product
    ?skus=<SKU>&language=en&region=SA&category_id=15125
```

- Keyed by **SKU** (`skus=`). Requires a browser `User-Agent`.
- Returns a JSON **array**; the item is the first element.

**Sample response** (SKU `100015980`, trimmed):

```json
[{
  "item_id": "100015980",
  "item_name": "Panadol Extra Tablet 24 pcs",
  "shelf_price": 8,
  "price": 8,
  "item_brand": "Panadol",
  "item_image_link": "https://ecombe.nahdionline.com/media/.../100015980_....png",
  "imf_division": "MEDICINE"
}]
```

Fields we use: **`price`**, **`shelf_price`** (both VAT-inclusive retail).

---

## 5. Price selection (ported from Dart lines 195–212)

The Dart `startScrap()` chose the tag price with this logic:

| Dart condition | Result |
|---|---|
| `shelf_price == price` | use `price` |
| `price > shelf_price` **and** `price == master_price` | `addVat(price)` |
| `price > shelf_price` **and** `price != master_price` | use `price` |
| `shelf_price > price` **and** `shelf_price == master_price` | `addVat(shelf_price)` |
| `shelf_price > price` **and** `shelf_price != master_price` | use `shelf_price` |

The two `addVat(...)` branches only fire when the site price coincides with the
**local master price** — a signal the site returned a VAT-*exclusive* figure.

**In our case the master price is empty** (that is the trigger), so those branches can
never fire. The logic reduces to:

- `price == shelf_price` → that value
- otherwise → **the higher** of the two.

That is exactly [`pickNahdiPrice()`](../js/nahdi-price.js): `price > shelf ? price : shelf`.
Nahdi prices are already VAT-inclusive, so the app's VAT toggle is **not** re-applied to
a fetched price.

### ⚠️ Open decision — discounted items

When `price` (current/selling) is **lower** than `shelf_price` (regular), the ported
logic prints the **higher, regular shelf price** — not the discounted one. This matches
the legacy behavior and is defensible for a physical shelf tag. If you would rather print
the actual (lower) selling price, change one line in `pickNahdiPrice()`.

---

## 6. Runtime behavior

After every lookup (query file, manual entry, or VAT re-run),
`autoFillMissingPrices()` in [`js/app.js`](../js/app.js):

1. Collects found rows with an empty price **and** a SKU that were not tried yet.
2. Shows `…` in each of their price cells.
3. Fetches them through the proxy with **max 4 concurrent** requests (never bursts the
   endpoint), **caching per SKU** so a SKU is fetched at most once.
4. Fills the price and marks the row as it resolves; a SKU with no price stays `—`.

---

## 7. Marking API-sourced items

Rows whose price came from Nahdi (`priceSource === 'nahdi'`) are marked in the results
table three ways:

- a blue **`online`** badge next to the price (distinct from the green *Found* badge);
- a subtle **blue row tint** (`.row-nahdi`);
- the fetched **price rendered bold**.

While fetching, the price cell shows `…`.

> The **results table now shows a `SKU` column in place of the old `Status` column.**
> Found vs. not-found is still conveyed by the muted `row-miss` styling on misses.

Printed tags are **not** marked (the print shell is kept frozen / identical to the Dart
reference).

---

## 8. Files

| File | Role |
|---|---|
| [`nahdi-proxy-worker.js`](../nahdi-proxy-worker.js) | Cloudflare Worker CORS proxy (deploy this) |
| [`js/nahdi-price.js`](../js/nahdi-price.js) | `NAHDI_PROXY_BASE` config, `fetchNahdiPrice()`, `pickNahdiPrice()`, per-SKU cache |
| [`js/master-worker.js`](../js/master-worker.js) | now stores `sku` on each master row |
| [`js/results-export.js`](../js/results-export.js) | carries `sku` through lookup results |
| [`js/app.js`](../js/app.js) | `autoFillMissingPrices()` orchestration, row rendering, SKU column |
| [`css/styles.css`](../css/styles.css) | `.badge-online`, `.row-nahdi` styles |
| [`test-nahdi.html`](../test-nahdi.html) | throwaway page to probe the API / CORS from a browser |

---

## 9. Notes & limits

- **Batching** (`skus=a,b,c`) is unconfirmed — the API might return only the first match.
  Current code fetches **one SKU per request**. If batching is confirmed later, the proxy
  already forwards a comma-separated `skus`, so only the app-side loop needs changing.
- Rows with **no SKU** or a SKU that Nahdi does not know stay `—` and, if printed, still
  render a blank-price tag. If that is undesirable, exclude still-empty found rows from
  printing.
- The feature depends on an external service; if Nahdi changes the endpoint, WAF rules,
  or response shape, `pickNahdiPrice()` and the Worker are the two places to adjust.
