export const MAX_BYTES = 20_480_000;

// Preserve number tokens and detect duplicate names before JSON.parse loses them.
export function parseFile(text) {
    let offset = 0;
    const fail = () => { throw new Error('The file contains invalid JSON.'); };
    function space() { while (/[\x20\t\r\n]/.test(text[offset] || '\0')) offset++; }
    function string() {
        const start = offset++;
        while (offset < text.length) {
            const character = text[offset++];
            if (character === '"') {
                try { return JSON.parse(text.slice(start, offset)); } catch { fail(); }
            }
            if (character === '\\') offset++;
        }
        fail();
    }
    function value(depth = 0) {
        if (depth > 128) throw new Error('The file contains excessively nested JSON.');
        space();
        const character = text[offset];
        if (character === '"') return {kind:'string', value:string()};
        if (character === '{') {
            offset++; space();
            const entries = [], names = new Set();
            if (text[offset] === '}') { offset++; return {kind:'object', entries}; }
            for (;;) {
                space(); if (text[offset] !== '"') fail();
                const name = string();
                if (names.has(name)) throw new Error('The file contains duplicate JSON property names.');
                names.add(name); space(); if (text[offset++] !== ':') fail();
                entries.push([name, value(depth + 1)]); space();
                const end = text[offset++];
                if (end === '}') return {kind:'object', entries};
                if (end !== ',') fail();
            }
        }
        if (character === '[') {
            offset++; space(); const items = [];
            if (text[offset] === ']') { offset++; return {kind:'array', items}; }
            for (;;) {
                items.push(value(depth + 1)); space(); const end = text[offset++];
                if (end === ']') return {kind:'array', items};
                if (end !== ',') fail();
            }
        }
        const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(offset));
        if (!token) fail();
        offset += token[0].length;
        return {kind:/^(true|false|null)$/.test(token[0]) ? 'literal' : 'number', value:token[0]};
    }
    const root = value(); space();
    if (offset !== text.length || root.kind !== 'object') fail();
    return root;
}

export function normalizeNumber(token) {
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
    let digits = (match[2] + (match[3] || '')).replace(/^0+/, '');
    if (!digits) return '0';
    let exponent = BigInt(match[4] || '0') - BigInt((match[3] || '').length);
    const trailing = /0+$/.exec(digits)?.[0].length || 0;
    digits = digits.slice(0, digits.length - trailing);
    exponent += BigInt(trailing);
    return `${match[1]}${digits}e${exponent}`;
}

function serialize(node, canonical, root = false) {
    switch (node.kind) {
        case 'string': return JSON.stringify(node.value);
        case 'literal': return node.value;
        case 'number': return canonical ? normalizeNumber(node.value) : node.value;
        case 'array': return '[' + node.items.map(item => serialize(item, canonical)).join(',') + ']';
        case 'object': {
            let entries = node.entries.filter(([name]) => !(canonical && root && name === 'ContentHash'));
            if (canonical) entries = [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
            return '{' + entries.map(([name, item]) => JSON.stringify(name) + ':' + serialize(item, canonical)).join(',') + '}';
        }
    }
}

export function canonicalize(text) { return serialize(parseFile(text), true, true); }

export async function processFile(bytes, prepare = false) {
    if (bytes.byteLength > MAX_BYTES) throw new Error('The file exceeds the 20,480,000-byte limit.');
    let text;
    try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
    catch { throw new Error('The file contains invalid UTF-8.'); }
    const root = parseFile(text);
    if (prepare) root.entries = root.entries.filter(([name]) => name !== 'ContentHash' && name !== 'DrivePushId');
    const declared = root.entries.find(([name]) => name === 'ContentHash')?.[1];
    if (!prepare && declared && (declared.kind !== 'string' || !/^[a-f0-9]{64}$/.test(declared.value)))
        throw new Error('The file contains an invalid ContentHash.');
    const canonical = new TextEncoder().encode(serialize(root, true, true));
    const digest = await crypto.subtle.digest('SHA-256', canonical);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (!prepare && declared && declared.value !== hash)
        throw new Error('The file ContentHash does not match its contents. Local data was retained.');
    if (!prepare) return {hash};
    root.entries.push(['ContentHash', {kind:'string', value:hash}]);
    const value = new TextEncoder().encode(serialize(root, false));
    if (value.byteLength > MAX_BYTES) throw new Error('The file exceeds the 20,480,000-byte limit including ContentHash.');
    return {value, hash};
}
