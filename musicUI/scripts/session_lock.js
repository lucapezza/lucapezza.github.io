import {sessionLock} from './storage_contract.js';
let acquisition;
let owned = false;

// Ownership lasts until document destruction, including while hidden.
window.addEventListener('pageshow', event => {
    if (event.persisted) window.location.reload();
}, { capture: true });

export function acquire() {
    if (owned) return Promise.resolve('acquired');
    if (acquisition) return acquisition;
    if (!navigator.locks?.request) return Promise.resolve('unsupported');
    acquisition = new Promise((resolve, reject) => {
        navigator.locks.request(sessionLock, { mode: 'exclusive', ifAvailable: true }, lock => {
            if (!lock) { resolve('blocked'); return; }
            owned = true;
            resolve('acquired');
            return new Promise(() => {});
        }).catch(reject);
    }).finally(() => { acquisition = null; });
    return acquisition;
}
