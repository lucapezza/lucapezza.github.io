let reference;
let frames = [];
let observer;
let lastOutsideFocus;

const activeDialog = () => [...document.querySelectorAll('.rz-dialog')].at(-1);
const visible = element => element.isConnected && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert]');
const focusable = dialog => [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]')]
    .filter(element => !element.matches(':disabled') && !element.closest('fieldset[disabled]') && element.tabIndex >= 0 && visible(element));
const popupOpen = () => [...document.querySelectorAll('.rz-popup, .rz-overlaypanel, .rz-dropdown-panel, .rz-multiselect-panel')].some(visible);
const openerFor = element => element?.closest('.header-dropdown')?.querySelector('summary') || element;

function focusDialog(dialog) {
    const elements = focusable(dialog);
    const initial = elements.find(element => element.hasAttribute('data-dialog-initial-focus'));
    const target = initial || elements[0] || dialog;
    if (target === dialog) dialog.tabIndex = -1;
    target.focus({preventScroll: true});
}

function keydown(event) {
    const dialog = activeDialog();
    if (!dialog || !frames.length) return;
    if (event.key === 'Escape' && !popupOpen()) {
        // Radzen 3.18 retains an old document Escape handler; gate it for every dialog.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (frames.at(-1).canEscape) {
            frames.at(-1).closing = true;
            reference.invokeMethodAsync('CloseOnEscape');
        }
    } else if (event.key === 'Tab' && !popupOpen()) {
        const elements = focusable(dialog);
        const first = elements[0], last = elements.at(-1);
        if (!elements.length) {
            event.preventDefault();
            focusDialog(dialog);
        } else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
            event.preventDefault();
            first.focus();
        }
    }
}

function focusin(event) {
    const dialog = activeDialog();
    if (!dialog) lastOutsideFocus = openerFor(event.target);
    if (dialog && frames.length && !frames.at(-1).closing && !dialog.contains(event.target) && !popupOpen()) focusDialog(dialog);
}

function pointerdown(event) {
    const dialog = activeDialog();
    if (!dialog) lastOutsideFocus = openerFor(event.target.closest('button, a, input, summary, label') || document.activeElement);
    if (dialog && frames.length && event.target.closest('.rz-dialog-titlebar-close')) frames.at(-1).closing = true;
    if (dialog && frames.length && !dialog.contains(event.target) && !popupOpen()) {
        event.preventDefault();
        focusDialog(dialog);
    }
}

export function start(value) {
    reference = value;
    window.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    window.addEventListener('pointerdown', pointerdown, true);
    observer = new MutationObserver(() => {
        const dialog = activeDialog();
        if (dialog && frames.length && !frames.at(-1).closing && !dialog.contains(document.activeElement) && !popupOpen()) focusDialog(dialog);
    });
    observer.observe(document.body, {childList: true, subtree: true});
}

export function sync(states) {
    const removed = frames.filter(frame => !states.some(state => state.id === frame.id));
    frames = frames.filter(frame => states.some(state => state.id === frame.id));
    if (!states.length && removed.length) {
        const opener = removed[0].opener;
        const restore = () => {
            const current = document.activeElement;
            if (!frames.length && (!current || current === document.body || current.closest('.rz-dialog') || !visible(current)) &&
                opener && visible(opener) && !opener.disabled) opener.focus({preventScroll: true});
        };
        restore();
        // The library can remove its focused close link after the close notification renders.
        requestAnimationFrame(() => requestAnimationFrame(restore));
    }
    let opened = false;
    for (const state of states) {
        let frame = frames.find(frame => frame.id === state.id);
        if (!frame) {
            frame = {id: state.id, opener: lastOutsideFocus || openerFor(document.activeElement)};
            frames.push(frame);
            opened = true;
        }
        frame.canEscape = state.canEscape;
    }
    const dialog = activeDialog();
    if (dialog && frames.length && (opened || !dialog.contains(document.activeElement))) focusDialog(dialog);
}

export function dispose() {
    window.removeEventListener('keydown', keydown, true);
    document.removeEventListener('focusin', focusin);
    window.removeEventListener('pointerdown', pointerdown, true);
    observer?.disconnect();
    frames = [];
    reference = null;
    lastOutsideFocus = null;
}

