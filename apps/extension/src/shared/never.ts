import { NEVER_KEY } from './messages';

export async function neverHosts(): Promise<string[]> {
  const list = (await chrome.storage.local.get(NEVER_KEY))[NEVER_KEY];
  return Array.isArray(list) ? list.filter((h): h is string => typeof h === 'string') : [];
}

export async function addNever(host: string) {
  await chrome.storage.local.set({ [NEVER_KEY]: [...new Set([...(await neverHosts()), host])] });
}

export async function removeNever(host: string) {
  await chrome.storage.local.set({ [NEVER_KEY]: (await neverHosts()).filter((h) => h !== host) });
}

export function onNeverChange(listener: (hosts: string[]) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && NEVER_KEY in changes) void neverHosts().then(listener);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
