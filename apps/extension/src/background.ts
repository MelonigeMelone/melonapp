import { generatePassword } from './shared/generator';
import { anyUrlMatches, hostOf } from './shared/match';
import {
  AUTO_LOCK_MINUTES,
  PENDING_KEY,
  SESSION_KEY,
  type ContentRequest,
  type MatchesResponse,
  type PendingSave,
  type Snapshot,
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
      if (!msg.password || !hostOf(pageUrl)) return null;
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
  }
}

chrome.runtime.onMessage.addListener((msg: ContentRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg, sender).then(sendResponse, () => sendResponse(null));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && PENDING_KEY in changes) void setBadge(changes[PENDING_KEY]?.newValue !== undefined);
});

chrome.alarms.create('auto-lock', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-lock') void snapshot();
});
