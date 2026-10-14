import {prefix, storageKey, ownsKey, recoveryDatabase} from './storage_contract.js';
// Token-free import journal. IndexedDB avoids duplicating a large library inside
// localStorage's small quota; only Beta-owned records participate in recovery.
const DATABASE = recoveryDatabase;
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

const indexes = ['song_descriptors', 'playlist_descriptors'].map(storageKey);
const metadata = ['musicui_library_initialized', 'musicui_drive_sync'].map(storageKey);

function decode(raw) {
    try { return JSON.parse(JSON.parse(raw)); } catch { return null; }
}

// IDs historically use ticks; imported IDs can be arbitrary. Recognize those
// records by their shape too, without attempting to rebuild either index.
function libraryKeys() {
    const keys = new Set(indexes);
    for (const index of indexes) {
        const descriptors = decode(localStorage.getItem(index));
        if (Array.isArray(descriptors)) for (const descriptor of descriptors) {
            const id = descriptor?.ID;
            if (typeof id === 'string' && id !== 'settings' && !id.startsWith('musicui_')) keys.add(storageKey(id));
        }
    }
    for (const key of Object.keys(localStorage)) {
        if (!ownsKey(key)) continue;
        const logical = key.substring(prefix.length);
        if (logical === 'settings' || logical.startsWith('musicui_') || indexes.includes(key)) continue;
        if (/^\d+$/.test(logical)) { keys.add(key); continue; }
        const value = decode(localStorage.getItem(key));
        if (value && (Array.isArray(value.Tokens) || Array.isArray(value.PlaylistSets))) keys.add(key);
    }
    return keys;
}

export function hasLibraryRecords() {
    return [...libraryKeys()].some(key => !indexes.includes(key) && localStorage.getItem(key) !== null);
}

export function capture(stagedIds) {
    return result(async () => {
        const keys = new Set([...libraryKeys(), ...metadata, ...stagedIds.map(storageKey)]);
        const raw = Object.fromEntries([...keys].map(key => [key, localStorage.getItem(key)]));
        return { kind: 'raw', raw, stagedIds, connection: null };
    });
}

export function discard(backup) {
    return result(async () => {
        validateRaw(backup);
        for (const key of Object.keys(backup.raw)) if (!metadata.includes(key)) localStorage.removeItem(key);
        return null;
    });
}

export function restore(backup) {
    return result(async () => {
        validateRaw(backup);
        for (const [key, value] of Object.entries(backup.raw)) {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        }
        return null;
    });
}

function validateRaw(backup) {
    if (!backup || !backup.raw || typeof backup.raw !== 'object' || Array.isArray(backup.raw) ||
        Object.entries(backup.raw).some(([key, value]) => !ownsKey(key) || (value !== null && typeof value !== 'string')))
        throw new Error('Invalid recovery namespace');
}
