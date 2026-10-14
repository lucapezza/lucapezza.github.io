import {storageKey} from './storage_contract.js';
// Capture immutable strings on the UI thread; process their contents in a worker.
const snapshots = new Map();
const operations = new Set();
let nextToken = 0;
export function captureLibrary(headerBytes) {
    try {
        const header = JSON.parse(new TextDecoder().decode(headerBytes));
        const songs = header.SongDescriptors.map(item => [item.ID, localStorage.getItem(storageKey(item.ID))]);
        const playlists = header.PlaylistDescriptors.map(item => [item.ID, localStorage.getItem(storageKey(item.ID))]);
        if ([...songs, ...playlists].some(([, value]) => value === null))
            return {ok:false,message:'A local music record is missing. Restore local data before syncing.'};
        const token = String(++nextToken);
        snapshots.set(token, {header, songs, playlists});
        return {ok:true,token};
    } catch {
        return {ok:false,message:'Browser storage could not be read. Local changes remain pending.'};
    }
}
export function releaseSnapshot(token) { snapshots.delete(token); }
function run(message) {
    return new Promise(resolve => {
        let worker, timer, finished = false;
        function finish(value) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            operations.delete(cancel);
            worker?.terminate();
            resolve(value);
        }
        function cancel() { finish({ok:false,cancelled:true,message:'File preparation was cancelled. Local changes remain pending.'}); }
        operations.add(cancel);
        try {
            worker = new Worker(new URL('./storage_export_worker.js?v=content-hash-v2', import.meta.url), {type:'module'});
            timer = setTimeout(() => finish({ok:false,message:'Preparing or verifying the file took too long. Local changes remain pending.'}), 60_000);
            worker.onmessage = event => finish(event.data);
            worker.onerror = () => finish({ok:false,message:'The file worker failed. Allow same-origin Web Workers and retry.'});
            worker.postMessage(message);
        } catch {
            finish({ok:false,message:'The file worker could not start. Allow same-origin Web Workers and retry.'});
        }
    });
}
export function prepareSnapshot(token) {
    const snapshot = snapshots.get(token);
    snapshots.delete(token);
    if (!snapshot) return Promise.resolve({ok:false,message:'The captured library snapshot is no longer available.'});
    return run({operation:'export',snapshot});
}
export function verifyFile(bytes) { return run({operation:'verify',bytes}); }
export function prepareFile(bytes) { return run({operation:'prepare',bytes}); }
export function cancelAll() {
    snapshots.clear();
    for (const cancel of [...operations]) cancel();
}
export function exportLibrary(headerBytes) {
    const captured = captureLibrary(headerBytes);
    return captured.ok ? prepareSnapshot(captured.token) : Promise.resolve(captured);
}
