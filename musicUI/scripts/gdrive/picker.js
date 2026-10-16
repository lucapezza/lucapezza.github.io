import { accessToken } from './auth.js';

let active = null;
function failure(message) { return Object.assign(new Error(message), { code: 'picker' }); }
function lockBackground() {
  // Picker focuses an iframe appended outside the app. Fix the page in place
  // so that browser focus scrolling cannot move the underlying library.
  const body = document.body;
  const root = document.documentElement;
  const x = window.scrollX, y = window.scrollY;
  const previousFocus = document.activeElement;
  const properties = ['position', 'top', 'left', 'width', 'overflow'];
  const saved = properties.map(name => [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)]);
  const rootOverflow = [root.style.getPropertyValue('overflow'), root.style.getPropertyPriority('overflow')];
  const rootScroll = [root.style.getPropertyValue('scroll-behavior'), root.style.getPropertyPriority('scroll-behavior')];
  root.style.setProperty('scroll-behavior', 'auto', 'important');
  root.style.setProperty('overflow', 'hidden', 'important');
  body.style.setProperty('position', 'fixed', 'important');
  body.style.setProperty('top', `${-y}px`, 'important');
  body.style.setProperty('left', `${-x}px`, 'important');
  body.style.setProperty('width', '100%', 'important');
  body.style.setProperty('overflow', 'hidden', 'important');
  return () => {
    for (const [name, value, priority] of saved) {
      if (value) body.style.setProperty(name, value, priority);
      else body.style.removeProperty(name);
    }
    if (rootOverflow[0]) root.style.setProperty('overflow', ...rootOverflow);
    else root.style.removeProperty('overflow');
    if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
    window.scrollTo(x, y);
    if (rootScroll[0]) root.style.setProperty('scroll-behavior', ...rootScroll);
    else root.style.removeProperty('scroll-behavior');
  };
}
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
    let unlock;
    let finished = false;
    const finish = (selection, error) => {
      if (finished) return;
      finished = true;
      try { instance?.dispose(); } catch { /* Release our references even if Google's cleanup fails. */ }
      instance = null; active = null;
      unlock?.();
      if (error) reject(error); else resolve(selection);
    };
    active = { finish };
    try {
      unlock = lockBackground();
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setMode(google.picker.DocsViewMode.LIST)
        .setQuery('.musicui')
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
