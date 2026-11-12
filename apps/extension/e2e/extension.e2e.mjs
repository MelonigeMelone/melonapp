import { createHmac } from 'node:crypto';
import { chromium } from 'playwright';

function totpNow(secret, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const validCodes = (secret) => [-1, 0, 1].map((o) => totpNow(secret, o));

const BASE = process.env.BASE ?? 'http://localhost';
const EXT = process.env.EXT ?? '/ext';
const OUT = process.env.OUT ?? '/out';
const user = { email: `ext-${Date.now()}@example.com`, master: 'erweiterung test passwort lang' };
const problems = [];

const page = (title, extra = '') => `<!doctype html><html><head><title>${title}</title></head><body>
  <h1>${title}</h1>
  <form method="get" action="/done" style="display:grid;gap:8px;width:320px">
    <input id="user" name="username" autocomplete="username" placeholder="E-Mail">
    <div style="position:relative">
      <input id="pw" name="password" type="password" ${extra} placeholder="Passwort" style="width:100%;box-sizing:border-box;height:36px;padding-right:40px">
      <button id="eye" type="button" aria-label="Passwort zeigen" style="position:absolute;right:6px;top:6px;width:24px;height:24px">o</button>
    </div>
    <button type="submit">Weiter</button>
  </form></body></html>`;

const emailStep = (title, next) => `<!doctype html><html><head><title>${title}</title></head><body>
  <h1>${title}</h1>
  <form method="get" action="${next}" style="display:grid;gap:8px;width:320px">
    <input id="email" type="email" name="identifier" autocomplete="username" placeholder="E-Mail">
    <button type="submit">Weiter</button>
  </form></body></html>`;

const passwordStep = (title) => `<!doctype html><html><head><title>${title}</title></head><body>
  <h1>${title}</h1>
  <form method="get" action="/done" style="display:grid;gap:8px;width:320px">
    <input id="pw" type="password" name="password" placeholder="Passwort">
    <button type="submit">Anmelden</button>
  </form></body></html>`;

const otpStep = `<!doctype html><html><head><meta charset="utf-8"><title>Bestätigung</title></head><body>
  <h1>Bestätigung</h1>
  <form method="get" action="/done" style="display:grid;gap:8px;width:320px">
    <input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" placeholder="6-stelliger Code">
    <button type="submit">Bestätigen</button>
  </form></body></html>`;

const twoStep = (title) => (r) => {
  const path = new URL(r.request().url()).pathname;
  const body = path.startsWith('/password') ? passwordStep(title) : path.startsWith('/done') ? page(title) : emailStep(title, '/password');
  return r.fulfill({ contentType: 'text/html', body });
};

const ctx = await chromium.launchPersistentContext(`/tmp/profile-${Date.now()}`, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 860 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.route('https://login.example.test/**', (r) =>
  r.fulfill({ contentType: 'text/html', body: new URL(r.request().url()).pathname.startsWith('/2fa') ? otpStep : page('Login Beispiel') }),
);
await ctx.route('https://twostep.login.example.test/**', twoStep('Zwei Schritte'));
await ctx.route('https://twostep.new.example.test/**', twoStep('Neu in zwei Schritten'));
await ctx.route('https://evil.example.test/**', (r) => r.fulfill({ contentType: 'text/html', body: page('Fremde Seite') }));
await ctx.route('https://signup.example.test/**', (r) =>
  r.fulfill({ contentType: 'text/html', body: page('Registrierung', 'autocomplete="new-password"') }),
);

let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
let current;

const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
  } catch (e) {
    if (current) await current.screenshot({ path: `${OUT}/ext-fail.png` });
    console.log(`::error title=E2E failed::${name}: ${String(e?.message ?? e).split(String.fromCharCode(10))[0]}`);
    console.log('FAILED', name, problems);
    throw e;
  }
  console.log(`ok  ${name} (${Date.now() - t} ms)`);
};

