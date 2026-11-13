import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CssBaseline from '@mui/material/CssBaseline';
import GlobalStyles from '@mui/material/GlobalStyles';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ThemeProvider } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MelonMark } from '@web/components/Brand';
import { theme } from '@web/theme';
import type { FrameRequest, PendingSave } from '../shared/messages';
import { PendingCard } from '../popup/PendingCard';
import { restore, type Unlocked } from '../popup/state';
import { SAVE_PROMPT_ARM_MS } from '../shared/messages';

const send = (msg: FrameRequest) => chrome.runtime.sendMessage(msg).catch(() => undefined);
const close = () => void send({ type: 'closeSavePrompt' });

function SavePrompt() {
  const [state, setState] = useState<{ pending: PendingSave; unlocked: Unlocked | null } | 'loading'>('loading');
  const [saved, setSaved] = useState(false);
  const [armed, setArmed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const pending = (await send({ type: 'savePromptPending' })) as PendingSave | null | undefined;
      if (!pending) return close();
      const unlocked = await restore(false).catch(() => null);
      setState({ pending, unlocked });
    })();
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      setArmed(false);
      if (document.visibilityState === 'visible') timer = setTimeout(() => setArmed(true), SAVE_PROMPT_ARM_MS);
    };
    arm();
    document.addEventListener('visibilitychange', arm);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', arm);
    };
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() => void send({ type: 'resizeSavePrompt', height: Math.ceil(el.getBoundingClientRect().height) }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(close, 1500);
    return () => clearTimeout(t);
  }, [saved]);

  return (
    <Box ref={root} sx={{ pointerEvents: armed ? 'auto' : 'none' }} aria-busy={!armed}>
      <Paper sx={{ borderRadius: '16px', overflow: 'hidden', border: 1, borderColor: 'divider' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, px: 2, pt: 1.5 }}>
          <MelonMark size={24} />
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            MelonApp
          </Typography>
          <IconButton size="small" aria-label="Schließen" onClick={close}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        {state === 'loading' ? (
          <Box sx={{ p: 2 }} />
        ) : saved ? (
          <Typography sx={{ p: 2, fontWeight: 700 }} role="status">
            Gespeichert.
          </Typography>
        ) : state.unlocked ? (
          <PendingCard
            unlocked={state.unlocked}
            pending={state.pending}
            outlined={false}
            onDone={(_, didSave) => (didSave ? setSaved(true) : close())}
            onNever={() => void send({ type: 'neverSave' })}
          />
        ) : (
          <Stack spacing={1.5} sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 700 }}>Neuen Login speichern?</Typography>
            <Typography variant="body2" color="text.secondary">
              MelonApp ist gesperrt. Klicke oben in der Browserleiste auf das Melonen-Symbol, entsperre dort und speichere den
              Login. Hier fragt MelonApp nie nach deinem Master-Passwort.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => void send({ type: 'dismissSavePrompt' })}>
                Verwerfen
              </Button>
              <Button size="small" onClick={close}>
                Später
              </Button>
            </Stack>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}

const el = document.getElementById('root');
if (!el) throw new Error('root element missing');

createRoot(el).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <GlobalStyles styles={{ 'html, body': { background: 'transparent', margin: 0 } }} />
      <SavePrompt />
    </ThemeProvider>
  </StrictMode>,
);
