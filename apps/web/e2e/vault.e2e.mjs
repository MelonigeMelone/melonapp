import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost';
const OUT = process.env.OUT ?? '/out';
const email = `e2e-${Date.now()}@example.com`;
const master = 'korrekt pferd batterie heftklammer';
const problems = [];
let expect401 = false;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: 'light' });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' && !(expect401 && m.text().includes('401'))) problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
  } catch (e) {
    await page.screenshot({ path: `${OUT}/fail.png`, animations: 'disabled' });
    const errs = await page.locator('.form-error, .sync-error, .field-error').allInnerTexts();
    console.log('FAILED', name, errs, problems);
    throw e;
  }
  console.log(`ok  ${name} (${Date.now() - t} ms)`);
};

await step('open app', async () => {
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'MelonApp' }).waitFor();
  await page.screenshot({ path: `${OUT}/1-auth.png`, animations: 'disabled' });
});

await step('register', async () => {
  await page.getByRole('tab', { name: 'Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Master-Passwort', { exact: true }).fill(master);
  await page.getByLabel('Master-Passwort wiederholen').fill(master);
  await page.getByRole('button', { name: 'Konto erstellen' }).last().click();
  await page.getByText('Noch keine Einträge.').waitFor({ timeout: 30000 });
});

let generated = '';
await step('create entry with generated password', async () => {
  await page.getByRole('button', { name: 'Neuer Eintrag' }).click();
  await page.getByLabel('Titel').fill('GitHub');
  await page.getByLabel('Benutzername oder E-Mail').fill('melone');
  await page.locator('.generator-output .pw').waitFor();
  await page.screenshot({ path: `${OUT}/2-editor.png`, animations: 'disabled' });
  await page.getByRole('button', { name: 'Dieses Passwort verwenden' }).click();
  generated = await page.locator('#entry-password').inputValue();
  if (generated.length !== 20) throw new Error(`generated length ${generated.length}`);
  await page.getByLabel('Websites, eine pro Zeile').fill('github.com');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('heading', { name: 'GitHub', level: 2 }).waitFor();
});

await step('second entry + search', async () => {
  await page.getByRole('button', { name: 'Neuer Eintrag' }).click();
  await page.getByLabel('Titel').fill('Sparkasse');
  await page.getByLabel('Benutzername oder E-Mail').fill('konto-4711');
  await page.locator('#entry-password').fill('Ill1O0o-verwechselbar');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('heading', { name: 'Sparkasse', level: 2 }).waitFor();
  await page.getByRole('searchbox').fill('git');
  if ((await page.locator('.entry-row').count()) !== 1) throw new Error('search did not filter');
  await page.getByRole('searchbox').fill('');
});

await step('reveal and copy password', async () => {
  await page.getByRole('button', { name: /^GitHub/ }).click();
  await page.getByRole('button', { name: 'Anzeigen' }).click();
  const shown = await page.locator('.password-stage .pw').innerText();
  if (shown !== generated) throw new Error('revealed password differs');
  await page.locator('.password-view').getByRole('button', { name: 'Kopieren' }).click();
  await page.getByText(/Kopiert\./).waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (clip !== generated) throw new Error('clipboard mismatch');
  await page.screenshot({ path: `${OUT}/3-detail.png`, animations: 'disabled' });
});

await step('edit password keeps history', async () => {
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.locator('#entry-password').fill('ganz-neues-passwort-2026');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByText('Frühere Passwörter (1)').waitFor();
});

await step('reload, unlock again, data decrypts', async () => {
  await page.reload();
  const field = page.getByLabel('E-Mail');
  if ((await field.inputValue()) !== email) throw new Error('email not remembered');
  await page.getByLabel('Master-Passwort', { exact: true }).fill(master);
  await page.getByRole('button', { name: 'Tresor öffnen' }).click();
  await page.getByRole('button', { name: /^Sparkasse/ }).waitFor({ timeout: 30000 });
});

await step('wrong password is rejected', async () => {
  expect401 = true;
  await page.getByRole('button', { name: 'Sperren' }).click();
  await page.getByLabel('Master-Passwort', { exact: true }).fill('falsches passwort hier');
  await page.getByRole('button', { name: 'Tresor öffnen' }).click();
  await page.getByText('E-Mail oder Master-Passwort ist falsch.').waitFor({ timeout: 30000 });
});

await step('mobile and dark mode', async () => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const m = await mobile.newPage();
  m.on('pageerror', (e) => problems.push(`mobile pageerror: ${e.message}`));
  await m.goto(BASE);
  await m.getByLabel('E-Mail').fill(email);
  await m.getByLabel('Master-Passwort', { exact: true }).fill(master);
  await m.getByRole('button', { name: 'Tresor öffnen' }).click();
  await m.getByRole('button', { name: /^GitHub/ }).waitFor({ timeout: 30000 });
  await m.screenshot({ path: `${OUT}/4-mobile-list.png`, animations: 'disabled' });
  await m.getByRole('button', { name: /^Sparkasse/ }).click();
  await m.getByRole('button', { name: 'Anzeigen' }).click();
  await m.screenshot({ path: `${OUT}/5-mobile-detail.png`, animations: 'disabled' });
  await mobile.close();
});

await browser.close();
console.log(`email=${email}`);
if (problems.length) {
  console.log('PROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('ALL GREEN');