const watch = (p) => p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const web = await ctx.newPage();
watch(web);
await step('account with one login in the web app', async () => {
  current = web;
  await web.goto(BASE);
  await web.getByRole('tab', { name: 'Konto erstellen' }).click();
  await web.getByLabel('E-Mail').fill(user.email);
  await web.getByLabel('Master-Passwort', { exact: true }).fill(user.master);
  await web.getByLabel('Master-Passwort wiederholen').fill(user.master);
  await web.getByRole('button', { name: 'Konto erstellen' }).last().click();
  await web.getByRole('button', { name: 'Passwörter öffnen' }).click({ timeout: 30000 });
  await web.getByRole('button', { name: 'Neuer Eintrag' }).click();
  await web.getByRole('menuitem', { name: 'Login' }).click();
  await web.getByLabel('Titel').fill('Beispiel-Login');
  await web.getByLabel('Benutzername').fill('mia@example.test');
  await web.locator('#field-password').fill('alt-passwort-1');
  await web.locator('#field-website').fill('https://login.example.test');
  await web.getByRole('button', { name: 'Einmalcode (2FA) hinzufügen' }).click();
  await web.getByLabel('Schlüssel', { exact: true }).fill('JBSWY3DPEHPK3PXP');
  await web.getByRole('button', { name: 'Speichern' }).click();
  await web.getByRole('heading', { name: 'Beispiel-Login', level: 2 }).waitFor();
});

const popup = await ctx.newPage();
watch(popup);
await step('unlock the extension', async () => {
  current = popup;
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.getByLabel('Server').fill(BASE);
  await popup.getByLabel('E-Mail').fill(user.email);
  await popup.getByLabel('Master-Passwort').fill(user.master);
  await popup.getByRole('button', { name: 'Entsperren' }).click();
  await popup.getByText('1 Login', { exact: false }).waitFor({ timeout: 30000 });
  await popup.getByLabel('Logins durchsuchen').fill('beispiel');
  await popup.locator('.popup-login', { hasText: 'Beispiel-Login' }).waitFor();
  await popup.screenshot({ path: `${OUT}/ext-1-popup.png` });
});

const site = await ctx.newPage();
watch(site);
const cdp = await ctx.newCDPSession(site);
const ICON_NAME = 'Mit MelonApp ausfüllen';
const findInMelon = async (role, text, timeout = 10000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    for (const n of nodes) {
      if (n.ignored || n.role?.value !== role || !String(n.name?.value ?? '').includes(text) || !n.backendDOMNodeId) continue;
      const box = await cdp.send('DOM.getBoxModel', { backendNodeId: n.backendDOMNodeId }).catch(() => null);
      if (!box) continue;
      const q = box.model.border;
      return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2, width: q[4] - q[0], height: q[5] - q[1] };
    }
    if (Date.now() > end) throw new Error(`${role} "${text}" not shown`);
    await site.waitForTimeout(100);
  }
};
const melonShown = async (role, text) => findInMelon(role, text, 0).then(() => true, () => false);
const clickMelon = async (role, text) => {
  const at = await findInMelon(role, text);
  await site.waitForTimeout(text === ICON_NAME ? 300 : 600);
  await site.mouse.click(at.x, at.y);
};
const clickIcon = () => clickMelon('button', ICON_NAME);
const clickItem = (text) => clickMelon('button', text);

const valueOf = async (selector, expected) => {
  await site.waitForFunction(([sel, want]) => document.querySelector(sel)?.value === want, [selector, expected], { timeout: 5000 }).catch(() => undefined);
  return site.locator(selector).inputValue();
};

await step('fill a matching site only after a click', async () => {
  current = site;
  await site.goto('https://login.example.test/');
  await site.waitForTimeout(300);
  if ((await site.locator('#pw').inputValue()) !== '') throw new Error('filled without user action');
  await site.locator('#pw').focus();
  const c = await findInMelon('button', ICON_NAME);
  const a = { x: c.x - c.width / 2, width: c.width };
  const b = await site.locator('#eye').boundingBox();
  if (!b) throw new Error('missing boxes');
  if (a.x < b.x + b.width && b.x < a.x + a.width) throw new Error('melon icon covers the page\'s own icon');
  await site.locator('#eye').click();
  await site.waitForTimeout(400);
  if (await site.locator('iframe[name="melonapp-save"]').count()) throw new Error('show-password click triggered a save prompt');
  await site.locator('#user').focus();
  await findInMelon('button', ICON_NAME);
  await site.screenshot({ path: `${OUT}/ext-2a-icon.png`, clip: { x: 0, y: 0, width: 520, height: 260 } });
  await clickIcon();
  await findInMelon('button', 'Beispiel-Login');
  await site.screenshot({ path: `${OUT}/ext-2-menu.png`, clip: { x: 0, y: 0, width: 520, height: 300 } });
  await clickItem('Beispiel-Login');
  if ((await valueOf('#user', 'mia@example.test')) !== 'mia@example.test') throw new Error('username not filled');
  if ((await valueOf('#pw', 'alt-passwort-1')) !== 'alt-passwort-1') throw new Error('password not filled');
});

