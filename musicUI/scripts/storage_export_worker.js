import {processFile} from './file_integrity.js?v=content-hash-v2';

export function prepareLibrary({header, songs, playlists}) {
    // Preferences belong to this browser, never to a shared library file.
    delete header.AppSettings;
    header.Songs = Object.create(null);
    header.Playlists = Object.create(null);
    function record(raw) {
        const value = JSON.parse(JSON.parse(raw));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record');
        return value;
    }
    for (const [id, raw] of songs) header.Songs[id] = record(raw);
    for (const [id, raw] of playlists) header.Playlists[id] = record(raw);
    // Compact UTF-8 keeps Unicode literal rather than expanding each character
    // into an escaped sequence, reducing bytes without changing version 1 data.
    return new TextEncoder().encode(JSON.stringify(header));
}

if (typeof self !== 'undefined') self.onmessage = async event => {
    try {
        const {operation, bytes, snapshot} = event.data;
        const result = await processFile(operation === 'export' ? prepareLibrary(snapshot) : bytes, operation !== 'verify');
        self.postMessage({ok:true,...result}, result.value ? [result.value.buffer] : []);
    } catch (error) {
        const invalid = error.name === 'Error';
        self.postMessage({ok:false,invalid,message:invalid ? error.message
            : 'The file worker could not prepare or verify the file. Allow Web Crypto and same-origin Web Workers, then retry.'});
    }
};
