# Dose calculator — overview

A second page in the same no-build app: find a medicine, enter the prescription, get the
number of packs to dispense. It is a JS rewrite of a Flutter/Dart `doseCalculator` feature
that no longer lives in this repo — its calculation rules and sources are preserved in
[legacy-calculation-rules.md](./legacy-calculation-rules.md).

Open it from the **Pages** dropdown beside the title on either page, or directly at
`dose-calculator/index.html`.

The whole flow is four steps on one screen:

```
type a name  ──▶  pick from the dropdown  ──▶  dose / frequency / days  ──▶  Calculate
(or scan)                                                                     └─▶ pack count
```

A scan skips the dropdown and lands straight on the item.

---

## 1. What replaced what

| Dart (former project) | Here |
| --- | --- |
| `models/dose_item_model.dart` | [`js/dose-item.js`](../js/dose-item.js) |
| `service/dose_calculation_service.dart` (maths) | [`js/dose-calculation-service.js`](../js/dose-calculation-service.js) |
| `service/dose_calculation_service.dart` (`searchItems`, SQLite) | [`js/imfile-store.js`](../js/imfile-store.js) |
| `cubit/dose_calculator_cubit.dart` + `cubit/dose_calculator_state.dart` | [`js/dose-app.js`](../js/dose-app.js) |
| `view/dose_calculator_home_page.dart` | [`index.html`](../index.html) + [`css/dose-calculator.css`](../css/dose-calculator.css) |
| `services/searchImage.dart` (per-SKU product images) | not carried over — the suggestion rows are text only |
| — (new) | [`js/master-source.js`](../js/master-source.js), the barcode → SKU bridge |

The C# `service/CalculateService.cs` is the *ancestor* of the Dart maths, not a separate
implementation. The rules as the old project states them are in
[legacy-calculation-rules.md](./legacy-calculation-rules.md); how they were carried into
JS, and where the two legacy versions disagree, is in
[dose-calculation-rules.md](./dose-calculation-rules.md).

---

## 2. Data contract — `imFile.csv`

[`assets/imFile.csv`](../assets/imFile.csv) is the dose list: 873 rows, the export of the
Dart app's local SQLite `imfile` table. Three things about it are easy to get wrong:

- **It is headerless, with fixed column positions** (`IM_COL` in
  [`js/dose-item.js`](../js/dose-item.js)):

  | # | Column | Notes |
  | --- | --- | --- |
  | 0 | `sku` | 9 digits, unique — doubles as the row `id` (the CSV has no `id`) |
  | 1 | `name_ar` | lost to a bad encoding (runs of `?`) — parsed, never displayed |
  | 2 | `name_en` | the field the search runs against |
  | 3 | `item_type` | `tablet` \| `antibiotic` \| `insulin` \| `drops` — picks the formula |
  | 4 | `units` | units in one pack (tablets, drops, insulin units) |
  | 5 | `unit_type` | `box` or `pen/vial` — display only |
  | 6 | `dose_frequency` | `day` or `week` — **not** a number; currently unused |
  | 7 | `note` | free text; `NULL` means empty |
  | 8 | `image_url` | parsed and kept on the model, but nothing renders it |

- **Its line endings are bare CR (`\r`)**, not CRLF or LF. The shared
  [`splitLines`](../../js/csv-utils.js) only knows `\r?\n` and would return the whole file
  as one line, so `imfile-store.js` splits on `/\r\n|\r|\n/` itself. Fields are still
  parsed with the shared `parseCSVLine` — one row (SKU `100900751`, Victoza) has a quoted
  note containing a comma.

- **`dose_frequency` is a word, not a number.** The Dart model ran
  `double.tryParse('day')`, which always yielded `0.0`; nothing ever read it. It is kept as
  text here and takes no part in the maths.

---

## 3. Search

One input, two paths, chosen automatically: **a run of six or more digits is a scan**,
anything else is a name.

### By name — the suggestion dropdown

Typing filters as you go and drops a list under the input (12 rows, name on the left, its
type and pack size on the right). Arrow keys move, Enter takes the highlighted row —
or the top one if nothing is highlighted — and Escape closes it.

`searchByName()` in [`js/imfile-store.js`](../js/imfile-store.js) is the port of the Dart
service's

```sql
SELECT * FROM imfile WHERE name_en LIKE '%<query>%' LIMIT 50
```

The **matched set is the SQL's** — the same case-insensitive substring test on `name_en`.
The **order is not**: a dropdown wants the closest names first, so hits are ranked
*starts-with* → *starts a word* → *anywhere*, with shorter names winning ties, instead of
the SQL's raw file order. Ties beyond that keep file order.

### By barcode

`imFile.csv` has no barcode column, so a scan is resolved in two steps:

```
scanned code ──▶ items.csv ──▶ sku ──▶ imFile.csv ──▶ dose item
```

A scanned code that *is* a SKU already in the dose list short-circuits the first step and
needs no master at all. Everything else needs `items.csv`; see
[barcode-to-sku.md](./barcode-to-sku.md) for how that file gets here and what each failure
message means.

Either way a resolved scan selects the item outright, so the cursor lands in the first
input field with no clicking.

---

## 4. Entering the prescription

Picking an item reveals the **Calculation details** card: the item's name and pack size on
the left, the result box on the right, and three inputs (dose, frequency, days) plus a
**Bupa rounding** toggle below.

Not every item type reads every input: insulin ignores frequency (its "dose" is already
the daily unit total) and drops ignore the dose (a drop is a drop). The page dims the
inert field, labels it *"not used"*, and pre-fills it with `1`.

The pre-fill is deliberate. The Dart cubit validates all three inputs as `> 0` whatever
the type — including the one its own formula never reads — and that validation is kept
here verbatim, error wording included:

- `Please select a medicine first`
- `Please enter a valid dose greater than 0`
- `Please enter a valid frequency greater than 0`
- `Please enter a valid number of days greater than 0`

Pre-filling the inert field satisfies that check without making the user invent a number,
and cannot change the result because the formula does not read it.

The Dart cubit hard-coded `isBupa: true`. Here it is a checkbox, defaulted to on to match,
and flipping it re-runs a result that is already on screen.

---

## 5. The result

**A number and its unit, nothing else** — `2 boxes` in the box beside the item name. No
breakdown, no detail table.

The box is dashed and grey until a calculation lands. It empties again whenever the answer
could go stale: editing any input, or typing past the picked item in the search box (which
also closes the card, so a number can never sit beside a name that is no longer selected).

Two things the number does not spell out, worth knowing when reading it:

- **Bupa rounding can legitimately produce `0`** — a course needing 0.4 of a pack rounds to
  nothing.
- **The two rounding modes can disagree by a whole pack** on the same inputs (1.20 → 1 on
  Bupa, → 2 with it off).

Both fall out of `accurateDose`; see [dose-calculation-rules.md](./dose-calculation-rules.md) §3.

---

## 6. Running it

Same constraints as the main page — see the repo's [CLAUDE.md](../../CLAUDE.md):

- **Serve over HTTP.** ES modules, a Web Worker and `fetch()` for `imFile.csv` all fail
  under `file://`.
- **Chrome or Edge** for barcode search, which needs the File System Access API. Name
  search works in any browser.
