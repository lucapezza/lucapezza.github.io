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

if (typeof self !== 'undefined') self.onmessage = event => {
    try {
        const bytes = prepareLibrary(event.data);
        self.postMessage({ok:true,value:bytes}, [bytes.buffer]);
    } catch {
        self.postMessage({ok:false,message:'A local music record is malformed. Restore local data before syncing.'});
    }
};
