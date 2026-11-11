import { generatePassword } from './shared/generator';
import { anyUrlMatches, hostOf } from './shared/match';
import {
  AUTO_LOCK_MINUTES,
  NEVER_KEY,
  PENDING_KEY,
  PROMPT_MAX_AGE_MS,
  SESSION_KEY,
  type ContentRequest,
  type FrameRequest,
  type MatchesResponse,
  type PendingSave,
  type Snapshot,
  type TabMessage,
} from './shared/messages';

async function snapshot(): Promise<Snapshot | null> {
  const s = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as Snapshot | undefined;
  if (!s) return null;
  if (Date.now() - s.lastUsed > AUTO_LOCK_MINUTES * 60_000) {
    await chrome.storage.session.remove(SESSION_KEY);
    return null;
  }
  return s;
}

async function touch(s: Snapshot) {
  await chrome.storage.session.set({ [SESSION_KEY]: { ...s, lastUsed: Date.now() } });
}

async function setBadge(pending: boolean) {
  await chrome.action.setBadgeText({ text: pending ? '1' : '' });
  if (pending) await chrome.action.setBadgeBackgroundColor({ color: '#E2365F' });
}

async function neverHosts(): Promise<string[]> {
  return ((await chrome.storage.local.get(NEVER_KEY))[NEVER_KEY] as string[] | undefined) ?? [];
}

async function pending(): Promise<PendingSave | null> {
  return ((await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] as PendingSave | undefined) ?? null;
}

const extensionOrigin = chrome.runtime.getURL('');

async function handleFrame(msg: FrameRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tabId = sender.tab?.id;
  const send = (m: TabMessage) => (tabId === undefined ? Promise.resolve() : chrome.tabs.sendMessage(tabId, m, { frameId: 0 }).catch(() => undefined));
  switch (msg.type) {
    case 'closeSavePrompt':
      return send({ type: 'closeSave' });
    case 'resizeSavePrompt':
      return send({ type: 'resizeSave', height: Math.min(Math.max(msg.height, 80), 480) });
    case 'neverSave': {
      const p = await pending();
      const host = p ? hostOf(p.url) : null;
      if (host) await chrome.storage.local.set({ [NEVER_KEY]: [...new Set([...(await neverHosts()), host])] });
      await chrome.storage.session.remove(PENDING_KEY);
      return send({ type: 'closeSave' });
    }
  }
}

async function handle(msg: ContentRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const pageUrl = sender.tab?.url ?? sender.url ?? '';
  if (!sender.tab || sender.frameId !== 0) return null;

  switch (msg.type) {
    case 'matches': {
      const s = await snapshot();
      if (!s) return { locked: true } satisfies MatchesResponse;
      await touch(s);
      const matches = s.logins
        .filter((l) => l.password && anyUrlMatches(pageUrl, l.urls))
        .map(({ vaultId, id, title, username }) => ({ vaultId, id, title, username }));
      return { locked: false, matches } satisfies MatchesResponse;
    }
    case 'credentials': {
      const s = await snapshot();
      const login = s?.logins.find((l) => l.vaultId === msg.vaultId && l.id === msg.id);
      if (!s || !login || !anyUrlMatches(pageUrl, login.urls)) return null;
      await touch(s);
      return { username: login.username, password: login.password };
    }
    case 'submitted': {
      const host = hostOf(pageUrl);
      if (!msg.password || !host || (await neverHosts()).includes(host)) return null;
      const s = await snapshot();
      const known = s?.logins.some(
        (l) => anyUrlMatches(pageUrl, l.urls) && l.password === msg.password && (!msg.username || l.username === msg.username),
      );
      if (known) return null;
      const pending: PendingSave = { url: pageUrl, username: msg.username, password: msg.password, at: Date.now() };
      await chrome.storage.session.set({ [PENDING_KEY]: pending });
      await setBadge(true);
      return null;
    }
    case 'generate':
      return { password: generatePassword() };
    case 'pendingForPage': {
      const p = await pending();
      const show = !!p && hostOf(p.url) === hostOf(pageUrl) && Date.now() - p.at < PROMPT_MAX_AGE_MS;
      return { show };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: ContentRequest | FrameRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const fromExtensionPage = sender.url?.startsWith(extensionOrigin) ?? false;
  const work = fromExtensionPage ? handleFrame(msg as FrameRequest, sender) : handle(msg as ContentRequest, sender);
  work.then(sendResponse, () => sendResponse(null));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && PENDING_KEY in changes) void setBadge(changes[PENDING_KEY]?.newValue !== undefined);
});

chrome.alarms.create('auto-lock', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-lock') void snapshot();
});
