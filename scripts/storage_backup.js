// Token-free import journal. IndexedDB avoids duplicating a large library inside
// localStorage's small quota; music records and Drive metadata keep their old keys.
const DATABASE = 'musicui-recovery';
const STORE = 'imports';
const KEY = 'pending';

function open() {
    return new Promise((resolve, reject) => {
        let finished = false;
        const timer = setTimeout(() => finish(null, new Error('blocked')), 15000);
        function finish(db, error) {
            if (finished) { db?.close(); return; }
            finished = true; clearTimeout(timer);
            if (error) reject(error); else resolve(db);
        }
        let request;
        try { request = indexedDB.open(DATABASE, 1); }
        catch (error) { finish(null, error); return; }
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => finish(request.result);
        request.onerror = () => finish(null, request.error);
    });
}

async function transaction(mode, operation) {
    const db = await open();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            let value = null;
            const timer = setTimeout(() => { try { tx.abort(); } catch {} }, 15000);
            tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
            tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error || new Error('storage')); };
            const request = operation(tx.objectStore(STORE));
            request.onsuccess = () => { value = request.result ?? null; };
        });
    } finally { db.close(); }
}

async function result(operation) {
    try { return { ok: true, value: await operation() }; }
    catch (error) {
        return { ok: false, value: null, message: error?.name === 'QuotaExceededError'
            ? 'Browser recovery storage is full. Free browser storage before retrying; no replacement was started.'
            : 'Browser import recovery storage is unavailable. Allow IndexedDB/browser storage and retry.' };
    }
}

export function save(backup) { return result(async () => { await transaction('readwrite', store => store.put(backup, KEY)); return null; }); }
export function load() { return result(() => transaction('readonly', store => store.get(KEY))); }
export function clear() { return result(async () => { await transaction('readwrite', store => store.delete(KEY)); return null; }); }
