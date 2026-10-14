import {storageKey} from './storage_contract.js';
// Always read storage. Transfer only strings the caller has not already seen;
// large unchanged indexes are expensive to deserialize across the WASM bridge.
const session = crypto.randomUUID();
let songs;
let playlists;
let songVersion = 0;
let playlistVersion = 0;

// Fresh installations have no library keys yet. Roll back partial initialization
// if a quota/access failure occurs between writes, so a retry stays safe.
export function initializeEmpty() {
    const keys = ['song_descriptors', 'playlist_descriptors', 'musicui_library_initialized'];
    try {
        if (keys.some(key => localStorage.getItem(storageKey(key)) !== null)) return true;
        try {
            localStorage.setItem(storageKey(keys[0]), '"[]"');
            localStorage.setItem(storageKey(keys[1]), '"[]"');
            localStorage.setItem(storageKey(keys[2]), 'true');
            return true;
        } catch {
            for (const key of keys) {
                try { localStorage.removeItem(storageKey(key)); } catch { }
            }
            return false;
        }
    } catch { return false; }
}

export function read(knownSession, knownSongVersion, knownPlaylistVersion) {
    try {
        const nextSongs = localStorage.getItem(storageKey('song_descriptors'));
        const nextPlaylists = localStorage.getItem(storageKey('playlist_descriptors'));
        const initialized = localStorage.getItem(storageKey('musicui_library_initialized')) !== null;
        if (nextSongs !== songs) { songs = nextSongs; songVersion++; }
        if (nextPlaylists !== playlists) { playlists = nextPlaylists; playlistVersion++; }
        const songsChanged = knownSession !== session || knownSongVersion !== songVersion;
        const playlistsChanged = knownSession !== session || knownPlaylistVersion !== playlistVersion;
        return {
            ok: true,
            session, songVersion, playlistVersion, songsChanged, playlistsChanged,
            songs: songsChanged ? songs : null,
            playlists: playlistsChanged ? playlists : null,
            initialized
        };
    } catch {
        return { ok: false, message: 'Browser library indexes could not be read. Restore browser storage access, then recheck the library.' };
    }
}
