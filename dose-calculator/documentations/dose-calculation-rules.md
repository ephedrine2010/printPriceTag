# Dose calculation rules

Everything the calculator computes lives in
[`js/dose-calculation-service.js`](../js/dose-calculation-service.js). It is a **faithful
port**, not a re-derivation: the same convention that governs the barcode length rules and
the print shell on the main page applies here — matching the legacy system's numbers is
the point, so the odd-looking bits stay.

Two ancestors, in order:

1. `CalculateService.cs` — the original C#.
2. `dose_calculation_service.dart` — the Dart port, which is what the app actually ran.

Neither is in this repo any more; both are reproduced verbatim in the appendix of
[legacy-calculation-rules.md](./legacy-calculation-rules.md).

**The Dart version is the reference implementation here.** Where the two disagree, the
divergences are listed in §5.

> For the rules stated purely as the *old project* has them — the legacy Dart and C#
> quoted, with no reference to this rewrite — see
> [legacy-calculation-rules.md](./legacy-calculation-rules.md). This document is the
> port's side of the same story: what was carried over, and what was deliberately not
> fixed.

---

## 1. The shape of a calculation

```
raw pack count  =  formula(item.units, dose, frequency, days)      ← fractional
packs to give   =  accurateDose(raw pack count, isBupa)            ← whole number
```

The formula is picked by `item_type`. All four return a **fraction of a pack**, never a
count of tablets.

---

## 2. The four formulas

### `tabletCalculate(totalUnits, dayUnits, days)` — `tablet` and `antibiotic`

```js
if (totalUnits === 28) totalUnits = 30;
if (totalUnits === 56) totalUnits = 60;
if (totalUnits === 14) totalUnits = 15;
if (totalUnits === 7)  totalUnits = 7.5;
if (totalUnits === 0)  return 0;
return (dayUnits * days) / totalUnits;
```

`dayUnits` is `dose × frequency` — tablets per day.

**The pack-size substitutions are load-bearing, not a bug.** A 28-tablet pack is dispensed
as a month, a 7 as a week and a half. Without the bump, one tablet a day for 30 days out of
a 28-pack is `30 / 28 = 1.07` packs, which rounds up to two boxes; with it, `30 / 30 = 1`.
The dose list has 872 rows using these pack sizes, so the substitutions fire constantly.

`antibiotic` deliberately shares the tablet formula — the two types differ only in how
they were *meant* to round (§5).

### `insulinCalculate(totalUnits, dayUnits, days)` — `insulin`

```js
if (totalUnits === 0) return 0;
return (dayUnits * days) / totalUnits;
```

Same arithmetic as tablets minus the pack substitutions, but note what is passed in:
`calculate()` hands it **`dose`, not `dose × frequency`**. For insulin the "dose" field is
already the daily unit total, so **frequency is ignored**.

### `dropsCalculate(totalUnits, freq, days)` — `drops`

```js
if (totalUnits === 0 || freq === 0) return 0;
return days / (totalUnits / freq);
```

Read it as: one pack lasts `totalUnits / freq` days, so the course spans
`days ÷ that` packs. **The dose is ignored** — one drop is one drop.

The C# original carried a commented-out `_sides` factor for one-eye vs both-eyes dosing
(forced to 1 for packs under 31 units). It was already dead in C# and absent from Dart, so
it is not ported.

### No match

An unrecognised `item_type` returns `0`. Every row in the current `imFile.csv` is one of
the four, so this is a guard, not a path.

---

## 3. `accurateDose` — fraction to whole packs

```js
if (isBupa && !isAntibiotic) {
    if (calculatedDose % 1 === 0.5) calculatedDose = calculatedDose + 0.01;
    dose = Math.round(calculatedDose);
} else {
    if (calculatedDose % 1 > 0) dose = Math.floor(calculatedDose) + 1;
    else                        dose = Math.trunc(calculatedDose);
}
```

