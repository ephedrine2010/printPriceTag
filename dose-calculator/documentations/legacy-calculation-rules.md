# Calculation rules as they exist in the old project

This is the **source-of-truth extraction**: every rule the legacy code applies, read
straight off the two files it lived in. Nothing here describes the JS rewrite — this is
the reference the rewrite is checked against.

| Source file | What it is |
| --- | --- |
| `dose_calculation_service.dart` | the Dart version — **what actually shipped** |
| `CalculateService.cs` | the older C# it was ported from |

They came from a Flutter project (`doseCalculator/service/`) that is **no longer in this
repo**, so both are reproduced verbatim in the [appendix](#appendix--the-legacy-sources-verbatim).

Where the two disagree, the Dart wins — see "Quirks" at the end.

For how these rules are carried into JS (and which ones were deliberately preserved
rather than fixed), see [dose-calculation-rules.md](./dose-calculation-rules.md).

---

## Rule 1 — `item_type` picks the formula, **and** which inputs get used

The easy one to miss: `calculate()` does not hand the same arguments to each formula.

```dart
switch (item.itemType.toLowerCase()) {
  case 'tablet':      tabletCalculate(item.units, dose * frequency, days);
  case 'antibiotic':  tabletCalculate(item.units, dose * frequency, days);  // same as tablet
  case 'insulin':     insulinCalculate(item.units, dose, days);             // frequency NOT passed
  case 'drops':       dropsCalculate(item.units, frequency, days);          // dose NOT passed
}
```

| Type | Dose | Frequency | Days |
| --- | :---: | :---: | :---: |
| `tablet` | ✔ | ✔ | ✔ |
| `antibiotic` | ✔ | ✔ | ✔ |
| `insulin` | ✔ | ✖ | ✔ |
| `drops` | ✖ | ✔ | ✔ |

**Insulin ignores frequency** — its "dose" is already the daily unit total.
**Drops ignore the dose** — a drop is a drop.
**Antibiotic shares the tablet formula** — the two were only ever meant to differ in how
they round (Rule 4).

An unrecognised type falls through the switch and returns `0`.

---

## Rule 2 — the three formulas, all returning a *fraction of a pack*

```dart
tabletCalculate(total, dayUnits, days)  =  (dayUnits * days) / total
insulinCalculate(total, dayUnits, days) =  (dayUnits * days) / total   // identical arithmetic
dropsCalculate(total, freq, days)       =  days / (total / freq)
```

- `total` is `item.units` — units in one pack (tablets, drops, insulin units).
- `dayUnits` is `dose × frequency` for tablets, and plain `dose` for insulin.
- Drops read as: one pack lasts `total / freq` days, so the course spans `days ÷ that`.

Tablet and insulin are the same arithmetic. They are separate functions only because
tablets carry the substitutions below and insulin does not.

---

## Rule 3 — pack-size substitutions (tablets and antibiotics only)

```dart
if (totalUnits == 28) totalUnits = 30;
if (totalUnits == 56) totalUnits = 60;
if (totalUnits == 14) totalUnits = 15;
if (totalUnits == 7)  totalUnits = 7.5;
```

A 28-tablet pack is dispensed as a month, a 7 as a week and a half. Without the bump, one
tablet a day for 30 days out of a 28-pack is `30 / 28 = 1.07` packs → **two boxes**; with
it, `30 / 30 = 1` → **one**.

This is not a corner case: 872 of the 873 rows in `imFile.csv` use these pack sizes.

---

## Rule 4 — rounding to whole packs (`accurateDose`)

```dart
if (isBupa && !isAntibiotic) {
  if (calculatedDose % 1 == 0.5) calculatedDose = calculatedDose + 0.01;
  dose = calculatedDose.round();                 // nearest whole pack
} else {
  if (calculatedDose % 1 > 0) dose = calculatedDose.floor() + 1;   // always round up
  else                        dose = calculatedDose.toInt();
}
```

- **Bupa, non-antibiotic → nearest pack.** 1.4 → 1, 1.5 → 2, 1.6 → 2
- **Everything else → always up.** 1.01 → 2, 2.0 → 2

Two consequences that fall out of this and surprise people:

- **Bupa rounding can return `0`.** A course needing 0.4 of a pack rounds to nothing.
- **The two modes can differ by a whole pack** on identical inputs: 1.20 → 1 on Bupa,
  → 2 with it off.

---

## Rule 5 — guards

- All three formulas return `0` when `totalUnits == 0`.
- Drops additionally return `0` when `freq == 0`.

No other input is validated inside the maths; the range checks live in the cubit.

---

## Rule 6 — search

```sql
SELECT * FROM imfile WHERE name_en LIKE '%<query>%' LIMIT 50
```

English name only, plain substring, capped at 50, in table order. The Arabic name is never
searched.

---

## Quirks

### The `+ 0.01` nudge does nothing

It exists because C#'s `Math.Round(x, 0)` uses **banker's rounding** and would have sent
1.5 *down* to 2 — and 2.5 down to 2. Dart's `.round()` rounds a half away from zero, so by
the time the code reached Dart the nudge was already inert.

### `isAntibiotic` is never actually passed

`accurateDose` takes the flag, and the C# caller supplied it — an antibiotic course is
supposed to always round up, since a short course cannot be dispensed. But Dart's
`calculate()` calls it with two arguments and lets the flag default to `false`:

```dart
return accurateDose(calculatedDose, isBupa).toDouble();   // isAntibiotic defaults to false
```

So **an antibiotic on Bupa rounds to nearest like any tablet**: 1.33 packs → **1**, not 2.
There are 118 antibiotic rows in the dose list. This is the one rule where the two legacy
versions give different answers.

### C# returned 0 for whole numbers

Its round-up branch only assigned when there was a fraction:

```csharp
else {
    if (_calculatedDose % 1 > 0) { _dose = (int)Math.Floor(_calculatedDose) + 1; }
    // no else — _dose stays 0
}
```

So exactly 2.0 packs came back as **0**. Dart fixed it with the explicit `.toInt()`.

### Dead code in the C# drops formula

`_DropsCalculate` carries a commented-out `_sides` factor for one-eye vs both-eyes dosing
(forced to 1 for packs under 31 units). It was already dead in C# and is absent from Dart.

---

## Two things that look like inputs but are not

- **The `dose_frequency` column** (`day` / `week` in `imFile.csv`) is never read by any
  formula. The Dart model even parsed it with `double.tryParse('day')`, which always
  yielded `0.0`.
- **`isBupa`** was hardcoded `true` in `DoseCalculatorCubit.calculateDose()` and never
  exposed to the user — so in practice the old app *only ever* ran the nearest-pack branch.

---

## Validation (from the cubit, not the maths)

`DoseCalculatorCubit.calculateDose()` rejects, in this order, with this wording:

1. no item selected → `Please select a medicine first`
2. `dose` null or ≤ 0 → `Please enter a valid dose greater than 0`
3. `frequency` null or ≤ 0 → `Please enter a valid frequency greater than 0`
4. `days` null or ≤ 0 → `Please enter a valid number of days greater than 0`

All three are required **regardless of item type** — including the one the item's own
formula never reads.

---

## Appendix — the legacy sources, verbatim

The Flutter project these rules were read from is not in this repo (and never was in its
git history), so both source files are reproduced here in full. **This appendix is the ground truth**: if a
behaviour is ever in doubt, check the port against the code below, not against prose.

Only the calculation members are kept. The Dart `searchItems()` (SQLite plumbing, replaced
by [`js/imfile-store.js`](../js/imfile-store.js)), the cubit, the model and the Flutter view
are not reproduced — what mattered in them is stated in the rules above.

### `dose_calculation_service.dart` — the version that shipped

```dart
class DoseCalculationService {
//==============================================================================

  int accurateDose(double calculatedDose, bool isBupa,
      {bool isAntibiotic = false}) {
    int dose = 0;
    if (isBupa && !isAntibiotic) {
      if (calculatedDose % 1 == 0.5) {
        calculatedDose = calculatedDose + 0.01;
      }
      dose = calculatedDose.round();
    } else {
      if (calculatedDose % 1 > 0) {
        dose = calculatedDose.floor() + 1;
      } else {
        dose = calculatedDose.toInt();
      }
    }
    return dose;
  }

//==============================================================================
  double insulinCalculate(double totalUnits, double dayUnits, double days) {
    if (totalUnits == 0) return 0;
    return ((dayUnits * days) / totalUnits);
  }

//==============================================================================
  double dropsCalculate(double totalUnits, double freq, double days) {
    if (totalUnits == 0 || freq == 0) return 0;
    return (days / (totalUnits / freq));
  }

//==============================================================================
  double tabletCalculate(double totalUnits, double dayUnits, double days) {
    if (totalUnits == 28) {
      totalUnits = 30;
    }
    if (totalUnits == 56) {
      totalUnits = 60;
    }
    if (totalUnits == 14) {
      totalUnits = 15;
    }
    if (totalUnits == 7) {
      totalUnits = 7.5;
    }
    if (totalUnits == 0) return 0;
    return ((dayUnits * days) / totalUnits);
  }

//==============================================================================
  double calculate(
      DoseItem item, double dose, double frequency, double days, bool isBupa) {
    double calculatedDose = 0;
    switch (item.itemType.toLowerCase()) {
      case 'tablet':
        calculatedDose = tabletCalculate(item.units, dose * frequency, days);
        break;
      case 'antibiotic':
        calculatedDose = tabletCalculate(item.units, dose * frequency, days);
        break;
      case 'insulin':
        calculatedDose = insulinCalculate(item.units, dose, days);
        break;
      case 'drops':
        calculatedDose = dropsCalculate(item.units, frequency, days);
        break;
    }
    return accurateDose(calculatedDose, isBupa).toDouble();
  }
  //============================================================================
}
```

### `CalculateService.cs` — the C# it was ported from

```csharp
using insuServicePrj.service;
using System;
using System.Collections.Generic;
using System.Text;

namespace insuranceServicePrj.service
{
    public class CalculateService
    {
       public int accurateDose(double _calculatedDose , bool isAntibiotic , bool isBupa)
        {
            int _dose = 0;

            if (isBupa && isAntibiotic==false)
            {
                if (_calculatedDose % 1 == 0.5)
                {
                    _calculatedDose = _calculatedDose + 0.01;
                }
                _dose = (int)Math.Round(_calculatedDose, 0);
                
            }
            else
            {
                if (_calculatedDose % 1 > 0)
                {
                    _dose =(int)Math.Floor(_calculatedDose) + 1;
                }
            }

            return _dose;
        }

       public double _insulinCalculate(double _totalUnits, double _dayUnits, double _days)
        {
            double _calculate = ((_dayUnits * _days) / _totalUnits);
            return _calculate;
        }
        // Drops calculations
        public double _DropsCalculate(double _totalUnits, double _freq, double _days)
        {
            /*double _sides = 1;

           if (one_eye_ear.IsChecked) { _sides = 1; } else { _sides = 2; }
           if (_totalUnits < 31)
           {
               _sides = 1;
           }*/


            double _calculate = (_days / (_totalUnits / _freq));
            return _calculate;
        }
        // Tablet calculations
        public double _TabletCalculate(double _totalUnits, double _dayUnits, double _days)
        {

            if (_totalUnits == 28)
            {
                _totalUnits = 30;
            }
            if (_totalUnits == 56)
            {
                _totalUnits = 60;
            }
            if (_totalUnits == 14)
            {
                _totalUnits = 15;
            }
            if (_totalUnits == 7)
            {
                _totalUnits = 7.5;
            }


            double _calculate = ((_dayUnits * _days) / _totalUnits);
            return _calculate;
        }
    }
}
```
