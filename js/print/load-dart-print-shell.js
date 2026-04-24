/**
 * Loads the static print document (verbatim from legacy Dart `printhtmlpage.dart`).
 * Requires the app to be served so `fetch` can read this file (file:// may fail in some browsers).
 */
export async function loadDartPrintShellTemplate() {
    var url = new URL('./dart-print-shell.html', import.meta.url);
    var res = await fetch(url);
    if (!res.ok) {
        throw new Error(
            'Could not load js/print/dart-print-shell.html (HTTP ' +
                res.status +
                '). Serve the project from a local web server if you opened index.html as a file.'
        );
    }
    return res.text();
}
