const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.profile',
];
let clientId;
let credential = null;
let pending = null;
let epoch = 0;

function failure(code, message) { return Object.assign(new Error(message), { code }); }
export function initialize(value) { clientId = value; }
function finishError(error) {
  if (!pending) return;
  const request = pending; pending = null; clearTimeout(request.timer);
  request.reject(error);
}
async function handleToken(response, request) {
  if (pending !== request || request.epoch !== epoch) return;
  // Claim the callback once; keep pending while fetching the profile.
  if (request.handling) return;
  request.handling = true;
  if (response.error || !response.access_token) {
    finishError(failure('authorization', 'Google authorization failed. Please connect again.')); return;
  }
  if (!google.accounts.oauth2.hasGrantedAllScopes(response, ...SCOPES)) {
    finishError(failure('authorization', 'Both selected-file access and basic profile access are required. Please connect again.')); return;
  }
  const expiresIn = Number(response.expires_in);
  const expiresAt = Date.now() + expiresIn * 1000;
  try {
    if (!Number.isFinite(expiresIn) || expiresIn <= 60) throw failure('authorization', 'Google returned an unusable authorization lifetime. Please connect again.');
    const result = await fetch('https://www.googleapis.com/oauth2/v2/userinfo?fields=id,name,picture', {
      headers: { Authorization: `Bearer ${response.access_token}` }, signal: request.controller.signal,
      cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
    if (!result.ok) throw failure('authorization', 'Could not obtain your Google profile. Please connect again.');
    const profile = await result.json();
    if (typeof profile.id !== 'string' || !profile.id) throw failure('authorization', 'Google profile information is incomplete. Please connect again.');
    if (request.epoch !== epoch || pending !== request) return;
    if (request.accountId && request.accountId !== profile.id) {
      throw failure('account-changed', 'A different Google account was selected. Reconnect with the original account, or disconnect and discard this draft before switching accounts.');
    }
    credential = { token: response.access_token, expiresAt };
    pending = null; clearTimeout(request.timer);
    request.resolve({ id: profile.id, name: typeof profile.name === 'string' ? profile.name : 'Google user',
      picture: typeof profile.picture === 'string' ? profile.picture : '' });
  } catch (error) {
    if (request.epoch !== epoch || pending !== request) return;
    finishError(error.code ? error : failure('authorization', 'Could not obtain your Google profile. Check your connection and try again.'));
  }
}
export function hasUsableToken() { return Boolean(credential && Date.now() < credential.expiresAt - 60_000); }
export function accessToken() {
  if (!hasUsableToken()) throw failure('unauthorized', 'Authorization expired. Reconnect to continue.');
  return credential.token;
}
export function invalidate() { credential = null; }
// Call directly from a click handler, before any asynchronous work.
export function authorize(accountId = null) {
  if (pending) return Promise.reject(failure('authorization', 'A Google connection is already in progress.'));
  credential = null;
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const request = { resolve, reject, accountId, controller, epoch, handling: false };
    pending = request;
    request.timer = setTimeout(() => {
      controller.abort();
      finishError(failure('authorization', 'Google connection timed out. Please try again.'));
    }, 120_000);
    try {
      // A fresh client binds callbacks to this attempt; old popups cannot
      // complete a later connection after disconnect or timeout.
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPES.join(' '), include_granted_scopes: false,
        callback: (response) => handleToken(response, request),
        error_callback: () => {
          if (pending === request) finishError(failure('authorization', 'Connection cancelled or the Google popup could not open. Allow popups and try again.'));
        },
      });
      client.requestAccessToken({ prompt: accountId ? '' : 'select_account',
        ...(accountId ? { login_hint: accountId } : {}), include_granted_scopes: false });
    } catch {
      finishError(failure('authorization', 'Could not open Google authorization. Please try again.'));
    }
  });
}
export function disconnect() {
  epoch += 1;
  if (pending) {
    pending.controller.abort();
    finishError(failure('cancelled', 'Disconnected.'));
  }
  let token = credential?.token;
  credential = null;
  if (!token) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (success) => { if (settled) return; settled = true; clearTimeout(timer); token = null; resolve(success); };
    const timer = setTimeout(() => done(false), 10_000);
    try { google.accounts.oauth2.revoke(token, (result) => done(result.successful === true)); }
    catch { done(false); }
  });
}

export function cancelAuthorization() {
  epoch += 1;
  if (pending) {
    pending.controller.abort();
    finishError(failure('cancelled', 'Google authorization was cancelled.'));
  }
}
