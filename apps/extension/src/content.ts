import { findIdentifierFields, findLoginFields, isVisible, setValue, type LoginFields } from './content/form';
import { anyUrlMatches } from './shared/match';
import type { ContentRequest, Match, MatchesResponse, TabMessage } from './shared/messages';

const ICON = `<svg viewBox="1 11 30 16" aria-hidden="true"><path d="M2 12a14 14 0 0 0 28 0Z" fill="#2E6A43"/><path d="M5 12a11 11 0 0 0 22 0Z" fill="#A7D3A0"/><path d="M7 12a9 9 0 0 0 18 0Z" fill="#E2365F"/></svg>`;

const STYLE = `
  :host { all: initial; }
  .btn { position: fixed; z-index: 2147483646; border: 0; border-radius: 6px; padding: 0; margin: 0;
    background: transparent; display: grid; place-items: center; cursor: pointer; opacity: .9;
    transition: background-color .12s ease, opacity .12s ease; }
  .btn svg { width: 78%; height: auto; display: block; }
  .btn:hover { background: rgb(226 54 95 / .12); opacity: 1; }
  .btn:focus-visible { outline: 2px solid #1F6B8F; outline-offset: 1px; opacity: 1; }
  .btn.locked { opacity: .55; filter: grayscale(.6); }
  .menu { position: fixed; z-index: 2147483647; box-sizing: border-box; background: #fff; color: #17231C;
    border: 1px solid #D3E0D2; border-radius: 12px; box-shadow: 0 10px 28px rgb(23 35 28 / .16); padding: 6px;
    font: 14px/1.4 "Atkinson Hyperlegible", system-ui, sans-serif; }
  .head { display: flex; align-items: center; gap: 6px; padding: 4px 10px 6px; color: #5B6B61; font-size: 12px; font-weight: 700; }
  .head svg { width: 18px; height: auto; }
  .menu button { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
  .menu button:hover, .menu button:focus-visible { background: #E6EFE5; }
  .title { font-weight: 700; }
  .sub { color: #5B6B61; font-size: 12px; }
  .note { padding: 6px 10px 8px; color: #5B6B61; }
  @media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
`;

const host = document.createElement('melon-autofill');
const shadow = host.attachShadow({ mode: 'open' });
shadow.innerHTML = `<style>${STYLE}</style>`;
let attached = false;
let active: LoginFields | null = null;
let anchor: HTMLInputElement | null = null;
let saveFrame: HTMLIFrameElement | null = null;

function showSavePrompt() {
  if (saveFrame?.isConnected) return;
  const frame = document.createElement('iframe');
  frame.name = 'melonapp-save';
  frame.title = 'MelonApp: Login speichern';
  frame.src = chrome.runtime.getURL('save.html');
  frame.setAttribute('allowtransparency', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    width: '380px',
    maxWidth: 'calc(100vw - 32px)',
    height: '200px',
    border: '0',
    borderRadius: '16px',
    boxShadow: '0 12px 32px rgb(0 0 0 / .22)',
    zIndex: '2147483647',
    colorScheme: 'normal',
    background: 'transparent',
  });
  document.documentElement.append(frame);
  saveFrame = frame;
}

async function checkPending() {
  const r = await ask<{ show: boolean } | null>({ type: 'pendingForPage' });
  if (r?.show) showSavePrompt();
}

function ask<T>(msg: ContentRequest): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function ensureHost() {
  if (!attached) {
    document.documentElement.append(host);
    attached = true;
  }
}

function clear() {
  shadow.querySelectorAll('.btn, .menu').forEach((n) => n.remove());
}

function placeButton(btn: HTMLElement, input: HTMLInputElement) {
  const r = input.getBoundingClientRect();
  const size = Math.round(Math.min(26, Math.max(18, r.height - 10)));
  const cy = r.top + r.height / 2;
  let left = r.right - size - 8;
  btn.style.display = 'none';
  const below = document.elementFromPoint(left + size / 2, cy);
  if (below && below !== input && !below.contains(input) && !host.contains(below)) {
    const other = below.getBoundingClientRect();
    if (other.left > r.left + r.width / 2) left = other.left - size - 4;
  }
  btn.style.display = '';
  Object.assign(btn.style, { width: `${size}px`, height: `${size}px`, top: `${cy - size / 2}px`, left: `${left}px` });
}

function placeMenu(menu: HTMLElement, input: HTMLInputElement) {
  const r = input.getBoundingClientRect();
  const width = Math.min(360, Math.max(r.width, 260));
  const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
  const height = menu.offsetHeight || 160;
  const top = r.bottom + 6 + height > window.innerHeight && r.top - 6 - height > 0 ? r.top - 6 - height : r.bottom + 6;
  Object.assign(menu.style, { width: `${width}px`, left: `${left}px`, top: `${top}px` });
}

function fill(fields: LoginFields, username: string, password: string) {
  if (fields.username && username) setValue(fields.username, username);
  if (fields.password && password) setValue(fields.password, password);
  clear();
}

function menuItem(menu: HTMLElement, title: string, sub: string, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  const t = document.createElement('div');
  t.className = 'title';
  t.textContent = title;
  b.append(t);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'sub';
    s.textContent = sub;
    b.append(s);
  }
  b.addEventListener('click', onClick);
  menu.append(b);
}

