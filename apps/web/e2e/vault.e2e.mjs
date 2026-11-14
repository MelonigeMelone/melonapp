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
    console.log(`::error title=E2E failed::${name}: ${String(e?.message ?? e).split(String.fromCharCode(10))[0]}`);
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

await step('the crypto worker runs under a CSP and nothing is spell-checked', async () => {
  const scripts = await a.evaluate(() => [...document.querySelectorAll('script[src]')].map((e) => e.src));
  if (!scripts.length) throw new Error('no script assets found');
  const csp = await a.evaluate(async (src) => (await fetch(src)).headers.get('content-security-policy'), scripts[0]);
  if (!csp || !csp.includes("connect-src 'self'") || !csp.includes("default-src 'none'")) throw new Error(`assets lack a CSP: ${csp}`);
  if (await a.evaluate(() => document.documentElement.spellcheck)) throw new Error('spell check is on');
});

await step('alice registers', async () => {
  await a.getByRole('tab', { name: 'Konto erstellen' }).click();
  await a.getByLabel('E-Mail').fill(alice.email);
  await register(a, alice);
  await a.getByRole('heading', { name: 'Start', level: 1 }).waitFor({ timeout: 30000 });
});

let recoveryKey = '';
await step('emergency kit', async () => {
  await a.getByText('Noch kein Notfall-Kit.', { exact: false }).first().waitFor();
  await a.getByRole('button', { name: 'Erstellen' }).click();
  const kit = a.getByRole('dialog', { name: 'Notfall-Kit' });
  await kit.getByLabel('Master-Passwort zur Bestätigung').fill(alice.master);
  await kit.getByRole('button', { name: 'Notfall-Kit erstellen' }).click();
  await kit.locator('.recovery-key').waitFor();
  recoveryKey = await kit.locator('.recovery-key').innerText();
  if (!/^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/.test(recoveryKey)) throw new Error(`unexpected recovery key ${recoveryKey}`);
  if (!(await kit.getByRole('button', { name: 'Fertig' }).isDisabled())) throw new Error('kit must be confirmed first');
  await shot(a, '2-recovery-kit');
  await kit.getByLabel('Ich habe den Recovery-Key sicher aufbewahrt.').check();
  await kit.getByRole('button', { name: 'Fertig' }).click();
  await a.getByText('Noch kein Notfall-Kit.', { exact: false }).first().waitFor({ state: 'detached' });
  await a.getByText('Persönlich').first().waitFor();
  await shot(a, '2b-home');
});

