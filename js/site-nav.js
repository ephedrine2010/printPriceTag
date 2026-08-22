/**
 * The little "Pages" dropdown that sits beside the page title.
 *
 * Markup lives in each page's header (see `index.html`); this module only wires
 * up open/close, outside-click dismissal and keyboard handling, so both pages
 * behave the same.
 */

function initNav(root) {
    const btn = root.querySelector('.site-nav-btn');
    const menu = root.querySelector('.site-nav-menu');
    if (!btn || !menu) return;

    function isOpen() {
        return !menu.hidden;
    }

    function open() {
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
    }

    function close(refocus) {
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        if (refocus) btn.focus();
    }

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isOpen()) close(false);
        else open();
    });

    btn.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            open();
            const first = menu.querySelector('a');
            if (first) first.focus();
        }
    });

    menu.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            close(true);
        }
    });

    document.addEventListener('click', function (e) {
        if (isOpen() && !root.contains(e.target)) close(false);
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen()) close(true);
    });
}

const roots = document.querySelectorAll('[data-site-nav]');
for (let i = 0; i < roots.length; i++) initNav(roots[i]);
