import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
const pkg = JSON.parse(readFileSync(`${root}../web/package.json`, 'utf8'));
const version = pkg.version ?? '0.1.0';

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#F2F7F1"/>
  <g transform="translate(0 7)">
    <path d="M2 4a14 14 0 0 0 28 0Z" fill="#2E6A43"/>
    <path d="M5 4a11 11 0 0 0 22 0Z" fill="#A7D3A0"/>
    <path d="M7 4a9 9 0 0 0 18 0Z" fill="#E2365F"/>
    <ellipse cx="12" cy="7.5" rx="0.9" ry="1.4" fill="#1C241F"/>
    <ellipse cx="16" cy="10" rx="0.9" ry="1.4" fill="#1C241F"/>
    <ellipse cx="20" cy="7.5" rx="0.9" ry="1.4" fill="#1C241F"/>
  </g>
</svg>`;

const sizes = [16, 32, 48, 128];
mkdirSync(`${dist}/icons`, { recursive: true });
for (const size of sizes) {
  await sharp(Buffer.from(icon)).resize(size, size).png().toFile(`${dist}/icons/icon-${size}.png`);
}
const icons = Object.fromEntries(sizes.map((s) => [String(s), `icons/icon-${s}.png`]));

const base = {
  manifest_version: 3,
  name: 'MelonApp',
  version,
  description: 'Logins aus deiner MelonApp ausfüllen und neue speichern. Ende-zu-Ende verschlüsselt.',
  icons,
  action: { default_popup: 'popup.html', default_title: 'MelonApp', default_icon: icons },
  permissions: ['storage', 'activeTab', 'alarms'],
  host_permissions: ['<all_urls>'],
  content_scripts: [{ matches: ['http://*/*', 'https://*/*'], js: ['content.js'], run_at: 'document_idle', all_frames: false }],
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
};

const exposed = ['save.html', 'assets/*', 'icons/*'];

const targets = {
  chromium: {
    ...base,
    background: { service_worker: 'background.js' },
    minimum_chrome_version: '120',
    web_accessible_resources: [{ resources: exposed, matches: ['http://*/*', 'https://*/*'], use_dynamic_url: true }],
  },
  firefox: {
    ...base,
    background: { scripts: ['background.js'] },
    web_accessible_resources: [{ resources: exposed, matches: ['http://*/*', 'https://*/*'] }],
    browser_specific_settings: { gecko: { id: 'melonapp@melonigemelone.de', strict_min_version: '128.0' } },
  },
};

for (const [name, manifest] of Object.entries(targets)) {
  const out = `${root}build/${name}`;
  rmSync(out, { recursive: true, force: true });
  cpSync(dist, out, { recursive: true });
  writeFileSync(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`built ${out}`);
}