await step('open the password module from the home screen', async () => {
  await a.getByRole('button', { name: 'Passwörter öffnen' }).click();
  await a.getByText('Noch keine Einträge.').waitFor();
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
  await shot(a, '3-editor');
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

await step('import from Apple Passwords, skipping duplicates', async () => {
  await a.getByRole('button', { name: 'Importieren' }).click();
  const dialog = a.getByRole('dialog', { name: 'Passwörter importieren' });
  const csv = [
    'Title,URL,Username,Password,Notes,OTPAuth',
    'GitHub,https://github.com/,melone,irgendwas,,',
    'Stadtwerke,https://stadtwerke.example,kunde-42,"strom,gas""2026",Zählernummer 7,',
    'Bibliothek,https://bib.example,leser-7,buecher!,,otpauth://totp/Bib?secret=JBSWY3DP',
  ].join('\n');
  await dialog.getByLabel('Export-Datei').setInputFiles({ name: 'Passwords.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await dialog.getByText('Erkannt: Apple Passwörter, 3 Einträge', { exact: false }).waitFor();
  await dialog.getByText('1 Eintrag gibt es schon', { exact: false }).waitFor();
  await shot(a, '4a-import-preview');
  await dialog.getByRole('button', { name: '2 Einträge importieren' }).click();
  await dialog.getByText('2 Einträge importiert.', { exact: false }).waitFor({ timeout: 30000 });
  await dialog.getByText('Lösche jetzt die Export-Datei', { exact: false }).waitFor();
  await dialog.getByRole('button', { name: 'Fertig' }).click();
  await a.locator('.entry-row', { hasText: 'Stadtwerke' }).click();
  const pw = a.locator('.concealed-field').first();
  await pw.getByRole('button', { name: 'Anzeigen' }).click();
  if ((await pw.locator('.concealed-value .pw').innerText()) !== 'strom,gas"2026') throw new Error('imported password differs');
  await a.locator('.entry-row', { hasText: 'Bibliothek' }).click();
  const shown = (await a.locator('.totp-code').innerText()).replace(/\s/g, '');
  if (!validCodes('JBSWY3DP').includes(shown)) throw new Error(`imported 2FA code ${shown} is wrong`);
  if ((await a.locator('.entry-row', { hasText: 'GitHub' }).count()) !== 1) throw new Error('duplicate was imported');
});

await step('reveal and copy password', async () => {
  await a.locator('.entry-row', { hasText: 'GitHub' }).click();
  const pw = a.locator('.concealed-field').first();
  await pw.getByRole('button', { name: 'Anzeigen' }).click();
  if ((await pw.locator('.concealed-value .pw').innerText()) !== generated) throw new Error('revealed password differs');
  await pw.getByRole('button', { name: 'Kopieren' }).click();
  await a.getByText(/Kopiert\./).waitFor();
  if ((await a.evaluate(() => navigator.clipboard.readText())) !== generated) throw new Error('clipboard mismatch');
  await shot(a, '4-detail');
});

await step('editing a password keeps the old one', async () => {
  await a.getByRole('button', { name: 'Bearbeiten' }).click();
  await a.locator('#field-password').fill('ganz-neues-passwort-2026');
  await a.getByRole('button', { name: 'Speichern' }).click();
  await a.getByText('Frühere Werte (1)').waitFor();
});

await step('add a 2FA key and see the current code', async () => {
  await a.getByRole('button', { name: 'Bearbeiten' }).click();
  await a.getByRole('button', { name: 'Einmalcode (2FA) hinzufügen' }).click();
  await a.getByLabel('Schlüssel', { exact: true }).fill('otpauth://totp/GitHub:melone?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GitHub');
  await a.getByText('Aktueller Code:', { exact: false }).waitFor();
  await a.getByRole('button', { name: 'Speichern' }).click();
  const code = a.locator('.totp-field');
  await code.waitFor();
  const shown = (await code.locator('.totp-code').innerText()).replace(/\s/g, '');
  if (!validCodes('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').includes(shown)) throw new Error(`2FA code ${shown} is wrong`);
  await shot(a, '4b-totp');
  await code.getByRole('button', { name: 'Code kopieren' }).click();
  const copied = await a.evaluate(() => navigator.clipboard.readText());
  if (!validCodes('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').includes(copied)) throw new Error('copied 2FA code is wrong');
});

await step('security check lists weak and reused passwords', async () => {
  await newItem(a, 'Login');
  await a.getByLabel('Titel').fill('Bibliothek Familie');
  await a.locator('#field-password').fill('buecher!');
  await a.getByText('Schwach', { exact: false }).first().waitFor();
  await a.getByRole('button', { name: 'Speichern' }).click();
  await a.getByRole('heading', { name: 'Bibliothek Familie', level: 2 }).waitFor();
  await a.locator('.security-nav').click();
  const check = a.locator('.security-check');
  await check.getByText('Mehrfach verwendet: 2 Einträge').waitFor();
  await check.getByText('Schwach:', { exact: false }).waitFor();
  await check.getByRole('button', { name: 'Jetzt abgleichen' }).waitFor();
  await shot(a, '4c-security-check');
  await check.locator('section[aria-labelledby="audit-reused"] .audit-row', { hasText: 'Bibliothek Familie' }).click();
  await a.getByRole('heading', { name: 'Bibliothek Familie', level: 2 }).waitFor();
});

let inviteLink = '';
await step('shared vault and invite link', async () => {
  await a.getByRole('button', { name: 'Neuer Bereich' }).click();
  await a.getByLabel('Name').fill('Familie');
  await a.getByRole('button', { name: 'Bereich anlegen' }).click();
  const dialog = a.getByRole('dialog', { name: 'Familie' });
  await dialog.waitFor();
  await dialog.getByLabel('E-Mail').fill(bob.email);
  expect404 = true;
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  const linkField = dialog.getByLabel('Einladungslink');
  await linkField.waitFor();
  inviteLink = await linkField.inputValue();
  if (!inviteLink.includes('/#/invite/')) throw new Error(`unexpected link ${inviteLink}`);
  await shot(a, '5-vault-dialog');
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
  await a.locator('main .MuiChip-label', { hasText: /^Familie$/ }).waitFor();
});

await step('export encrypted and as CSV, import the encrypted file again', async () => {
  const exportPassword = 'Export-Passwort-fuer-Tests!';
  const openExport = async () => {
    await a.getByRole('button', { name: 'Exportieren' }).click();
    const dialog = a.getByRole('dialog', { name: 'Exportieren' });
    await dialog.waitFor();
    return dialog;
  };

  let dialog = await openExport();
  await dialog.getByLabel('Export-Passwort', { exact: true }).fill(exportPassword);
  await dialog.getByLabel('Export-Passwort wiederholen').fill(exportPassword);
  await dialog.getByLabel('Master-Passwort zur Bestätigung').fill('falsch falsch falsch');
  await dialog.getByRole('button', { name: 'Verschlüsselt exportieren' }).click();
  await dialog.getByText('Das Master-Passwort stimmt nicht.').waitFor({ timeout: 30000 });
  await dialog.getByLabel('Master-Passwort zur Bestätigung').fill(alice.master);
  await shot(a, '4b-export');
  const [encrypted] = await Promise.all([
    a.waitForEvent('download', { timeout: 30000 }),
    dialog.getByRole('button', { name: 'Verschlüsselt exportieren' }).click(),
  ]);
  const file = await (await import('node:fs/promises')).readFile(await encrypted.path(), 'utf8');
  if (!encrypted.suggestedFilename().endsWith('.melon.json')) throw new Error(`unexpected name ${encrypted.suggestedFilename()}`);
  if (!file.includes('"melonapp-export"') || file.includes('Stadtwerke') || file.includes('wlan-geheim')) throw new Error('export is not encrypted');
  await dialog.getByRole('button', { name: 'Fertig' }).click();

  dialog = await openExport();
  await dialog.getByLabel('Unverschlüsselt (CSV)', { exact: false }).check();
  const plain = dialog.getByRole('button', { name: 'Unverschlüsselt exportieren' });
  await dialog.getByLabel('Master-Passwort zur Bestätigung').fill(alice.master);
  if (await plain.isEnabled()) throw new Error('CSV export possible without confirming the warning');
  await dialog.getByLabel('Ich verstehe', { exact: false }).check();
  const [csv] = await Promise.all([a.waitForEvent('download', { timeout: 30000 }), plain.click()]);
  const csvText = await (await import('node:fs/promises')).readFile(await csv.path(), 'utf8');
  if (!csv.suggestedFilename().includes('UNVERSCHLUESSELT')) throw new Error('CSV name does not warn');
  if (!csvText.startsWith('folder,favorite,type,name') || !csvText.includes('Stadtwerke') || !csvText.includes('wlan-geheim-12345')) {
    throw new Error('CSV export incomplete');
  }
  await dialog.getByText('Klartext', { exact: false }).first().waitFor();
  await dialog.getByRole('button', { name: 'Fertig' }).click();

  await a.getByRole('button', { name: 'Neuer Bereich' }).click();
  await a.getByLabel('Name').fill('Wiederhergestellt');
  await a.getByRole('button', { name: 'Bereich anlegen' }).click();
  await a.getByRole('dialog', { name: 'Wiederhergestellt' }).getByRole('button', { name: 'Schließen' }).click();

  await a.getByRole('button', { name: 'Importieren' }).first().click();
  const imp = a.getByRole('dialog', { name: 'Passwörter importieren' });
  await imp.getByLabel('Export-Datei').setInputFiles({ name: encrypted.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(file) });
  await imp.getByLabel('Export-Passwort').fill('nicht das richtige');
  await imp.getByRole('button', { name: 'Öffnen' }).click();
  await imp.getByText('Das Export-Passwort stimmt nicht.').waitFor({ timeout: 30000 });
  await imp.getByLabel('Export-Passwort').fill(exportPassword);
  await imp.getByRole('button', { name: 'Öffnen' }).click();
  await imp.getByText('Erkannt: MelonApp (verschlüsselt)', { exact: false }).waitFor({ timeout: 30000 });
  await imp.getByLabel('In diesen Bereich').click();
  await a.getByRole('option', { name: 'Wiederhergestellt' }).click();
  await imp.getByRole('button', { name: /importieren$/ }).click();
  await imp.getByText('importiert.', { exact: false }).waitFor({ timeout: 30000 });
  await imp.getByRole('button', { name: 'Fertig' }).click();
  const restored = a.locator('.entry-row', { hasText: 'Stadtwerke' });
  await restored.first().waitFor();
  if ((await restored.count()) !== 1) throw new Error('the imported vault should hold exactly one copy');
  await restored.first().click();
  const pw = a.locator('.concealed-field').first();
  await pw.getByRole('button', { name: 'Anzeigen' }).click();
  if ((await pw.locator('.concealed-value .pw').innerText()) !== 'strom,gas"2026') throw new Error('password changed on the way through the export');
  await a.locator('.entry-row', { hasText: 'WLAN Zuhause' }).first().waitFor();

  await a.getByRole('button', { name: 'Wiederhergestellt: Mitglieder und Einstellungen' }).click();
  const space = a.getByRole('dialog', { name: 'Wiederhergestellt' });
  await space.getByRole('button', { name: 'Bereich löschen' }).click();
  await a.getByRole('button', { name: 'Endgültig löschen' }).click();
  await a.locator('.entry-row', { hasText: 'Stadtwerke' }).first().waitFor();
  await a.waitForFunction(() => document.querySelectorAll('.entry-row').length > 0);
  if ((await a.getByRole('button', { name: 'Wiederhergestellt: Mitglieder und Einstellungen' }).count()) !== 0) {
    throw new Error('test vault was not deleted');
  }
});

await step('trash: undo, restore and delete for good', async () => {
  const row = () => a.locator('.entry-row', { hasText: 'Bibliothek Familie' });
  const trashNav = a.locator('.trash-nav');
  const toTrash = async () => {
    await row().click();
    await a.getByRole('button', { name: 'In den Papierkorb' }).click();
    await row().waitFor({ state: 'detached' });
  };

  await a.locator('nav[aria-label="Bereiche"]').getByText('Alle Einträge').click();
  await toTrash();
  await a.getByText('liegt im Papierkorb', { exact: false }).waitFor();
  await a.getByRole('button', { name: 'Rückgängig' }).click();
  await row().waitFor();

  await toTrash();
  await trashNav.getByText('1 Eintrag').waitFor();
  await trashNav.click();
  await row().click();
  await a.locator('.trash-notice').getByText('endgültig gelöscht', { exact: false }).waitFor();
  await shot(a, '4c-trash');
  if (await a.getByRole('button', { name: 'Bearbeiten' }).count()) throw new Error('trashed item can be edited');
  await a.getByRole('button', { name: 'Wiederherstellen' }).click();
  await a.getByText('Der Papierkorb ist leer.').waitFor();
  await a.locator('nav[aria-label="Bereiche"]').getByText('Alle Einträge').click();
  await row().waitFor();

  await toTrash();
  await trashNav.click();
  await row().click();
  await a.getByRole('button', { name: 'Endgültig löschen' }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Endgültig löschen' }).click();
  await a.getByText('Der Papierkorb ist leer.').waitFor();
  await a.locator('nav[aria-label="Bereiche"]').getByText('Alle Einträge').click();
  await a.locator('.entry-row', { hasText: 'Stadtwerke' }).first().waitFor();
  if (await row().count()) throw new Error('deleted item came back');
});

const b = await newPage();
await step('bob registers through the invite link and waits', async () => {
  current = b;
  await b.goto(inviteLink.replace(/^https?:\/\/[^/]+/, BASE));
  await b.getByText(`${alice.email} hat dich eingeladen`, { exact: false }).waitFor();
  if ((await b.getByLabel('E-Mail').inputValue()) !== bob.email) throw new Error('invite e-mail not prefilled');
  await register(b, bob);
  await b.getByText('Wartet auf Freigabe').first().waitFor({ timeout: 30000 });
  await shot(b, '6-bob-pending');
});

await step('alice grants the key automatically, bob sees the entry', async () => {
  current = a;
  await sync(a);
  await a.waitForTimeout(1500);
  current = b;
  await b.getByRole('tab', { name: 'Passwörter' }).click();
  for (let i = 0; i < 10 && !(await b.locator('.entry-row', { hasText: 'WLAN Zuhause' }).count()); i++) {
    await sync(b);
    await b.waitForTimeout(700);
  }
  await b.locator('.entry-row', { hasText: 'WLAN Zuhause' }).click();
  const pw = b.locator('.concealed-field').first();
  await pw.getByRole('button', { name: 'Anzeigen' }).click();
  if ((await pw.locator('.concealed-value .pw').innerText()) !== 'wlan-geheim-12345') throw new Error('bob cannot read the shared password');
  if (await b.locator('.entry-row', { hasText: 'GitHub' }).count()) throw new Error('bob must not see alice\'s personal vault');
  await shot(b, '7-bob-shared');
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

await step('re-adding bob shows his security code first', async () => {
  current = b;
  await b.getByRole('button', { name: 'Konto' }).click();
  await b.getByRole('heading', { name: 'Konto', level: 1 }).waitFor();
  await b.locator('[data-row="code"]').getByRole('button', { name: 'Anzeigen' }).click();
  await b.locator('.security-code').filter({ hasText: /\d/ }).waitFor();
  const bobCode = await b.locator('.security-code').innerText();
  await b.getByRole('tab', { name: 'Passwörter' }).click();

  current = a;
  await a.getByRole('button', { name: 'Familie: Mitglieder und Einstellungen' }).click();
  const dialog = a.getByRole('dialog', { name: 'Familie' });
  await dialog.getByLabel('E-Mail').fill(bob.email);
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  const confirm = a.getByRole('dialog', { name: 'Sicherheitscode vergleichen' });
  await confirm.locator('.security-code').waitFor();
  const shown = await confirm.locator('.security-code').innerText();
  if (shown !== bobCode) throw new Error(`security codes differ: ${shown} vs ${bobCode}`);
  await shot(a, '7b-compare-code');
  await confirm.getByRole('button', { name: 'Code stimmt, hinzufügen' }).click();
  await dialog.getByText(`${bob.email} ist eingeladen.`, { exact: false }).waitFor({ timeout: 15000 });
  const bobRow = dialog.getByRole('listitem').filter({ hasText: bob.email });
  await bobRow.getByText('Hat noch nicht zugestimmt.', { exact: false }).waitFor();
  await bobRow.getByText('Code geprüft').waitFor();
  await bobRow.getByRole('button', { name: `Sicherheitscode von ${bob.email}` }).click();
  const codeDialog = a.getByRole('dialog', { name: `Sicherheitscode von ${bob.email}` });
  await codeDialog.getByText('Du hast diesen Code geprüft.').waitFor();
  await codeDialog.getByRole('button', { name: 'Markierung entfernen' }).click();
  await codeDialog.getByRole('button', { name: 'Code stimmt überein' }).waitFor({ timeout: 15000 });
  if (await bobRow.getByText('Code geprüft').count()) throw new Error('mark still shown after removing it');
  await codeDialog.getByRole('button', { name: 'Code stimmt überein' }).click();
  await codeDialog.getByText('Du hast diesen Code geprüft.').waitFor({ timeout: 15000 });
  await codeDialog.getByRole('button', { name: 'Schließen' }).click();
  await bobRow.getByText('Code geprüft').waitFor();
  await dialog.getByRole('button', { name: 'Schließen' }).click();

  current = b;
  await sync(b);
  await b.waitForTimeout(1500);
  if (await b.locator('.vault-row', { hasText: 'Familie' }).count()) throw new Error('bob sees the vault before accepting it');
  await b.getByRole('tab', { name: 'Start' }).click();
  const offer = b.locator('.space-offers').getByText(`${alice.email} möchte einen Bereich mit dir teilen`, { exact: false });
  for (let i = 0; i < 10 && !(await offer.count()); i++) {
    await sync(b);
    await b.waitForTimeout(700);
  }
  await offer.waitFor();
  await shot(b, '7c-offer');
  await b.locator('.space-offers').getByRole('button', { name: 'Annehmen' }).click();
  await b.locator('.space-offers').waitFor({ state: 'detached', timeout: 15000 });
  await b.getByRole('tab', { name: 'Passwörter' }).click();
  for (let i = 0; i < 10 && !(await b.locator('.entry-row', { hasText: 'WLAN Zuhause' }).count()); i++) {
    await sync(b);
    await b.waitForTimeout(700);
  }
  await b.locator('.entry-row', { hasText: 'WLAN Zuhause' }).waitFor();
});

await step('alice reads the re-encrypted vault after unlocking again', async () => {
  current = a;
  await a.reload();
  if ((await a.getByLabel('E-Mail').inputValue()) !== alice.email) throw new Error('email not remembered');
  await a.getByLabel('Master-Passwort', { exact: true }).fill(alice.master);
  await a.getByRole('button', { name: 'Entsperren' }).click();
  await a.locator('.entry-row', { hasText: 'WLAN Zuhause' }).waitFor({ timeout: 30000 });
  await a.locator('.entry-row', { hasText: 'WLAN Zuhause' }).click();
  const pw = a.locator('.concealed-field').first();
  await pw.getByRole('button', { name: 'Anzeigen' }).click();
  if ((await pw.locator('.concealed-value .pw').innerText()) !== 'wlan-geheim-12345') throw new Error('rotated entry unreadable');
});

await step('devices: see the other device and sign it out', async () => {
  const other = await newPage();
  await other.goto(BASE);
  await other.getByLabel('E-Mail').fill(alice.email);
  await other.getByLabel('Master-Passwort', { exact: true }).fill(alice.master);
  await other.getByRole('button', { name: 'Entsperren' }).click();
  await other.getByRole('button', { name: 'Konto' }).waitFor({ timeout: 30000 });

  await a.getByRole('button', { name: 'Konto' }).click();
  const devices = a.locator('section[aria-labelledby="account-devices"]');
  await devices.getByText('Dieses Gerät', { exact: false }).waitFor();
  const others = devices.locator('.account-row').filter({ hasNotText: 'Dieses Gerät' });
  await others.first().waitFor();
  if (!(await others.first().innerText()).includes('Chrome auf Linux')) throw new Error('device name missing');
  await shot(a, '7b-devices');

  expect401 = true;
  const many = await others.count();
  if (many > 1) await devices.getByRole('button', { name: 'Alle anderen Geräte abmelden' }).click();
  else await others.first().getByRole('button', { name: 'Abmelden' }).click();
  await a.getByText(many > 1 ? 'Alle anderen Geräte abgemeldet.' : 'abgemeldet.', { exact: false }).waitFor();
  await others.first().waitFor({ state: 'detached' });

  await other.evaluate(() => window.dispatchEvent(new Event('focus')));
  await other.getByText('Deine Sitzung ist abgelaufen', { exact: false }).waitFor({ timeout: 15000 });
  await other.context().close();
  expect401 = false;
});

await step('security code and master password change', async () => {
  await a.getByRole('button', { name: 'Konto' }).click();
  await a.getByRole('heading', { name: 'Konto', level: 1 }).waitFor();
  await a.locator('[data-row="kit"]').getByText('Eingerichtet', { exact: false }).waitFor();
  await a.locator('[data-row="audit"]').getByText(/[0-9]+ Hinweis/).waitFor();
  await a.locator('[data-row="code"]').getByRole('button', { name: 'Anzeigen' }).click();
  await a.locator('.security-code').filter({ hasText: /\d/ }).waitFor();
  const code = await a.locator('.security-code').innerText();
  if (!/^\d{5}( \d{5}){5}$/.test(code)) throw new Error(`unexpected security code ${code}`);
  await shot(a, '8-account');
  await a.locator('[data-row="password"]').getByRole('button', { name: 'Ändern' }).click();
  const dialog = a.getByRole('dialog', { name: 'Master-Passwort ändern' });
  await dialog.getByLabel('Aktuelles Master-Passwort', { exact: true }).fill(alice.master);
  await dialog.getByLabel('Neues Master-Passwort', { exact: true }).fill('kurz');
  if (!(await dialog.getByRole('button', { name: 'Master-Passwort ändern' }).isDisabled())) throw new Error('short password accepted');
  await dialog.getByLabel('Neues Master-Passwort', { exact: true }).fill('neues master passwort fuer alice');
  await dialog.getByLabel('Neues Master-Passwort wiederholen', { exact: true }).fill('neues master passwort fuer alice');
  await dialog.getByText('Stimmt überein.').waitFor();
  await shot(a, '8b-change-password');
  await dialog.getByRole('button', { name: 'Master-Passwort ändern' }).click();
  await a.getByText('Master-Passwort geändert.', { exact: false }).waitFor({ timeout: 30000 });
  alice.master = 'neues master passwort fuer alice';
  await a.locator('[data-row="mode"]').getByRole('button', { name: 'Dunkel' }).click();
  await a.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await shot(a, '8c-account-dark');
  await a.locator('[data-row="mode"]').getByRole('button', { name: 'System', exact: true }).click();
  await a.getByRole('tab', { name: 'Passwörter' }).click();
});

await step('wrong password is rejected', async () => {
  expect401 = true;
  await a.getByRole('button', { name: 'Sperren' }).click();
  await a.getByLabel('Master-Passwort', { exact: true }).fill('falsches passwort hier');
  await a.getByRole('button', { name: 'Entsperren' }).click();
  await a.getByText('E-Mail oder Master-Passwort ist falsch.').waitFor({ timeout: 30000 });
});

await step('forgotten master password, recovered with the kit', async () => {
  await a.getByRole('button', { name: 'Master-Passwort vergessen?' }).click();
  await a.getByLabel('E-Mail').fill(alice.email);
  await a.getByLabel('Recovery-Key').fill(recoveryKey.toLowerCase().replaceAll('-', ' '));
  await a.getByLabel('Neues Master-Passwort', { exact: true }).fill('wiederhergestellt mit dem kit');
  await a.getByLabel('Neues Master-Passwort wiederholen').fill('wiederhergestellt mit dem kit');
  await shot(a, '9-recover');
  await a.getByRole('button', { name: 'Neues Master-Passwort setzen' }).click();
  await a.locator('.entry-row', { hasText: 'GitHub' }).waitFor({ timeout: 30000 });
  alice.master = 'wiederhergestellt mit dem kit';
  await a.locator('.entry-row', { hasText: 'WLAN Zuhause' }).click();
  const pw = a.locator('.concealed-field').first();
  await pw.getByRole('button', { name: 'Anzeigen' }).click();
  if ((await pw.locator('.concealed-value .pw').innerText()) !== 'wlan-geheim-12345') throw new Error('shared vault unreadable after recovery');
});

await step('mobile and dark mode', async () => {
  const m = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  current = m;
  await m.goto(BASE);
  await m.getByLabel('E-Mail').fill(alice.email);
  await m.getByLabel('Master-Passwort', { exact: true }).fill(alice.master);
  await m.getByRole('button', { name: 'Entsperren' }).click();
  await m.getByRole('heading', { name: 'Start', level: 1 }).waitFor({ timeout: 30000 });
  await shot(m, '10a-mobile-home');
  await m.getByRole('button', { name: 'Passwörter', exact: true }).click();
  await m.locator('.entry-row', { hasText: 'GitHub' }).waitFor({ timeout: 30000 });
  await shot(m, '10-mobile-list');
  await m.getByRole('button', { name: 'Bereiche anzeigen' }).click();
  await m.getByRole('button', { name: /^Familie/ }).first().waitFor();
  await shot(m, '11-mobile-drawer');
  await m.keyboard.press('Escape');
  await m.getByRole('button', { name: 'Konto' }).click();
  await m.getByRole('heading', { name: 'Konto', level: 1 }).waitFor();
  await shot(m, '12-mobile-account');
});

await browser.close();
if (problems.length) {
  console.log('PROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('ALL GREEN');
