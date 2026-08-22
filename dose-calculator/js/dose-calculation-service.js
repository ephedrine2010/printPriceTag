/**
 * Dose maths — a faithful port of the legacy Dart `DoseCalculationService`, which was
 * in turn a port of an older C# `CalculateService`. Neither source is in this repo any
 * more; both are reproduced verbatim in the rules doc linked below.
 *
 * As with the barcode rules and the print shell on the main app, the point of this
 * module is to reproduce the legacy numbers exactly — do not "tidy up" the odd
 * pack-size substitutions or the rounding nudge. See
 * [documentations/dose-calculation-rules.md](../documentations/dose-calculation-rules.md)
 * for what each rule is and where the Dart and C# versions disagree.
 */

/**
 * Turn a fractional pack count into the number of packs actually dispensed.
 *
 * Bupa (non-antibiotic) rounds to the nearest whole pack; everything else always
 * rounds up. The `+ 0.01` nudge comes from the C# original, where `Math.Round`
 * uses banker's rounding and would have sent x.5 down; Dart's and JS's `round`
 * already go up on a half, so the nudge changes nothing here — it is kept so the
 * port stays line-for-line with the source.
 *
 * @param {number} calculatedDose — raw, fractional pack count
 * @param {boolean} isBupa
 * @param {boolean} [isAntibiotic=false]
 * @returns {number} whole packs
 */
export function accurateDose(calculatedDose, isBupa, isAntibiotic) {
    if (isAntibiotic === undefined) isAntibiotic = false;

    let dose = 0;
    if (isBupa && !isAntibiotic) {
        if (calculatedDose % 1 === 0.5) {
            calculatedDose = calculatedDose + 0.01;
        }
        dose = Math.round(calculatedDose);
    } else {
        if (calculatedDose % 1 > 0) {
            dose = Math.floor(calculatedDose) + 1;
        } else {
            // Dart's `.toInt()` truncates toward zero.
            dose = Math.trunc(calculatedDose);
        }
    }
    return dose;
}

/**
 * Insulin: units per day × days ÷ units per pack. Frequency plays no part —
 * the "dose" for insulin is already the daily unit total.
 *
 * @param {number} totalUnits — units in one pen/vial pack
 * @param {number} dayUnits — units per day
 * @param {number} days
 * @returns {number}
 */
export function insulinCalculate(totalUnits, dayUnits, days) {
    if (totalUnits === 0) return 0;
    return (dayUnits * days) / totalUnits;
}

/**
 * Drops: how many packs the course spans, given a pack lasts
 * `totalUnits / freq` days. The dose size plays no part — one drop is one drop.
 *
 * @param {number} totalUnits — drops (or pieces) in one pack
 * @param {number} freq — times per day
 * @param {number} days
 * @returns {number}
 */
export function dropsCalculate(totalUnits, freq, days) {
    if (totalUnits === 0 || freq === 0) return 0;
    return days / (totalUnits / freq);
}

/**
 * Tablets (and antibiotics): tablets per day × days ÷ tablets per pack.
 *
 * The pack-size substitutions are deliberate. A "28 tablet" pack is dispensed as
 * a month, a "7" as a week and a half, and so on — bumping the divisor keeps the
 * result from asking for an extra box over a 30-day course.
 *
 * @param {number} totalUnits — tablets in one pack
 * @param {number} dayUnits — tablets per day (dose × frequency)
 * @param {number} days
 * @returns {number}
 */
export function tabletCalculate(totalUnits, dayUnits, days) {
    if (totalUnits === 28) {
        totalUnits = 30;
    }
    if (totalUnits === 56) {
        totalUnits = 60;
    }
    if (totalUnits === 14) {
        totalUnits = 15;
    }
    if (totalUnits === 7) {
        totalUnits = 7.5;
    }
    if (totalUnits === 0) return 0;
    return (dayUnits * days) / totalUnits;
}

/**
 * The fractional pack count for an item, before rounding.
 *
 * @param {{itemType: string, units: number}} item
 * @param {number} dose
 * @param {number} frequency
 * @param {number} days
 * @returns {number}
 */
export function rawCalculate(item, dose, frequency, days) {
    switch (String(item.itemType).toLowerCase()) {
        case 'tablet':
            return tabletCalculate(item.units, dose * frequency, days);
        case 'antibiotic':
            return tabletCalculate(item.units, dose * frequency, days);
        case 'insulin':
            return insulinCalculate(item.units, dose, days);
        case 'drops':
            return dropsCalculate(item.units, frequency, days);
        default:
            return 0;
    }
}

/**
 * Packs to dispense for an item — `rawCalculate` put through `accurateDose`.
 *
 * Note that, exactly as in the Dart original, `isAntibiotic` is *not* forwarded
 * from the item's type: an antibiotic on a Bupa contract still takes the
 * round-to-nearest branch. See the "Known divergence" section of the rules doc.
 *
 * @param {{itemType: string, units: number}} item
 * @param {number} dose
 * @param {number} frequency
 * @param {number} days
 * @param {boolean} isBupa
 * @returns {number}
 */
export function calculate(item, dose, frequency, days, isBupa) {
    return accurateDose(rawCalculate(item, dose, frequency, days), isBupa);
}

/**
 * Which of the three inputs an item's formula actually consumes. Used by the UI
 * to mark the inert field rather than silently ignoring what the user typed.
 *
 * @param {string} itemType
 * @returns {{ dose: boolean, frequency: boolean, days: boolean }}
 */
export function inputsUsedBy(itemType) {
    switch (String(itemType).toLowerCase()) {
        case 'insulin':
            return { dose: true, frequency: false, days: true };
        case 'drops':
            return { dose: false, frequency: true, days: true };
        case 'tablet':
        case 'antibiotic':
            return { dose: true, frequency: true, days: true };
        default:
            return { dose: true, frequency: true, days: true };
    }
}
