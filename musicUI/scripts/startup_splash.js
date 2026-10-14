// Only the initial HTML splash uses this gate. SPA navigation never replays it.
(() => {
    const image = document.getElementById('startup-logo');
    const status = document.getElementById('startup-status');
    const message = document.getElementById('startup-message');
    let scheduled = false;
    let starting;
    let runtimeHold;
    let finish;
    const minimumVisible = new Promise(resolve => { finish = resolve; });

    function startClock() {
        if (scheduled) return;
        scheduled = true;
        // Let the decoded image paint before counting its visible duration.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            setTimeout(() => {
                if (message) message.textContent = 'Getting things ready...';
                if (status) status.classList.remove('startup-status-pending');
                // Give the message at least 100ms and a paint opportunity before
                // runtime startup can occupy the browser thread.
                const delay = new Promise(resolve => setTimeout(resolve, 100));
                const paint = new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                Promise.all([delay, paint]).then(finish);
            }, 3100);
        }));
    }

    window.musicuiStartup = {
        runtimeStarted() {
            // Called by the .NET entry point, before root components are mounted.
            if (!runtimeHold) runtimeHold = new Promise(resolve => setTimeout(resolve, 1000));
            return runtimeHold;
        },
        startBlazor() {
            // The framework script disables autostart; start it exactly once.
            if (!starting) starting = minimumVisible.then(() => window.Blazor.start());
            return starting;
        }
    };

    if (!image || image.complete) startClock();
    else {
        image.addEventListener('load', startClock, { once: true });
        // A missing image must not trap the user on the splash forever.
        image.addEventListener('error', startClock, { once: true });
    }
})();
