import { parseTotp, totpCode } from '@web/vault/totp';
import { generatePassword } from './shared/generator';
import { anyUrlMatches, hostOf, siteOf } from './shared/match';
import {
  AUTO_LOCK_MINUTES,
  FLOW_MAX_AGE_MS,
  FLOWS_KEY,
  PENDING_KEY,
  PROMPT_MAX_AGE_MS,
  SESSION_KEY,
  type ContentRequest,
  type Flow,
  type FrameRequest,
  type MatchesResponse,
  type PendingSave,
  type Snapshot,
  type TabMessage,
} from './shared/messages';
import { addNever, neverHosts } from './shared/never';

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
  if (pending) await chrome.action.setBadgeBackgroundColor({ color: '#5B45F0' });
}

async function pending(): Promise<PendingSave | null> {
  return ((await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] as PendingSave | undefined) ?? null;
}

const extensionOrigin = chrome.runtime.getURL('');

async function flows(): Promise<Record<string, Flow>> {
  return ((await chrome.storage.session.get(FLOWS_KEY))[FLOWS_KEY] as Record<string, Flow> | undefined) ?? {};
}

async function flowFor(tabId: number, pageUrl: string): Promise<Flow | null> {
  const f = (await flows())[String(tabId)];
  return f && f.site === siteOf(pageUrl) && Date.now() - f.at < FLOW_MAX_AGE_MS ? f : null;
}

async function updateFlow(tabId: number, pageUrl: string, patch: Partial<Flow>) {
  const site = siteOf(pageUrl);
  if (!site) return;
  const all = await flows();
  const previous = all[String(tabId)];
  const base = previous && previous.site === site && Date.now() - previous.at < FLOW_MAX_AGE_MS ? previous : { site, at: 0 };
  const fresh = Object.fromEntries(Object.entries(all).filter(([, f]) => Date.now() - f.at < FLOW_MAX_AGE_MS));
  await chrome.storage.session.set({ [FLOWS_KEY]: { ...fresh, [String(tabId)]: { ...base, ...patch, site, at: Date.now() } } });
}

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
      if (host) await addNever(host);
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
      const flow = await flowFor(sender.tab.id ?? -1, pageUrl);
      const matches = s.logins
        .filter((l) => (l.password || l.totp) && anyUrlMatches(pageUrl, l.urls))
        .map(({ vaultId, id, title, username, totp }) => ({
          vaultId,
          id,
          title,
          username,
          hasTotp: !!parseTotp(totp),
          chosen: flow?.choice?.vaultId === vaultId && flow.choice.id === id,
        }))
        .sort((a, b) => Number(b.chosen) - Number(a.chosen));
      return { locked: false, matches } satisfies MatchesResponse;
    }
    case 'credentials': {
      const s = await snapshot();
      const login = s?.logins.find((l) => l.vaultId === msg.vaultId && l.id === msg.id);
      if (!s || !login || !anyUrlMatches(pageUrl, login.urls)) return null;
      await touch(s);
      return { username: login.username, password: login.password };
    }
    case 'otp': {
      const s = await snapshot();
      const login = s?.logins.find((l) => l.vaultId === msg.vaultId && l.id === msg.id);
      const cfg = login ? parseTotp(login.totp) : null;
      if (!s || !login || !cfg || !anyUrlMatches(pageUrl, login.urls)) return null;
      await touch(s);
      return { code: await totpCode(cfg) };
    }
    case 'identifier': {
      if (msg.username) await updateFlow(sender.tab.id ?? -1, pageUrl, { username: msg.username });
      return null;
    }
    case 'choose': {
      const s = await snapshot();
      const login = s?.logins.find((l) => l.vaultId === msg.vaultId && l.id === msg.id);
      if (!s || !login || !anyUrlMatches(pageUrl, login.urls)) return null;
      await touch(s);
      await updateFlow(sender.tab.id ?? -1, pageUrl, { choice: { vaultId: login.vaultId, id: login.id }, username: login.username });
      return { username: login.username };
    }
    case 'submitted': {
      const host = hostOf(pageUrl);
      if (!msg.password || !host || (await neverHosts()).includes(host)) return null;
      const username = msg.username || (await flowFor(sender.tab.id ?? -1, pageUrl))?.username || '';
      const s = await snapshot();
      const known = s?.logins.some(
        (l) => anyUrlMatches(pageUrl, l.urls) && l.password === msg.password && (!username || l.username === username),
      );
      if (known) return null;
      const pending: PendingSave = { url: pageUrl, username, password: msg.password, at: Date.now() };
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
