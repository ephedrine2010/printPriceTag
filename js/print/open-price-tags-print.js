import { RIYAL_ICON_SRC } from './riyal-icon.js';
import { loadDartPrintShellTemplate } from './load-dart-print-shell.js';
import { loadRiyalDataUrl } from './riyal-data-url.js';

var cachedShellTemplate = null;

/**
 * @returns {Promise<string>}
 */
async function getShellTemplate() {
    if (cachedShellTemplate) {
        return cachedShellTemplate;
    }
    cachedShellTemplate = await loadDartPrintShellTemplate();
    return cachedShellTemplate;
}

/**
 * @param {{ query: string, status: string, nameEn: string, nameAr: string, price: string|number, vat: string }} row
 * @returns {object}
 */
function rowToDartItem(row) {
    var vat = parseFloat(row.vat);
    return {
        nat_barcode: String(row.query),
        vat: isNaN(vat) ? 0 : vat,
        eng_name: row.nameEn || '',
        ar_name: row.nameAr || '',
        item_price: row.price,
        is_smart: false,
    };
}

/**
 * Opens the legacy Dart-identical print page in a new window.
 * @param {{ query: string, status: string, nameEn: string, nameAr: string, price: string|number, vat: string }[]} lastResults
 * @returns {Promise<void>}
 */
export async function openPriceTagsPrint(lastResults) {
    var found = [];
    var i;
    for (i = 0; i < lastResults.length; i++) {
        if (lastResults[i].status === 'found') {
            found.push(lastResults[i]);
        }
    }
    if (!found.length) {
        window.alert(
            'No matched items to print. Only rows with status Found are included on the sheet.'
        );
        return;
    }

    var items = [];
    for (i = 0; i < found.length; i++) {
        items.push(rowToDartItem(found[i]));
    }

    var riyalDataUrl = await loadRiyalDataUrl(RIYAL_ICON_SRC);
    var tpl = await getShellTemplate();
    var itemsJson = JSON.stringify(items).replace(/</g, '\\u003c');
    var html = tpl
        .replace('__ITEMS_JSON__', itemsJson)
        .replace('__RIYAL_JSON__', JSON.stringify(riyalDataUrl));

    var w = window.open('', '_blank');
    if (!w || !w.document) {
        window.alert('Popup blocked. Allow popups for this site to open the print page.');
        return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
}
