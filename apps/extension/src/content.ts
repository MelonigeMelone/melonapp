import { findLoginFields, isVisible, setValue, type LoginFields } from './content/form';
import { anyUrlMatches } from './shared/match';
import type { ContentRequest, Match, MatchesResponse, TabMessage } from './shared/messages';

const ICON = `<svg viewBox="1 11 30 16" width="20" height="11" aria-hidden="true"><path d="M2 12a14 14 0 0 0 28 0Z" fill="#2E6A43"/><path d="M5 12a11 11 0 0 0 22 0Z" fill="#A7D3A0"/><path d="M7 12a9 9 0 0 0 18 0Z" fill="#E2365F"/></svg>`;

const STYLE = `
  :host { all: initial; }
  .btn { position: fixed; z-index: 2147483646; width: 28px; height: 28px; border: 0; border-radius: 8px;
    background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / .25); display: grid; place-items: center; cursor: pointer; padding: 0; }
  .btn:focus-visible { outline: 3px solid #1F6B8F; }
  .menu { position: fixed; z-index: 2147483647; min-width: 260px; max-width: 340px; background: #fff; color: #17231C;
    border: 1px solid #D3E0D2; border-radius: 12px; box-shadow: 0 8px 24px rgb(0 0 0 / .18); padding: 6px;
    font: 14px/1.4 "Atkinson Hyperlegible", system-ui, sans-serif; }
  .menu button { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
  .menu button:hover, .menu button:focus-visible { background: #E6EFE5; }
  .title { font-weight: 700; }
  .sub { color: #5B6B61; font-size: 12px; }
  .note { padding: 8px 10px; color: #5B6B61; }
`;

const host = document.createElement('melon-autofill');
const shadow = host.attachShadow({ mode: 'open' });
shadow.innerHTML = `<style>${STYLE}</style>`;
let attached = false;
let active: LoginFields | null = null;
let anchor: HTMLInputElement | null = null;

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

function place(el: HTMLElement, input: HTMLInputElement, below: boolean) {
  const r = input.getBoundingClientRect();
  if (below) {
    el.style.top = `${r.bottom + 4}px`;
    el.style.left = `${Math.max(4, r.right - 300)}px`;
  } else {
    el.style.top = `${r.top + (r.height - 28) / 2}px`;
    el.style.left = `${r.right - 34}px`;
  }
}

function fill(fields: LoginFields, username: string, password: string) {
  if (fields.username && username) setValue(fields.username, username);
  setValue(fields.password, password);
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
  place(menu, input, true);
  shadow.append(menu);

  const res = await ask<MatchesResponse | null>({ type: 'matches' });
  if (!res || res.locked) {
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = 'MelonApp ist gesperrt. Klicke oben in der Leiste auf das MelonApp-Symbol und entsperre.';
    menu.append(n);
    return;
  }
  for (const m of res.matches as Match[]) {
    menuItem(menu, m.title, m.username, async () => {
      const creds = await ask<{ username: string; password: string } | null>({ type: 'credentials', vaultId: m.vaultId, id: m.id });
      if (creds) fill(fields, creds.username, creds.password);
    });
  }
  if (fields.isNew) {
    menuItem(menu, 'Sicheres Passwort vorschlagen', '20 Zeichen, zufällig', async () => {
      const r = await ask<{ password: string } | null>({ type: 'generate' });
      if (!r) return;
      for (const p of findLoginFields(document).filter((f) => f.password.form === fields.password.form)) setValue(p.password, r.password);
      clear();
    });
  }
  if (!menu.querySelector('button')) {
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = 'Kein Login für diese Seite gespeichert.';
    menu.append(n);
  }
}

function showButton(fields: LoginFields, input: HTMLInputElement) {
  ensureHost();
  clear();
  active = fields;
  anchor = input;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  btn.title = 'Mit MelonApp ausfüllen';
  btn.setAttribute('aria-label', 'Mit MelonApp ausfüllen');
  btn.innerHTML = ICON;
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => void openMenu(fields, input));
  place(btn, input, false);
  shadow.append(btn);
}

function fieldsFor(input: HTMLInputElement): LoginFields | undefined {
  return findLoginFields(document).find((f) => f.password === input || f.username === input);
}

document.addEventListener(
  'focusin',
  (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const fields = fieldsFor(input);
    if (fields) showButton(fields, input);
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
  if (btn && anchor && isVisible(anchor)) place(btn, anchor, false);
  else clear();
  const menu = shadow.querySelector<HTMLElement>('.menu');
  if (menu && anchor) place(menu, anchor, true);
};
window.addEventListener('scroll', reposition, true);
window.addEventListener('resize', reposition);

function reportSubmit(form: HTMLFormElement | null) {
  const fields = findLoginFields(form ?? document).find((f) => f.password.value);
  if (!fields) return;
  void ask({ type: 'submitted', username: fields.username?.value ?? '', password: fields.password.value });
}

document.addEventListener('submit', (e) => reportSubmit(e.target instanceof HTMLFormElement ? e.target : null), true);
document.addEventListener(
  'click',
  (e) => {
    const el = e.target instanceof Element ? e.target.closest('button, input[type="submit"]') : null;
    if (!el || e.composedPath().includes(host)) return;
    const form = (el as HTMLButtonElement).form ?? null;
    if (findLoginFields(form ?? document).some((f) => f.password.value)) reportSubmit(form);
  },
  true,
);

chrome.runtime.onMessage.addListener((msg: TabMessage, sender) => {
  if (sender.id !== chrome.runtime.id || msg.type !== 'fill' || !anyUrlMatches(location.href, msg.urls)) return;
  const target = active ?? findLoginFields(document)[0];
  if (target) fill(target, msg.username, msg.password);
});
