// Capture immutable strings together; parse/serialize the large library off the UI thread.
export function exportLibrary(headerBytes) {
    try {
        const header = JSON.parse(new TextDecoder().decode(headerBytes));
        const songs = header.SongDescriptors.map(item => [item.ID, localStorage.getItem(item.ID)]);
        const playlists = header.PlaylistDescriptors.map(item => [item.ID, localStorage.getItem(item.ID)]);
        if ([...songs, ...playlists].some(([, value]) => value === null))
            return Promise.resolve({ok:false, message:'A local music record is missing. Restore local data before syncing.'});
        return new Promise(resolve => {
            let worker;
            let timer;
            let finished = false;
            function finish(value) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                worker?.terminate();
                resolve(value);
            }
            try {
                worker = new Worker(new URL('./storage_export_worker.js', import.meta.url), {type:'module'});
                timer = setTimeout(() => finish({ok:false,message:'Preparing the library took too long. Local changes remain pending.'}), 60_000);
                worker.onmessage = event => finish(event.data);
                worker.onerror = () => finish({ok:false,message:'The browser could not prepare the library. Allow same-origin Web Workers and retry.'});
                worker.postMessage({header, songs, playlists});
            } catch {
                finish({ok:false,message:'The browser could not prepare the library. Allow same-origin Web Workers and browser storage, then retry.'});
            }
        });
    } catch {
        return Promise.resolve({ok:false,message:'Browser storage could not be read. Local changes remain pending.'});
    }
}
