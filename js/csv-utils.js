/**
 * Parse one CSV line (RFC-style quoted fields).
 * @param {string} line
 * @returns {string[]}
 */
export function parseCSVLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (c === ',' && !inQuotes) {
            out.push(cur);
            cur = '';
            continue;
        }
        cur += c;
    }
    out.push(cur);
    return out;
}

/**
 * Split a full CSV / text blob into non-empty lines (no trailing empty).
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
    return text.split(/\r?\n/).filter(function (ln) {
        return ln.length > 0;
    });
}
