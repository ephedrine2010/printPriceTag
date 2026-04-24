/**
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    var i;
    for (i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Match Flutter `rootBundle.load` + base64 embed: stable in the print popup without cross-origin image issues.
 * @param {string} iconUrl — absolute URL to `assets/riyal.png`
 * @returns {Promise<string>}
 */
export async function loadRiyalDataUrl(iconUrl) {
    try {
        var res = await fetch(iconUrl);
        if (!res.ok) {
            throw new Error('bad status');
        }
        var b64 = arrayBufferToBase64(await res.arrayBuffer());
        return 'data:image/png;base64,' + b64;
    } catch (e) {
        return iconUrl;
    }
}
