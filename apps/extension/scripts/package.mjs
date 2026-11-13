import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
const pkg = JSON.parse(readFileSync(`${root}../web/package.json`, 'utf8'));
const version = pkg.version ?? '0.1.0';

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9686FF"/><stop offset="1" stop-color="#5CC8FF"/></linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.2" r="0.9"><stop offset="0" stop-color="#2A1F6B"/><stop offset="1" stop-color="#05060A"/></radialGradient>
  </defs>
  <rect width="32" height="32" rx="7" fill="url(#glow)"/>
  <g transform="translate(0 7)">
    <path d="M2 4a14 14 0 0 0 28 0Z" fill="url(#g)"/>
    <path d="M5 4a11 11 0 0 0 22 0Z" fill="#05060A" opacity="0.9"/>
    <path d="M7 4a9 9 0 0 0 18 0Z" fill="url(#g)" opacity="0.55"/>
    <ellipse cx="12" cy="7.5" rx="0.9" ry="1.4" fill="#C4A8FF"/>
    <ellipse cx="16" cy="10" rx="0.9" ry="1.4" fill="#C4A8FF"/>
    <ellipse cx="20" cy="7.5" rx="0.9" ry="1.4" fill="#C4A8FF"/>
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
  options_ui: { page: 'options.html', open_in_tab: true },
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
  safari: {
    ...base,
    background: { service_worker: 'background.js' },
    web_accessible_resources: [{ resources: exposed, matches: ['http://*/*', 'https://*/*'] }],
    browser_specific_settings: { safari: { strict_min_version: '18.0' } },
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
