import { accessToken } from './auth.js';

let active = null;
function failure(message) { return Object.assign(new Error(message), { code: 'picker' }); }
export function initialize() {
  return new Promise((resolve, reject) => {
    try {
      gapi.load('picker', { callback: resolve,
        onerror: () => reject(new Error('Google Picker could not load. Reload the page to retry.')),
        timeout: 15_000, ontimeout: () => reject(new Error('Google Picker timed out. Reload the page to retry.')) });
    } catch { reject(new Error('Google Picker could not initialize. Reload the page to retry.')); }
  });
}
export function close() { active?.finish(null); }
export function choose(config) {
  if (active) return Promise.reject(new Error('A file selection is already open.'));
  return new Promise((resolve, reject) => {
    let instance;
    let finished = false;
    const finish = (selection, error) => {
      if (finished) return;
      finished = true;
      try { instance?.dispose(); } catch { /* Release our references even if Google's cleanup fails. */ }
      instance = null; active = null;
      if (error) reject(error); else resolve(selection);
    };
    active = { finish };
    try {
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setMode(google.picker.DocsViewMode.LIST)
        .setMimeTypes('text/plain,application/json,application/octet-stream').setIncludeFolders(false).setSelectFolderEnabled(false);
      instance = new google.picker.PickerBuilder()
        .setDeveloperKey(config.pickerApiKey).setAppId(config.googleCloudProjectNumber)
        .setOAuthToken(accessToken()).setOrigin(location.origin).addView(view)
        .setCallback((data) => {
          if (data.action === google.picker.Action.CANCEL) finish(null);
          else if (data.action === google.picker.Action.PICKED) {
            const doc = data.docs?.[0];
            if (typeof doc?.id !== 'string' || !doc.id) finish(null, failure('Google Picker did not return a file. Try again.'));
            else finish({ id: doc.id });
          }
        }).build();
      instance.setVisible(true);
    } catch (error) {
      finish(null, error.code === 'unauthorized' ? error : failure('Google Picker could not open. Check the API key restrictions and try again.'));
    }
  });
}
