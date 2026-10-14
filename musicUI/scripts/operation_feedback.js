export function paint() {
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

let protectedWork = false, currentUri, pendingUri, previousFocus;
function unloading(event) {
    if (!protectedWork) return;
    event.preventDefault(); event.returnValue = '';
}
function clicking(event) {
    if (protectedWork && (event.target.closest?.('.rz-dialog-titlebar-close') || event.target.matches?.('.rz-dialog-mask')))
    {
        event.preventDefault(); event.stopImmediatePropagation();
        return;
    }
    const anchor = event.target.closest?.('a[href]');
    if (!protectedWork || !anchor || anchor.target || anchor.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const url = new URL(anchor.href, document.baseURI);
    if (url.origin !== location.origin) return;
    event.preventDefault(); event.stopImmediatePropagation();
    pendingUri = url.href;
}
function keydown(event) {
    if (protectedWork && event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
    }
}
function moving(event) {
    if (!protectedWork) return;
    pendingUri = location.href;
    history.replaceState(event.state, '', currentUri);
    event.stopImmediatePropagation();
}
export function start(value) {
    window.addEventListener('beforeunload', unloading);
    document.addEventListener('click', clicking, true);
    window.addEventListener('popstate', moving, true);
    window.addEventListener('keydown', keydown, true);
}
export function applicationFocus(active) {
    if (active) {
        previousFocus = document.activeElement;
        document.querySelector('.application-wait')?.focus({preventScroll:true});
    } else {
        if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({preventScroll:true});
        previousFocus = null;
    }
}
export function protect(value, uri) {
    if (value && !protectedWork) { currentUri = uri; pendingUri = null; }
    protectedWork = value;
    document.documentElement?.toggleAttribute('data-musicui-protected', value);
}
export function finish(success) {
    protectedWork = false;
    document.documentElement?.removeAttribute('data-musicui-protected');
    const uri = success ? pendingUri : null;
    pendingUri = null;
    return uri;
}
export function dispose() {
    protectedWork = false; previousFocus = null; pendingUri = null;
    document.documentElement?.removeAttribute('data-musicui-protected');
    window.removeEventListener('beforeunload', unloading);
    document.removeEventListener('click', clicking, true);
    window.removeEventListener('popstate', moving, true);
    window.removeEventListener('keydown', keydown, true);
}
