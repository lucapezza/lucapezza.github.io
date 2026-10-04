import { accessToken } from './auth.js';

export const MAX_BYTES = 20_480_000;
const BASE = 'https://www.googleapis.com';
function failure(code, message, status) { return Object.assign(new Error(message), { code, status }); }
async function request(path, options = {}, writing = false) {
  const token = accessToken();
  let response;
  try {
    response = await fetch(`${BASE}${path}`, { ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
      cache: 'no-store', credentials: 'omit', redirect: 'error' });
  } catch (error) {
    if (error.name === 'AbortError' && !writing) throw error;
    throw failure(writing ? 'save-unknown' : 'network', writing
      ? options.signal?.reason?.name === 'TimeoutError'
        ? 'Save result unknown. The upload timed out after two minutes; the file may have been saved. Your local changes are retained.'
        : 'Save result unknown. The connection was interrupted; the file may have been saved. Your local changes are retained. Retry explicitly when connected.'
      : 'Network request failed. Check your connection and try again.');
  }
  if (response.ok) return response;
  const status = response.status;
  const messages = {
    401: ['unauthorized', 'Authorization expired or was revoked. Reconnect to continue.'],
    403: ['forbidden', 'Drive denied this request. File permissions, account policy, or quota may have changed.'],
    404: ['unavailable', 'The file is unavailable. It may have been deleted or access may have changed.'],
    429: ['quota', 'Google Drive is receiving too many requests. Wait and try again.'],
  };
  const [code, message] = messages[status] || (writing && status >= 500
    ? ['save-unknown', 'Save result unknown. Google Drive encountered a server error. Your local changes are retained; retry explicitly.']
    : ['drive', `Google Drive request failed (HTTP ${status}). Please try again.`]);
  throw failure(code, message, status);
}
export async function getMetadata(id, signal) {
  if (typeof id !== 'string' || !id) throw failure('file', 'Picker did not return a valid file.');
  const fields = 'id,name,mimeType,size,modifiedTime,trashed,capabilities(canEdit,canDownload)';
  const response = await request(`/drive/v3/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`, { signal });
  const file = await response.json();
  if (file.id !== id || typeof file.name !== 'string') throw failure('file', 'Drive returned incomplete file information.');
  if (file.trashed) throw failure('unavailable', 'This file is in the trash. Restore it in Google Drive first.');
  if (!['text/plain', 'application/json', 'application/octet-stream'].includes(file.mimeType) || !file.name.toLowerCase().endsWith('.musicui')) throw failure('type', 'Select an ordinary .musicui file. Google Docs, shortcuts, and other formats are not supported.');
  if (file.capabilities?.canDownload !== true) throw failure('forbidden', 'This file cannot be downloaded with your current permissions.');
  const size = Number(file.size);
  if (!Number.isFinite(size) || size < 0) throw failure('file', 'Drive did not return a valid file size.');
  if (size > MAX_BYTES) throw failure('size', 'This file exceeds the 20,480,000-byte limit.');
  if (typeof file.modifiedTime !== 'string' || !Number.isFinite(Date.parse(file.modifiedTime))) throw failure('file', 'Drive returned an invalid modification timestamp.');
  return { id, name: file.name, modifiedTime: file.modifiedTime, mimeType: file.mimeType, size, canEdit: file.capabilities?.canEdit === true };
}
export function decodeText(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw failure('encoding', 'This file is not valid UTF-8 text.'); }
  if (text.includes('\0')) throw failure('encoding', 'This file contains NUL bytes and cannot be edited as plain text.');
  return text;
}
export async function download(id, signal) {
  const response = await request(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { signal });
  if (!response.body) throw failure('network', 'The browser did not provide a download stream. Please try again.');
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw failure('size', 'This file exceeds the 20,480,000-byte limit.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error.code || error.name === 'AbortError') throw error;
    throw failure('network', 'The download was interrupted. Please try again.');
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return decodeText(bytes);
}
export async function save(id, text, signal) {
  if (text.includes('\0')) throw failure('encoding', 'Remove NUL characters before saving.');
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_BYTES) throw failure('size', 'The edited text exceeds the 20,480,000-byte limit.');
  const response = await request(`/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=id,name,mimeType,size,modifiedTime`, {
    method: 'PATCH', headers: { 'Content-Type': 'text/plain; charset=UTF-8' }, body: bytes, signal,
  }, true);
  try {
    const result = await response.json();
    if (result.id !== id || typeof result.name !== 'string' || typeof result.modifiedTime !== 'string' || !Number.isFinite(Date.parse(result.modifiedTime))) throw new Error();
    return result;
  } catch {
    throw failure('save-unknown', 'Save result unknown. Drive did not return the expected confirmation. Your local changes are retained.');
  }
}