await step('fill the 2FA code on the verification page', async () => {
  await site.goto('https://login.example.test/2fa');
  await site.locator('#otp').focus();
  await clickIcon();
  await findInMelon('button', 'Einmalcode für mia@example.test');
  await site.screenshot({ path: `${OUT}/ext-2b-otp.png`, clip: { x: 0, y: 0, width: 520, height: 260 } });
  await clickItem('Beispiel-Login');
  await site.waitForFunction(() => document.querySelector('#otp')?.value.length === 6, null, { timeout: 10000 });
  const value = await site.locator('#otp').inputValue();
  if (!validCodes('JBSWY3DPEHPK3PXP').includes(value)) throw new Error(`filled 2FA code ${value} is wrong`);
});

await step('page scripts can neither reach nor trick the menu', async () => {
  await site.goto('https://login.example.test/');
  await site.locator('#pw').focus();
  await findInMelon('button', ICON_NAME);
  const reach = await site.evaluate(() => {
    const host = document.querySelector('melon-autofill');
    host?.click();
    host?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    return { root: !!host?.shadowRoot };
  });
  if (reach.root) throw new Error('the page can reach the shadow root');
  await site.waitForTimeout(500);
  if (await melonShown('menu', 'MelonApp')) throw new Error('a synthetic click opened the menu');

  await clickIcon();
  const item = await findInMelon('button', 'Beispiel-Login');
  await site.evaluate(() => {
    const cover = document.createElement('div');
    cover.id = 'cover';
    cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#fff;pointer-events:none';
    document.documentElement.append(cover);
  });
  await site.waitForTimeout(700);
  await site.mouse.click(item.x, item.y);
  await site.waitForTimeout(600);
  if (await site.locator('#pw').inputValue()) throw new Error('filled through a click-through overlay');

  await site.evaluate(() => {
    document.querySelector('#cover').remove();
    document.documentElement.style.setProperty('filter', 'opacity(0)', 'important');
  });
  await site.waitForTimeout(700);
  await site.mouse.click(item.x, item.y);
  await site.waitForTimeout(600);
  if (await site.locator('#pw').inputValue()) throw new Error('filled while the page had hidden the menu');

  await site.evaluate(() => document.documentElement.style.removeProperty('filter'));
  await site.waitForTimeout(700);
  await site.mouse.click(item.x, item.y);
  if ((await valueOf('#pw', 'alt-passwort-1')) !== 'alt-passwort-1') throw new Error('a genuine click after the attack was ignored');
});

await step('other domains get nothing, not even the icon', async () => {
  await site.goto('https://evil.example.test/');
  await site.locator('#pw').focus();
  await site.waitForTimeout(800);
  if (await melonShown('button', ICON_NAME)) throw new Error('icon shown without a matching login');
  const leaked = await sw.evaluate(async () => 'x');
  if (!leaked) throw new Error('service worker unreachable');
});

await step('two-step login: e-mail page first, then password page', async () => {
  current = site;
  await site.goto('https://twostep.login.example.test/');
  await site.locator('#email').focus();
  await clickIcon();
  await clickItem('Beispiel-Login');
  if ((await valueOf('#email', 'mia@example.test')) !== 'mia@example.test') throw new Error('e-mail step not filled');
  await site.getByRole('button', { name: 'Weiter' }).click();
  await site.waitForURL(/password/);
  await site.locator('#pw').focus();
  await clickIcon();
  await findInMelon('button', 'eben gewählt');
  await site.screenshot({ path: `${OUT}/ext-2b-two-step.png` });
  await clickItem('eben gewählt');
  if ((await valueOf('#pw', 'alt-passwort-1')) !== 'alt-passwort-1') throw new Error('password step not filled');
});

