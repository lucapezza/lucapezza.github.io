// Keep these values aligned with Model/StorageNamespace.cs.
export const prefix = 'musicui-v2:';
export const recoveryDatabase = 'musicui-v2-recovery';
export const sessionLock = 'musicui-v2-active-session';
export const storageKey = logicalKey => prefix + logicalKey;
export const ownsKey = key => typeof key === 'string' && key.startsWith(prefix);
