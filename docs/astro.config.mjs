// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const repo = 'https://github.com/MelonigeMelone/melonapp';

export default defineConfig({
  site: 'https://melonigemelone.github.io',
  base: '/melonapp',
  integrations: [
    starlight({
      title: 'MelonApp',
      description: 'Persönliche All-in-One-App mit Ende-zu-Ende verschlüsseltem Passwortmanager.',
      logo: { src: './src/assets/icon.svg' },
      defaultLocale: 'root',
      locales: { root: { label: 'Deutsch', lang: 'de' } },
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/docs/` },
      lastUpdated: true,
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        { label: 'Konzept', items: [{ autogenerate: { directory: 'konzept' } }] },
        { label: 'Architektur', items: [{ autogenerate: { directory: 'architektur' } }] },
        { label: 'Sicherheit', items: [{ autogenerate: { directory: 'sicherheit' } }] },
        { label: 'Server', items: [{ autogenerate: { directory: 'server' } }] },
        { label: 'Betrieb', items: [{ autogenerate: { directory: 'betrieb' } }] },
        { label: 'Entscheidungen', items: [{ autogenerate: { directory: 'entscheidungen' } }] },
        { label: 'Mitwirken', items: [{ autogenerate: { directory: 'mitwirken' } }] },
      ],
    }),
  ],
});