- **Bupa (non-antibiotic): nearest whole pack.** 1.4 → 1, 1.5 → 2, 1.6 → 2.
- **Everything else: always round up.** 1.01 → 2, 2.0 → 2.

Two details worth knowing:

- **The `+ 0.01` nudge does nothing in JS, and is kept anyway.** It comes from C#, where
  `Math.Round` uses banker's rounding and would have sent 1.5 *down* to 2… and 2.5 down to
  2. Dart's `.round()` and JS's `Math.round()` both already round a half away from zero, so
  the nudge is inert. It stays so the port reads line-for-line against its source.
- **Bupa rounding can return 0.** A course needing 0.4 of a pack rounds to nothing. That is
  the legacy behaviour, and the page shows it as a plain `0` — there is no warning attached
  to it.

`Math.trunc` is the port of Dart's `.toInt()`, which truncates toward zero.

---

## 4. Which inputs each type actually uses

| Type | Dose | Frequency | Days |
| --- | :---: | :---: | :---: |
| `tablet` | ✔ | ✔ | ✔ |
| `antibiotic` | ✔ | ✔ | ✔ |
| `insulin` | ✔ | ✖ | ✔ |
| `drops` | ✖ | ✔ | ✔ |

This table is `inputsUsedBy()`, and it exists only so the UI can mark the inert field —
the formulas themselves are unchanged. The Dart app still *required* all three to be
`> 0`; see §4 of [dose-calculator.md](./dose-calculator.md) for how that is preserved.

---

## 5. Known divergences from the C# original

Both are Dart's behaviour, and both are kept, because Dart is what shipped.

### 5.1 Antibiotics take the Bupa rounding branch

`accurateDose` has an `isAntibiotic` parameter that turns off nearest-pack rounding — an
antibiotic course is supposed to always round up, since a short course cannot be shipped.
The C# caller passed it explicitly. **The Dart `calculate()` never does:**

```dart
return accurateDose(calculatedDose, isBupa).toDouble();   // isAntibiotic defaults to false
```

So an `antibiotic` item on a Bupa contract rounds to the nearest pack like any tablet:
1.33 packs → **1**, not 2. There are 118 antibiotic rows in the dose list, so this is not
a corner case.

The port matches Dart. `accurateDose` still exposes the third parameter, so switching the
behaviour is a one-line change in `calculate()` — but it is a **behavioural decision, not
a cleanup**, and would make this calculator disagree with the app it replaces.

### 5.2 C# returns 0 for whole numbers on the round-up branch

The C# `else` branch only assigns `_dose` when there is a fraction:

```csharp
else {
    if (_calculatedDose % 1 > 0) { _dose = (int)Math.Floor(_calculatedDose) + 1; }
    // no else — _dose stays 0
}
```

So exactly 2.0 packs came back as **0** in C#. Dart fixed this with an explicit
`dose = calculatedDose.toInt()`, and the port keeps the fix.

---

## 6. Worked examples

| Item | Pack | Dose | Freq | Days | Raw | Bupa | Round-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tablet | 30/box | 1 | 2 | 30 | 2.00 | 2 | 2 |
| tablet | 30/box | 1 | 1 | 45 | 1.50 | 2 | 2 |
| tablet | 30/box | 1 | 1 | 40 | 1.33 | **1** | **2** |
| tablet | 28/box → 30 | 1 | 1 | 30 | 1.00 | 1 | 1 |
| tablet | 7/box → 7.5 | 1 | 1 | 15 | 2.00 | 2 | 2 |
| antibiotic | 3/box | 1 | 1 | 5 | 1.67 | 2 | 2 |
| antibiotic | 3/box | 1 | 1 | 4 | 1.33 | **1** | **2** |
| insulin | 300/pen-vial | 20 | *any* | 30 | 2.00 | 2 | 2 |
| drops | 30/box | *any* | 2 | 30 | 2.00 | 2 | 2 |
| drops | 200/box | *any* | 4 | 30 | 0.60 | 1 | 1 |

Bold rows are where the rounding mode changes the answer.
