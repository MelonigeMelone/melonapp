import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost';
const OUT = process.env.OUT ?? '/out';
const stamp = Date.now();
const alice = { email: `alice-${stamp}@example.com`, master: 'korrekt pferd batterie heftklammer' };
const bob = { email: `bob-${stamp}@example.com`, master: 'melone kiwi banane ananas' };
const problems = [];
let expect401 = false;
let expect404 = false;

const browser = await chromium.launch();

async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light', ...options });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await context.newPage();
  page.on('console', (m) => {
    const expected = (expect401 && m.text().includes('401')) || (expect404 && m.text().includes('404'));
    if (m.type() === 'error' && !expected) problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return page;
}

const a = await newPage();
let current = a;

const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
  } catch (e) {
    await current.screenshot({ path: `${OUT}/fail.png`, animations: 'disabled' });
    const errs = await current.locator('.MuiAlert-message').allInnerTexts();
    console.log('FAILED', name, errs, problems);
    throw e;
  }
  console.log(`ok  ${name} (${Date.now() - t} ms)`);
};

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });
const sync = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

async function register(page, person) {
  await page.getByLabel('Master-Passwort', { exact: true }).fill(person.master);
  await page.getByLabel('Master-Passwort wiederholen').fill(person.master);
  await page.getByRole('button', { name: 'Konto erstellen' }).last().click();
}

async function newItem(page, type) {
  await page.getByRole('button', { name: 'Neuer Eintrag' }).click();
  await page.getByRole('menuitem', { name: type }).click();
}

await step('open app', async () => {
  await a.goto(BASE);
  await a.getByRole('heading', { name: 'MelonApp' }).waitFor();
  await shot(a, '1-auth');
});

await step('alice registers', async () => {
  await a.getByRole('tab', { name: 'Konto erstellen' }).click();
  await a.getByLabel('E-Mail').fill(alice.email);
  await register(a, alice);
  await a.getByText('Noch keine Einträge.').waitFor({ timeout: 30000 });
});

let generated = '';
await step('login with generated password and a custom hidden field', async () => {
  await newItem(a, 'Login');
  await a.getByLabel('Titel').fill('GitHub');
  await a.getByLabel('Benutzername').fill('melone');
  await a.getByRole('button', { name: 'Passwort generieren' }).click();
  await a.getByRole('button', { name: 'Dieses Passwort verwenden' }).click();
  generated = await a.locator('#field-password').inputValue();
  if (generated.length !== 20) throw new Error(`generated length ${generated.length}`);
  await a.locator('#field-website').fill('github.com');
  await a.getByRole('button', { name: 'Feld hinzufügen' }).click();
  await a.getByRole('menuitem', { name: 'Verborgen' }).click();
  await a.getByLabel('Name des Felds (Verborgen)').fill('Recovery-Code');
  await a.getByLabel('Wert').fill('R-2468-1357');
  await shot(a, '2-editor');
  await a.getByRole('button', { name: 'Speichern' }).click();
  await a.getByRole('heading', { name: 'GitHub', level: 2 }).waitFor();
  await a.getByText('Recovery-Code').waitFor();
});

await step('card entry and search', async () => {
  await newItem(a, 'Kreditkarte');
  await a.getByLabel('Titel').fill('Visa');
  await a.locator('#field-cardholder').fill('Mia Melone');
  await a.locator('#field-number').fill('4111 1111 1111 1111');
  await a.getByRole('button', { name: 'Speichern' }).click();
  await a.getByRole('heading', { name: 'Visa', level: 2 }).waitFor();
  await a.getByRole('searchbox').fill('git');
  if ((await a.locator('.entry-row').count()) !== 1) throw new Error('search did not filter');
  await a.getByRole('searchbox').fill('4111');
  if ((await a.locator('.entry-row').count()) !== 0) throw new Error('hidden fields must not be searchable');
  await a.getByRole('searchbox').fill('');
});

await step('reveal and copy password', async () => {
  await a.locator('.entry-row', { hasText: 'GitHub' }).click();
  const pw = a.locator('.concealed-field').first();
  await pw.getByRole('button', { name: 'Anzeigen' }).click();
  if ((await pw.locator('.concealed-value .pw').innerText()) !== generated) throw new Error('revealed password differs');
  await pw.getByRole('button', { name: 'Kopieren' }).click();
  await a.getByText(/Kopiert\./).waitFor();
  if ((await a.evaluate(() => navigator.clipboard.readText())) !== generated) throw new Error('clipboard mismatch');
  await shot(a, '3-detail');
});

await step('editing a password keeps the old one', async () => {
  await a.getByRole('button', { name: 'Bearbeiten' }).click();
  await a.locator('#field-password').fill('ganz-neues-passwort-2026');
  await a.getByRole('button', { name: 'Speichern' }).click();
  await a.getByText('Frühere Werte (1)').waitFor();
});

let inviteLink = '';
await step('shared vault and invite link', async () => {
  await a.getByRole('button', { name: 'Neuer Tresor' }).click();
  await a.getByLabel('Name').fill('Familie');
  await a.getByRole('button', { name: 'Tresor anlegen' }).click();
  const dialog = a.getByRole('dialog', { name: 'Familie' });
  await dialog.waitFor();
  await dialog.getByLabel('E-Mail').fill(bob.email);
  expect404 = true;
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  const linkField = dialog.getByLabel('Einladungslink');
  await linkField.waitFor();
  inviteLink = await linkField.inputValue();
  if (!inviteLink.includes('/#/invite/')) throw new Error(`unexpected link ${inviteLink}`);
  await shot(a, '4-vault-dialog');
  expect404 = false;
  await dialog.getByRole('button', { name: 'Schließen' }).click();
});

