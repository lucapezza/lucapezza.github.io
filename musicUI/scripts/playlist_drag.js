// Blazor owns the rows. This module only captures gestures and draws feedback.
const controllers = new WeakMap();

export function initialize(root, dotnet) {
    if (controllers.has(root)) return controllers.get(root);
    let enabled = false, gesture = null, sequence = 0, frame = 0;
    let disposed = false;
    const call = (name, ...args) => dotnet.invokeMethodAsync(name, ...args);
    const usable = s => enabled && root.isConnected && s.handle.isConnected &&
        !s.handle.disabled && !s.handle.closest('[inert]');

    function clear(s) {
        if (gesture === s) gesture = null;
        cancelAnimationFrame(frame);
        frame = 0;
        s.preview?.remove();
        s.marker?.remove();
        s.row.classList.remove('playlist-drag-source');
        if (s.handle.hasPointerCapture(s.pointer)) s.handle.releasePointerCapture(s.pointer);
    }

    function cancel() {
        const s = gesture;
        if (!s) return Promise.resolve();
        clear(s);
        return s.ready.then(accepted => accepted && call('EndPlaylistDrag', s.session));
    }

    function locate(s) {
        s.target = null;
        s.marker.hidden = true;
        const hit = document.elementFromPoint(s.x, s.y);
        const set = hit?.closest('[data-playlist-set]');
        if (!set || !root.contains(set)) return;
        const table = set.querySelector('.table-scroll');
        const end = set.querySelector('[data-playlist-end]');
        if (!table.contains(hit) && !end?.contains(hit)) return;
        const rows = [...set.querySelectorAll('[data-playlist-entry]')];
        const row = hit.closest('[data-playlist-entry]');
        let slot, y, bounds;
        if (row) {
            bounds = row.getBoundingClientRect();
            const after = s.y >= bounds.top + bounds.height / 2;
            slot = rows.indexOf(row) + (after ? 1 : 0);
            y = after ? bounds.bottom : bounds.top;
            const clip = table.getBoundingClientRect();
            bounds = { left: clip.left, right: clip.right };
        } else if (end?.contains(hit)) {
            slot = rows.length;
            bounds = end.getBoundingClientRect();
            y = bounds.top;
        } else {
            // Headers and unused table space are not insertion targets.
            return;
        }
        s.target = { set: set.dataset.playlistSet, slot };
        Object.assign(s.marker.style, { left: `${bounds.left}px`, top: `${y - 2}px`,
            width: `${bounds.right - bounds.left}px` });
        s.marker.hidden = false;
    }

    function activate(s) {
        s.active = true;
        s.row.classList.add('playlist-drag-source');
        const preview = document.createElement('div');
        preview.className = 'playlist-drag-preview';
        preview.setAttribute('aria-hidden', 'true');
        const table = document.createElement('table');
        table.className = 'table';
        const body = document.createElement('tbody');
        const clone = s.row.cloneNode(true);
        clone.removeAttribute('data-playlist-entry');
        clone.classList.remove('playlist-drag-source');
        clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
        clone.querySelectorAll('input, button, a').forEach(element => element.tabIndex = -1);
        body.append(clone); table.append(body); preview.append(table);
        preview.style.width = `${Math.min(s.row.getBoundingClientRect().width, innerWidth - 24)}px`;
        const marker = document.createElement('div');
        marker.className = 'playlist-drag-marker';
        marker.setAttribute('aria-hidden', 'true');
        s.preview = preview; s.marker = marker;
        (root.closest('.musicui-app') || document.body).append(preview, marker);
        tick();
    }

    const speed = (position, min, max) => position < min + 48
        ? -Math.ceil(14 * Math.max(0, 1 - (position - min) / 48))
        : position > max - 48 ? Math.ceil(14 * Math.max(0, 1 - (max - position) / 48)) : 0;

    function tick() {
        const s = gesture;
        if (!s?.active) return;
        if (!usable(s)) { void cancel(); return; }
        Object.assign(s.preview.style, { left: `${Math.max(8, Math.min(s.x + 14, innerWidth - 100))}px`,
            top: `${s.y + 14}px` });
        if (s.x >= 0 && s.x <= innerWidth && s.y >= 0 && s.y <= innerHeight) {
            window.scrollBy(0, speed(s.y, 0, innerHeight));
            const hit = document.elementFromPoint(s.x, s.y);
            const table = hit?.closest('.table-scroll');
            if (table && root.contains(table)) {
                const bounds = table.getBoundingClientRect();
                table.scrollLeft += speed(s.x, bounds.left, bounds.right);
            }
        }
        locate(s);
        frame = requestAnimationFrame(tick);
    }

    function down(event) {
        const handle = event.target.closest('.playlist-drag-handle');
        if (!handle || !root.contains(handle) || !enabled || gesture ||
            !event.isPrimary || event.button !== 0 || handle.disabled || handle.closest('[inert]')) return;
        event.preventDefault();
        // Flush an edited field before asking .NET whether a drag may start.
        if (root.contains(document.activeElement)) document.activeElement.blur();
        const row = handle.closest('[data-playlist-entry]');
        const s = { handle, row, pointer: event.pointerId, session: `${++sequence}`,
            x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
            active: false, accepted: false };
        gesture = s;
        handle.setPointerCapture(event.pointerId);
        s.ready = new Promise(resolve => requestAnimationFrame(resolve)).then(async () => {
            if (disposed || gesture !== s || !usable(s)) return false;
            const accepted = await call('BeginPlaylistDrag', s.session, row.dataset.playlistEntry);
            s.accepted = accepted;
            if (gesture === s) {
                if (!accepted) clear(s);
                else if (Math.hypot(s.x - s.startX, s.y - s.startY) >= 6) activate(s);
            }
            return accepted;
        });
    }

    function move(event) {
        const s = gesture;
        if (!s || event.pointerId !== s.pointer) return;
        event.preventDefault();
        s.x = event.clientX; s.y = event.clientY;
        if (!s.active && s.accepted && Math.hypot(s.x - s.startX, s.y - s.startY) >= 6) activate(s);
    }

    async function up(event) {
        const s = gesture;
        if (!s || event.pointerId !== s.pointer) return;
        s.x = event.clientX; s.y = event.clientY;
        const accepted = await s.ready;
        if (gesture !== s) return;
        if (s.active && usable(s)) locate(s);
        const target = s.active && usable(s) ? s.target : null;
        clear(s);
        if (!accepted) return;
        if (target) {
            try { await call('DropPlaylistSong', s.session, target.set, target.slot); }
            finally {
                if (s.handle.isConnected) s.handle.focus({ preventScroll: true });
            }
        } else await call('EndPlaylistDrag', s.session);
    }

    function pointerCancel(event) {
        if (gesture?.pointer === event.pointerId) void cancel();
    }
    function key(event) {
        if (event.key === 'Escape' && gesture) {
            event.preventDefault(); event.stopPropagation(); void cancel();
        }
    }
    function visibility() { if (document.hidden) void cancel(); }
    function click(event) {
        if (event.target.closest('.playlist-drag-handle')) event.preventDefault();
        else if (gesture) void cancel();
    }
    const observer = new MutationObserver(() => {
        if (gesture && !usable(gesture)) void cancel();
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['disabled', 'inert'] });
    root.addEventListener('pointerdown', down);
    root.addEventListener('click', click, true);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', pointerCancel);
    root.addEventListener('lostpointercapture', pointerCancel);
    document.addEventListener('keydown', key, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', cancel);
    window.addEventListener('pagehide', cancel);
    controllers.set(root, {
        update(value) { enabled = value; if (!enabled) return cancel(); },
        async dispose() {
            disposed = true;
            observer.disconnect();
            root.removeEventListener('pointerdown', down);
            root.removeEventListener('click', click, true);
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            document.removeEventListener('pointercancel', pointerCancel);
            root.removeEventListener('lostpointercapture', pointerCancel);
            document.removeEventListener('keydown', key, true);
            document.removeEventListener('visibilitychange', visibility);
            window.removeEventListener('blur', cancel);
            window.removeEventListener('pagehide', cancel);
            await cancel();
            controllers.delete(root);
        }
    });
    return controllers.get(root);
}
