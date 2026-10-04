import config from './config.js';
import * as auth from './auth.js';
import * as picker from './picker.js';
import * as drive from './drive.js';

let ready;
let controller;
let listener;
let reference;
let lastOpportunity = 0;
const failure = (code, message) => Object.assign(new Error(message), { code });

function loadScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timer = setTimeout(() => finish(false), 20_000);
        function finish(ok) {
            clearTimeout(timer); script.onload = null; script.onerror = null;
            if (ok) resolve(); else reject(failure('setup', 'Google libraries could not load. Check your connection and reload.'));
        }
        script.onload = () => finish(true); script.onerror = () => finish(false);
        script.src = url; script.async = true; document.head.append(script);
    });
}

function initialize() {
    return ready ??= (async () => {
        if (!location.protocol.startsWith('https') && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname))
            throw failure('setup', 'Google Drive requires HTTPS outside localhost.');
        if (!/^\d+[-\w]*\.apps\.googleusercontent\.com$/.test(config.oauthClientId) ||
            !/^\d+$/.test(config.googleCloudProjectNumber) || !/^AIza[\w-]+$/.test(config.pickerApiKey))
            throw failure('setup', 'Google Drive is not configured. Follow GOOGLE_SETUP.md.');
        await Promise.all([loadScript('https://accounts.google.com/gsi/client'), loadScript('https://apis.google.com/js/api.js')]);
        auth.initialize(config.oauthClientId);
        await picker.initialize();
    })();
}

async function result(operation) {
    try { return { ok: true, value: await operation() }; }
    catch (error) {
        if (error.code === 'unauthorized') auth.invalidate();
        return { ok: false, code: error.code || 'network', message: error.code ? error.message :
            error.name === 'AbortError' ? 'The Google request was cancelled or timed out.' : 'The Google request could not complete. Check your connection and try again.' };
    }
}

async function request(operation, timeout = 30_000) {
    controller = new AbortController();
    const current = controller;
    const timer = setTimeout(() => current.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
    try { return await operation(current.signal); }
    finally { clearTimeout(timer); if (controller === current) controller = null; }
}

function safePicture(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com')) ? url.href : '';
    } catch { return ''; }
}

export function login(accountId) {
    return result(async () => {
        await initialize();
        const profile = await auth.authorize(accountId);
        return { ...profile, picture: safePicture(profile.picture) };
    });
}
export function logout() {
    return result(async () => {
        cancel();
        if (!await auth.disconnect()) throw failure('revocation', 'Disconnected locally; Google consent revocation could not be confirmed. Check Google Account connections if needed.');
        return true;
    });
}
export function pick() { return result(async () => { await initialize(); return (await picker.choose(config))?.id ?? null; }); }
export function metadata(id) { return result(() => request(signal => drive.getMetadata(id, signal))); }
export function download(id) {
    return result(() => request(async signal => new TextEncoder().encode(await drive.download(id, signal))));
}
export function upload(id, bytes) {
    return result(() => request(signal => drive.save(id, drive.decodeText(bytes), signal), 120_000));
}
export function cancel() { controller?.abort(); picker.close(); auth.cancelAuthorization(); }
export function listen(dotnetReference) {
    reference = dotnetReference;
    initialize().catch(() => {});
    if (listener) return;
    listener = () => {
        if (document.visibilityState === 'hidden' || Date.now() - lastOpportunity < 2_000) return;
        lastOpportunity = Date.now();
        reference?.invokeMethodAsync('OnOpportunity').catch(() => {});
    };
    window.addEventListener('online', listener); window.addEventListener('focus', listener);
    document.addEventListener('visibilitychange', listener);
}
export function dispose() {
    cancel(); reference = null;
    if (listener) {
        window.removeEventListener('online', listener); window.removeEventListener('focus', listener);
        document.removeEventListener('visibilitychange', listener); listener = null;
    }
}