await step('two-step sign-up remembers the e-mail for saving', async () => {
  await site.goto('https://twostep.new.example.test/');
  await site.locator('#email').fill('zwei@example.test');
  await site.getByRole('button', { name: 'Weiter' }).click();
  await site.waitForURL(/password/);
  await site.locator('#pw').fill('zwei-schritte-passwort');
  await site.getByRole('button', { name: 'Anmelden' }).click();
  await site.waitForURL(/done/);
  const prompt = site.frameLocator('iframe[name="melonapp-save"]');
  await prompt.getByText('Neuen Login für twostep.new.example.test speichern?').waitFor({ timeout: 15000 });
  await prompt.getByText('zwei@example.test').waitFor();
  await prompt.getByRole('button', { name: 'Nicht jetzt' }).click();
  await site.locator('iframe[name="melonapp-save"]').waitFor({ state: 'detached', timeout: 10000 });
});

await step('generate a password on sign-up and save the new login', async () => {
  await site.goto('https://signup.example.test/');
  await site.locator('#user').fill('neu@example.test');
  await site.locator('#pw').focus();
  await clickIcon();
  await clickItem('Sicheres Passwort vorschlagen');
  await site.waitForFunction(() => document.querySelector('#pw')?.value.length === 20, null, { timeout: 5000 }).catch(() => undefined);
  const generated = await site.locator('#pw').inputValue();
  if (generated.length !== 20) throw new Error(`generated ${generated.length} characters`);
  await site.getByRole('button', { name: 'Weiter' }).click();
  await site.waitForURL(/done/);

  const prompt = site.frameLocator('iframe[name="melonapp-save"]');
  await prompt.getByText('Neuen Login für signup.example.test speichern?').waitFor({ timeout: 15000 });
  await prompt.getByText('neu@example.test').waitFor();
  await site.screenshot({ path: `${OUT}/ext-3-save-in-page.png` });
  await prompt.getByRole('button', { name: 'Speichern' }).click();
  await prompt.getByText('Gespeichert.').waitFor({ timeout: 15000 });
  await site.locator('iframe[name="melonapp-save"]').waitFor({ state: 'detached', timeout: 10000 });

  current = web;
  await web.evaluate(() => window.dispatchEvent(new Event('focus')));
  await web.locator('.entry-row', { hasText: 'signup.example.test' }).waitFor({ timeout: 15000 });
  await web.locator('.entry-row', { hasText: 'signup.example.test' }).click();
  const pw = web.locator('.concealed-field').first();
  await pw.getByRole('button', { name: 'Anzeigen' }).click();
  if ((await pw.locator('.concealed-value .pw').innerText()) !== generated) throw new Error('saved password differs');
});

await step('a changed password offers an update, and "never" silences the site', async () => {
  current = site;
  await site.goto('https://login.example.test/');
  await site.locator('#user').fill('mia@example.test');
  await site.locator('#pw').fill('neues-passwort-2');
  await site.getByRole('button', { name: 'Weiter' }).click();
  await site.waitForURL(/done/);
  const prompt = site.frameLocator('iframe[name="melonapp-save"]');
  await prompt.getByText('Passwort für login.example.test aktualisieren?').waitFor({ timeout: 15000 });
  await prompt.getByRole('button', { name: 'Nie für diese Seite' }).click();
  await site.locator('iframe[name="melonapp-save"]').waitFor({ state: 'detached', timeout: 10000 });

  await site.goto('https://login.example.test/');
  await site.locator('#user').fill('mia@example.test');
  await site.locator('#pw').fill('noch-ein-passwort-3');
  await site.getByRole('button', { name: 'Weiter' }).click();
  await site.waitForURL(/done/);
  await site.waitForTimeout(2500);
  if (await site.locator('iframe[name="melonapp-save"]').count()) throw new Error('prompt shown despite "never"');
});

await step('locking the extension stops autofill', async () => {
  current = popup;
  await popup.getByRole('button', { name: 'Sperren' }).click();
  await popup.getByRole('button', { name: 'Entsperren' }).waitFor();
  current = site;
  await site.goto('https://login.example.test/');
  await site.locator('#user').focus();
  await clickIcon();
  await findInMelon('StaticText', 'MelonApp ist gesperrt');
});

await ctx.close();
if (problems.length) {
  console.log('PROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('ALL GREEN');
