import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource-variable/atkinson-hyperlegible-mono';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Aurora } from './components/Aurora';
import { theme } from './theme';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

const nonceTag = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]');
const nonce = nonceTag?.content;
nonceTag?.remove();
const styles = createCache({ key: 'css', nonce: nonce && /^[0-9a-f-]{36}$/.test(nonce) ? nonce : undefined });

createRoot(root).render(
  <StrictMode>
    <CacheProvider value={styles}>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        <Aurora />
        <App />
      </ThemeProvider>
    </CacheProvider>
  </StrictMode>,
);
