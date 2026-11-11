import Alert from '@mui/material/Alert';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddIcon from '@mui/icons-material/Add';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../api';
import { Brand } from '../components/Brand';
import { describeError, type Session } from '../session';
import { matchesSearch, type PasswordEntry } from '../vault/entry';
import { EntryDetail } from './EntryDetail';
import { EntryEditor } from './EntryEditor';

const SYNC_INTERVAL_MS = 30_000;
const TOOLBAR_HEIGHT = 68;

type Editing = { id: string | null } | null;

export function VaultScreen({ session, onLock }: { session: Session; onLock: (notice?: string) => void }) {
  const { store } = session;
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const wide = useMediaQuery((t) => t.breakpoints.up('md'), { noSsr: true });

  useEffect(() => {
    const run = () =>
      store
        .sync()
        .then(() => setSyncError(null))
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 401) onLock('Deine Sitzung ist abgelaufen. Melde dich erneut an.');
          else setSyncError(describeError(e));
        })
        .finally(() => setLoaded(true));
    void run();
    const timer = setInterval(run, SYNC_INTERVAL_MS);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', run);
    };
  }, [store, onLock]);

  const visible = useMemo(() => items.filter((i) => matchesSearch(i.entry, query)), [items, query]);
  const current = selected ? (items.find((i) => i.id === selected) ?? null) : null;
  const showDetail = editing !== null || current !== null;
  const showList = wide || !showDetail;
  const showDetailPane = wide || showDetail;

  const save = async (entry: PasswordEntry) => {
    const id = await store.save(editing?.id ?? null, entry);
    setEditing(null);
    setSelected(id);
  };

  const remove = async (id: string) => {
    try {
      await store.remove(id);
      setSelected(null);
    } catch (e) {
      setSyncError(describeError(e));
    }
  };

  const startNew = () => setEditing({ id: null });

  return (
    <Box sx={{ minHeight: '100dvh' }}>
      <AppBar>
        <Toolbar sx={{ minHeight: TOOLBAR_HEIGHT, gap: 1 }}>
          <Brand />
          <Box sx={{ flex: 1 }} />
          {wide ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={startNew}>
              Neuer Eintrag
            </Button>
          ) : (
            <Tooltip title="Neuer Eintrag">
              <IconButton aria-label="Neuer Eintrag" onClick={startNew} sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } }}>
                <AddIcon />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Tresor sperren">
            <IconButton aria-label="Sperren" onClick={() => onLock()}>
              <LockOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(16rem, 22rem) minmax(0, 1fr)' } }}>
        {showList && (
          <Box
            component="aside"
            aria-label="Einträge"
            sx={{
              borderRight: { md: 1 },
              borderColor: { md: 'divider' },
              p: 1.5,
              position: { md: 'sticky' },
              top: { md: TOOLBAR_HEIGHT },
              height: { md: `calc(100dvh - ${TOOLBAR_HEIGHT}px)` },
              overflowY: { md: 'auto' },
            }}
          >
            <Stack spacing={1.5}>
              <TextField
                type="search"
                placeholder="Suchen"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                size="small"
                fullWidth
                slotProps={{
                  htmlInput: { 'aria-label': 'Einträge durchsuchen' },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
              />
              {syncError && <Alert severity="warning">{syncError}</Alert>}
              {store.unreadableCount > 0 && (
                <Alert severity="warning">
                  {store.unreadableCount} Einträge ließen sich nicht entschlüsseln und werden ausgeblendet.
                </Alert>
              )}
              {loaded && items.length === 0 ? (
                <Stack spacing={1.5} sx={{ alignItems: 'flex-start', p: 1 }}>
                  <Typography color="text.secondary">Noch keine Einträge.</Typography>
                  <Button variant="contained" startIcon={<AddIcon />} onClick={startNew}>
                    Ersten Eintrag anlegen
                  </Button>
                </Stack>
              ) : (
                <List disablePadding sx={{ display: 'grid', gap: 0.25 }}>
                  {visible.map((item) => (
                    <ListItemButton
                      key={item.id}
                      className="entry-row"
                      selected={item.id === selected && !editing}
                      onClick={() => {
                        setEditing(null);
                        setSelected(item.id);
                      }}
                    >
                      <ListItemAvatar>
                        <Avatar aria-hidden="true">{(item.entry.title.trim()[0] ?? '?').toLocaleUpperCase('de')}</Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={item.entry.title || 'Ohne Titel'}
                        secondary={item.entry.username || item.entry.urls[0] || ' '}
                        slotProps={{
                          primary: { noWrap: true, sx: { fontWeight: 700 } },
                          secondary: { noWrap: true },
                        }}
                      />
                    </ListItemButton>
                  ))}
                  {loaded && items.length > 0 && visible.length === 0 && (
                    <Typography color="text.secondary" sx={{ p: 1 }}>
                      Nichts gefunden für „{query}“.
                    </Typography>
                  )}
                </List>
              )}
            </Stack>
          </Box>
        )}

        {showDetailPane && (
          <Box component="main" sx={{ p: { xs: 2.5, md: 6 }, minWidth: 0 }}>
            {editing ? (
              <EntryEditor
                key={editing.id ?? 'new'}
                isNew={editing.id === null}
                initial={editing.id ? (store.get(editing.id)?.entry ?? null) : null}
                onSave={save}
                onCancel={() => setEditing(null)}
              />
            ) : current ? (
              <EntryDetail
                item={current}
                onEdit={() => setEditing({ id: current.id })}
                onDelete={() => remove(current.id)}
                onBack={() => setSelected(null)}
              />
            ) : (
              <Box sx={{ height: '60vh', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                <Typography color="text.secondary">Wähle links einen Eintrag aus oder lege einen neuen an.</Typography>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