await step('entry in the shared vault', async () => {
  await newItem(a, 'WLAN');
  await a.getByLabel('Titel').fill('WLAN Zuhause');
  await a.locator('#field-ssid').fill('Melonennetz');
  await a.locator('#field-password').fill('wlan-geheim-12345');
  await a.getByRole('button', { name: 'Speichern' }).click();
  await a.getByRole('heading', { name: 'WLAN Zuhause', level: 2 }).waitFor();
  await a.getByText('Familie', { exact: true }).first().waitFor();
});

const b = await newPage();
await step('bob registers through the invite link and waits', async () => {
  current = b;
  await b.goto(inviteLink.replace(/^https?:\/\/[^/]+/, BASE));
  await b.getByText(`${alice.email} hat dich eingeladen`, { exact: false }).waitFor();
  if ((await b.getByLabel('E-Mail').inputValue()) !== bob.email) throw new Error('invite e-mail not prefilled');
  await register(b, bob);
  await b.getByText('Wartet auf Freigabe').first().waitFor({ timeout: 30000 });
  await shot(b, '5-bob-pending');
});

await step('alice grants the key automatically, bob sees the entry', async () => {
  current = a;
  await sync(a);
  await a.waitForTimeout(1500);
  current = b;
  for (let i = 0; i < 10 && !(await b.locator('.entry-row', { hasText: 'WLAN Zuhause' }).count()); i++) {
    await sync(b);
    await b.waitForTimeout(700);
  }
  await b.locator('.entry-row', { hasText: 'WLAN Zuhause' }).click();
  const pw = b.locator('.concealed-field').first();
  await pw.getByRole('button', { name: 'Anzeigen' }).click();
  if ((await pw.locator('.concealed-value .pw').innerText()) !== 'wlan-geheim-12345') throw new Error('bob cannot read the shared password');
  if (await b.locator('.entry-row', { hasText: 'GitHub' }).count()) throw new Error('bob must not see alice\'s personal vault');
  await shot(b, '6-bob-shared');
});

await step('alice removes bob, the vault key is rotated', async () => {
  current = a;
  await a.getByRole('button', { name: 'Familie: Mitglieder und Einstellungen' }).click();
  const dialog = a.getByRole('dialog', { name: 'Familie' });
  await dialog.getByRole('button', { name: `${bob.email} entfernen` }).click();
  await a.getByRole('button', { name: 'Entfernen', exact: true }).click();
  await dialog.getByText(bob.email).waitFor({ state: 'detached', timeout: 15000 });
  await dialog.getByRole('button', { name: 'Schließen' }).click();
});

await step('bob loses access', async () => {
  current = b;
  for (let i = 0; i < 10 && (await b.locator('.entry-row', { hasText: 'WLAN Zuhause' }).count()); i++) {
    await sync(b);
    await b.waitForTimeout(700);
  }
  if (await b.locator('.entry-row', { hasText: 'WLAN Zuhause' }).count()) throw new Error('bob still sees the shared entry');
  if (await b.locator('.vault-row', { hasText: 'Familie' }).count()) throw new Error('bob still sees the vault');
});

await step('alice reads the re-encrypted vault after unlocking again', async () => {
  current = a;
  await a.reload();
  if ((await a.getByLabel('E-Mail').inputValue()) !== alice.email) throw new Error('email not remembered');
  await a.getByLabel('Master-Passwort', { exact: true }).fill(alice.master);
  await a.getByRole('button', { name: 'Tresor öffnen' }).click();
  await a.locator('.entry-row', { hasText: 'WLAN Zuhause' }).waitFor({ timeout: 30000 });
  await a.locator('.entry-row', { hasText: 'WLAN Zuhause' }).click();
  const pw = a.locator('.concealed-field').first();
  await pw.getByRole('button', { name: 'Anzeigen' }).click();
  if ((await pw.locator('.concealed-value .pw').innerText()) !== 'wlan-geheim-12345') throw new Error('rotated entry unreadable');
});

await step('wrong password is rejected', async () => {
  expect401 = true;
  await a.getByRole('button', { name: 'Sperren' }).click();
  await a.getByLabel('Master-Passwort', { exact: true }).fill('falsches passwort hier');
  await a.getByRole('button', { name: 'Tresor öffnen' }).click();
  await a.getByText('E-Mail oder Master-Passwort ist falsch.').waitFor({ timeout: 30000 });
});

await step('mobile and dark mode', async () => {
  const m = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  current = m;
  await m.goto(BASE);
  await m.getByLabel('E-Mail').fill(alice.email);
  await m.getByLabel('Master-Passwort', { exact: true }).fill(alice.master);
  await m.getByRole('button', { name: 'Tresor öffnen' }).click();
  await m.locator('.entry-row', { hasText: 'GitHub' }).waitFor({ timeout: 30000 });
  await shot(m, '7-mobile-list');
  await m.getByRole('button', { name: 'Tresore anzeigen' }).click();
  await m.getByRole('button', { name: /^Familie/ }).first().waitFor();
  await shot(m, '8-mobile-drawer');
});

await browser.close();
if (problems.length) {
  console.log('PROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('ALL GREEN');