async function openMenu(fields: LoginFields, input: HTMLInputElement) {
  shadow.querySelector('.menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'MelonApp');
  const head = document.createElement('div');
  head.className = 'head';
  head.innerHTML = `${ICON}<span>MelonApp</span>`;
  menu.append(head);
  shadow.append(menu);
  placeMenu(menu, input);

  const res = await ask<MatchesResponse | null>({ type: 'matches' });
  if (!res || res.locked) {
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = 'MelonApp ist gesperrt. Klicke oben in der Leiste auf das MelonApp-Symbol und entsperre.';
    menu.append(n);
    placeMenu(menu, input);
    return;
  }
  for (const m of res.matches as Match[]) {
    const sub = m.chosen ? `${m.username}, eben gewählt` : m.username;
    menuItem(menu, m.title, sub, async () => {
      if (!fields.password) {
        const chosen = await ask<{ username: string } | null>({ type: 'choose', vaultId: m.vaultId, id: m.id });
        if (chosen) fill(fields, chosen.username, '');
        return;
      }
      const creds = await ask<{ username: string; password: string } | null>({ type: 'credentials', vaultId: m.vaultId, id: m.id });
      if (creds) fill(fields, creds.username, creds.password);
    });
  }
  if (fields.isNew && fields.password) {
    menuItem(menu, 'Sicheres Passwort vorschlagen', '20 Zeichen, zufällig', async () => {
      const r = await ask<{ password: string } | null>({ type: 'generate' });
      if (!r) return;
      for (const p of findLoginFields(document).filter((f) => f.password?.form === fields.password?.form)) if (p.password) setValue(p.password, r.password);
      clear();
    });
  }
  if (!menu.querySelector('button')) {
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = 'Kein Login für diese Seite gespeichert.';
    menu.append(n);
  }
  placeMenu(menu, input);
}

let cached: { at: number; res: MatchesResponse | null } | null = null;

async function matchesForPage(): Promise<MatchesResponse | null> {
  if (cached && Date.now() - cached.at < 15_000) return cached.res;
  const res = await ask<MatchesResponse | null>({ type: 'matches' });
  cached = { at: Date.now(), res };
  return res;
}

function showButton(fields: LoginFields, input: HTMLInputElement, locked: boolean) {
  ensureHost();
  clear();
  active = fields;
  anchor = input;
  const btn = document.createElement('button');
  btn.className = locked ? 'btn locked' : 'btn';
  btn.type = 'button';
  btn.title = 'Mit MelonApp ausfüllen';
  btn.setAttribute('aria-label', 'Mit MelonApp ausfüllen');
  btn.innerHTML = ICON;
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    cached = null;
    void openMenu(fields, input);
  });
  shadow.append(btn);
  placeButton(btn, input);
}

function fieldsFor(input: HTMLInputElement): LoginFields | undefined {
  return (
    findLoginFields(document).find((f) => f.password === input || f.username === input) ??
    findIdentifierFields(document).find((f) => f.username === input)
  );
}

document.addEventListener(
  'focusin',
  (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const fields = fieldsFor(input);
    if (!fields) return;
    void matchesForPage().then((res) => {
      if (document.activeElement !== input) return;
      const locked = !res || res.locked;
      const useful = locked || (res.locked === false && res.matches.length > 0) || (fields.isNew && !!fields.password);
      if (useful) showButton(fields, input, locked);
    });
  },
  true,
);

document.addEventListener(
  'pointerdown',
  (e) => {
    if (e.composedPath().includes(host)) return;
    if (e.target !== anchor) clear();
  },
  true,
);

const reposition = () => {
  const btn = shadow.querySelector<HTMLElement>('.btn');
  if (btn && anchor && isVisible(anchor)) placeButton(btn, anchor);
  else clear();
  const menu = shadow.querySelector<HTMLElement>('.menu');
  if (menu && anchor) placeMenu(menu, anchor);
};
window.addEventListener('scroll', reposition, true);
window.addEventListener('resize', reposition);

function reportSubmit(form: HTMLFormElement | null) {
  const scope = form ?? document;
  const fields = findLoginFields(scope).find((f) => f.password?.value);
  if (fields?.password) {
    void ask({ type: 'submitted', username: fields.username?.value ?? '', password: fields.password.value }).then(() =>
      setTimeout(() => void checkPending(), 1200),
    );
    return;
  }
  const identifier = findIdentifierFields(scope).find((f) => f.username?.value.trim());
  if (identifier?.username) void ask({ type: 'identifier', username: identifier.username.value.trim() });
}

document.addEventListener(
  'change',
  (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || !input.value.trim()) return;
    if (findIdentifierFields(document).some((f) => f.username === input)) void ask({ type: 'identifier', username: input.value.trim() });
  },
  true,
);

document.addEventListener('submit', (e) => reportSubmit(e.target instanceof HTMLFormElement ? e.target : null), true);
document.addEventListener(
  'click',
  (e) => {
    const el = e.target instanceof Element ? e.target.closest('button[type="submit"], button:not([type]), input[type="submit"]') : null;
    if (!el || e.composedPath().includes(host)) return;
    const form = (el as HTMLButtonElement).form ?? null;
    const scope = form ?? document;
    if (findLoginFields(scope).some((f) => f.password?.value) || findIdentifierFields(scope).some((f) => f.username?.value)) reportSubmit(form);
  },
  true,
);

chrome.runtime.onMessage.addListener((msg: TabMessage, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === 'closeSave') {
    saveFrame?.remove();
    saveFrame = null;
    return;
  }
  if (msg.type === 'resizeSave') {
    if (saveFrame) saveFrame.style.height = `${msg.height}px`;
    return;
  }
  if (msg.type !== 'fill' || !anyUrlMatches(location.href, msg.urls)) return;
  const target = active ?? findLoginFields(document)[0];
  if (target) fill(target, msg.username, msg.password);
});

void checkPending();
