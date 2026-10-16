const controllers = new WeakMap();
export function close(root, name, focus = false) {
    const menu = root.querySelector(`[data-menu="${name}"]`);
    if (!menu) return;
    menu.open = false;
    menu.querySelector('summary').setAttribute('aria-expanded', 'false');
    if (focus) menu.querySelector('summary').focus();
}
export function start(root) {
    const controller = new AbortController();
    controllers.set(root, controller);
    const options = { signal: controller.signal };
    const menus = [...root.querySelectorAll('details')];
    const items = menu => [...menu.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
    for (const menu of menus) {
        const summary = menu.querySelector('summary');
        summary.setAttribute('aria-expanded', String(menu.open));
        menu.addEventListener('toggle', () => {
            summary.setAttribute('aria-expanded', String(menu.open));
            if (menu.open) for (const other of menus) if (other !== menu) close(root, other.dataset.menu);
        }, options);
        summary.addEventListener('click', () => {
            if (!menu.open) for (const other of menus) if (other !== menu) close(root, other.dataset.menu);
        }, options);
        menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(root, menu.dataset.menu, true);
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                menu.open = true;
                const controls = items(menu);
                const index = controls.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
                    : event.key === 'ArrowDown' ? (index + 1) % controls.length
                    : index <= 0 ? controls.length - 1 : index - 1;
                controls[next]?.focus();
            }
        }, options);
        menu.addEventListener('focusout', event => {
            // focusout fires before activeElement changes. Inspect the destination
            // instead, so clicking an item does not hide it before its click fires.
            if (event.relatedTarget && !menu.contains(event.relatedTarget)) close(root, menu.dataset.menu);
        }, options);
    }
    document.addEventListener('pointerdown', event => {
        for (const menu of menus) if (!menu.contains(event.target)) close(root, menu.dataset.menu);
    }, options);
}
export function dispose(root) {
    controllers.get(root)?.abort();
    controllers.delete(root);
}
