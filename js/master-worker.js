import { parseCSVLine } from './csv-utils.js';
import { COL, MASTER_MIN_COLS } from './config.js';

self.onmessage = function (ev) {
    if (!ev.data || ev.data.type !== 'build') return;

    var text = ev.data.text;
    var lines = text.split(/\r?\n/);
    var lineCount = lines.length;

    var rows = [];
    var bySku = Object.create(null);
    var byBarcodeStr = Object.create(null);
    var byBarcodeNum = Object.create(null);
    var byGtin = Object.create(null);

    var processed = 0;
    var i;
    var line;
    var c;
    var idx;
    var barcodeRaw;
    var skuRaw;
    var gtinRaw;
    var bcNum;
    var skuNum;

    for (i = 0; i < lines.length; i++) {
        line = lines[i];
        if (!line) continue;

        c = parseCSVLine(line);
        if (c.length < MASTER_MIN_COLS) continue;

        idx = rows.length;

        barcodeRaw = c[COL.BARCODE].trim();
        skuRaw = c[COL.SKU].trim();
        gtinRaw = c[COL.GTIN].trim();

        rows.push({
            nameEn: c[COL.NAME_EN] || '',
            nameAr: c[COL.NAME_AR] || '',
            itemPrice: c[COL.ITEM_PRICE],
            vat: c[COL.VAT],
        });

        if (byBarcodeStr[barcodeRaw] === undefined) {
            byBarcodeStr[barcodeRaw] = idx;
        }
        bcNum = Number(barcodeRaw);
        if (!isNaN(bcNum) && byBarcodeNum[bcNum] === undefined) {
            byBarcodeNum[bcNum] = idx;
        }

        skuNum = parseInt(skuRaw, 10);
        if (!isNaN(skuNum) && bySku[skuNum] === undefined) {
            bySku[skuNum] = idx;
        }

        if (gtinRaw && gtinRaw !== '-' && byGtin[gtinRaw] === undefined) {
            byGtin[gtinRaw] = idx;
        }

        processed++;
        if (processed % 40000 === 0) {
            self.postMessage({
                type: 'progress',
                processed: processed,
                lines: lineCount,
            });
        }
    }

    self.postMessage({
        type: 'done',
        rows: rows,
        bySku: bySku,
        byBarcodeStr: byBarcodeStr,
        byBarcodeNum: byBarcodeNum,
        byGtin: byGtin,
        rowCount: rows.length,
    });
};
