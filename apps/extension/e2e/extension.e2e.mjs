import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost';
const EXT = process.env.EXT ?? '/ext';
const OUT = process.env.OUT ?? '/out';
const user = { email: `ext-${Date.now()}@example.com`, master: 'erweiterung test passwort lang' };
const problems = [];

const page = (title, extra = '') => `<!doctype html><html><head><title>${title}</title></head><body>
  <h1>${title}</h1>
  <form method="get" action="/done" style="display:grid;gap:8px;width:320px">
    <input id="user" name="username" autocomplete="username" placeholder="E-Mail">
    <input id="pw" name="password" type="password" ${extra} placeholder="Passwort">
    <button type="submit">Weiter</button>
  </form></body></html>`;

const ctx = await chromium.launchPersistentContext(`/tmp/profile-${Date.now()}`, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 860 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.route('https://login.example.test/**', (r) => r.fulfill({ contentType: 'text/html', body: page('Login Beispiel') }));
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
await step('fill a matching site only after a click', async () => {
  current = site;
  await site.goto('https://login.example.test/');
  await site.waitForTimeout(300);
  if ((await site.locator('#pw').inputValue()) !== '') throw new Error('filled without user action');
  await site.locator('#user').focus();
  await site.getByRole('button', { name: 'Mit MelonApp ausfüllen' }).click();
  await site.getByRole('menu', { name: 'MelonApp' }).getByText('Beispiel-Login').waitFor();
  await site.screenshot({ path: `${OUT}/ext-2-menu.png` });
  await site.getByRole('menu', { name: 'MelonApp' }).getByText('Beispiel-Login').click();
  if ((await site.locator('#user').inputValue()) !== 'mia@example.test') throw new Error('username not filled');
  if ((await site.locator('#pw').inputValue()) !== 'alt-passwort-1') throw new Error('password not filled');
});

await step('other domains get nothing', async () => {
  await site.goto('https://evil.example.test/');
  await site.locator('#pw').focus();
  await site.getByRole('button', { name: 'Mit MelonApp ausfüllen' }).click();
  await site.getByText('Kein Login für diese Seite gespeichert.').waitFor();
  const leaked = await sw.evaluate(async () => 'x');
  if (!leaked) throw new Error('service worker unreachable');
});

await step('generate a password on sign-up and save the new login', async () => {
  await site.goto('https://signup.example.test/');
  await site.locator('#user').fill('neu@example.test');
  await site.locator('#pw').focus();
  await site.getByRole('button', { name: 'Mit MelonApp ausfüllen' }).click();
  await site.getByText('Sicheres Passwort vorschlagen').click();
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
  await site.getByRole('button', { name: 'Mit MelonApp ausfüllen' }).click();
  await site.getByText('MelonApp ist gesperrt', { exact: false }).waitFor();
});

await ctx.close();
if (problems.length) {
  console.log('PROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('ALL GREEN');
