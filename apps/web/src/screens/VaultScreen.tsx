import Alert from '@mui/material/Alert';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddIcon from '@mui/icons-material/Add';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../api';
import { Brand } from '../components/Brand';
import { ItemAvatar, TYPE_ICONS } from '../components/TypeIcon';
import { describeError, type Session } from '../session';
import { emptyItem, matchesSearch, subtitle, TEMPLATES, type Item, type ItemType } from '../vault/item';
import { ItemDetail } from './ItemDetail';
import { ItemEditor } from './ItemEditor';
import { NewVaultDialog, VaultDialog } from './VaultDialog';

const SYNC_INTERVAL_MS = 30_000;
const TOOLBAR = 68;
const ALL = 'all';
const TYPE_ORDER: ItemType[] = ['login', 'note', 'card', 'identity', 'wifi'];

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const entries = (n: number) => count(n, 'Eintrag', 'Einträge');

type Selection = { vaultId: string; id: string } | null;
type Editing = { vaultId: string; id: string | null; item: Item } | null;

export function VaultScreen({ session, onLock }: { session: Session; onLock: (notice?: string) => void }) {
  const manager = session.vaults;
  const { vaults, items } = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const [scope, setScope] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selection>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [newMenu, setNewMenu] = useState<HTMLElement | null>(null);
  const [vaultDialog, setVaultDialog] = useState<string | null>(null);
  const [creatingVault, setCreatingVault] = useState(false);
  const wide = useMediaQuery((t) => t.breakpoints.up('md'), { noSsr: true });

  useEffect(() => {
    const run = () =>
      manager
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
  }, [manager, onLock]);

  useEffect(() => {
    if (scope !== ALL && !vaults.some((v) => v.id === scope)) setScope(ALL);
  }, [scope, vaults]);

  const scopeVault = vaults.find((v) => v.id === scope);
  const visible = useMemo(
    () => items.filter((i) => (scope === ALL || i.vaultId === scope) && matchesSearch(i.item, query)),
    [items, scope, query],
  );
  const current = selected ? (items.find((i) => i.vaultId === selected.vaultId && i.id === selected.id) ?? null) : null;
  const writable = vaults.filter((v) => v.canWrite);
  const defaultVault = scopeVault?.canWrite ? scopeVault.id : (writable[0]?.id ?? null);
  const showDetail = editing !== null || current !== null;
  const vaultName = (id: string) => vaults.find((v) => v.id === id)?.name ?? '';

  const startNew = (type: ItemType) => {
    setNewMenu(null);
    if (defaultVault) setEditing({ vaultId: defaultVault, id: null, item: emptyItem(type) });
  };

  const save = async (vaultId: string, item: Item) => {
    if (!editing) return;
    const id = await manager.saveItem(vaultId, editing.id, item, editing.vaultId);
    setEditing(null);
    setSelected({ vaultId, id });
  };

  const remove = async (vaultId: string, id: string) => {
    try {
      await manager.removeItem(vaultId, id);
      setSelected(null);
    } catch (e) {
      setSyncError(describeError(e));
    }
  };

  const nav = (
    <Box component="nav" aria-label="Tresore" sx={{ width: { xs: 280, md: 'auto' }, p: 1.5 }}>
      <List
        disablePadding
        subheader={
          <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: 2.5, px: 1 }}>
            Tresore
          </ListSubheader>
        }
        sx={{ display: 'grid', gap: 0.25 }}
      >
        <ListItemButton
          selected={scope === ALL}
          onClick={() => {
            setScope(ALL);
            setDrawer(false);
          }}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>
            <Inventory2OutlinedIcon />
          </ListItemIcon>
          <ListItemText primary="Alle Einträge" secondary={entries(items.length)} />
        </ListItemButton>
        {vaults.map((v) => {
          const Icon = v.waitingForKey ? HourglassEmptyOutlinedIcon : v.personal ? PersonOutlinedIcon : GroupsOutlinedIcon;
          return (
            <Stack key={v.id} direction="row" sx={{ alignItems: 'center' }}>
              <ListItemButton
                className="vault-row"
                selected={scope === v.id}
                onClick={() => {
                  setScope(v.id);
                  setDrawer(false);
                }}
                sx={{ flex: 1, minWidth: 0 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Icon />
                </ListItemIcon>
                <ListItemText
                  primary={v.name}
                  secondary={
                    v.waitingForKey
                      ? 'Wartet auf Freigabe'
                      : v.personal
                        ? entries(v.itemCount)
                        : `${entries(v.itemCount)}, ${count(v.members.length, 'Person', 'Personen')}`
                  }
                  slotProps={{ primary: { noWrap: true } }}
                />
              </ListItemButton>
              {!v.personal && (
                <Tooltip title="Mitglieder und Einstellungen">
                  <IconButton aria-label={`${v.name}: Mitglieder und Einstellungen`} onClick={() => setVaultDialog(v.id)}>
                    <SettingsOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          );
        })}
      </List>
      <Button startIcon={<AddIcon />} onClick={() => setCreatingVault(true)} sx={{ mt: 1, color: 'text.secondary' }}>
        Neuer Tresor
      </Button>
    </Box>
  );

  const listPane = (
    <Stack spacing={1.5}>
      <TextField
        type="search"
        placeholder={scopeVault ? `In „${scopeVault.name}“ suchen` : 'Suchen'}
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
      {vaults.some((v) => v.unreadable > 0) && (
        <Alert severity="warning">Einige Einträge ließen sich nicht entschlüsseln und werden ausgeblendet.</Alert>
      )}
      {scopeVault?.waitingForKey && (
        <Alert severity="info">
          Du bist eingeladen. Ein Besitzer muss dir den Zugang noch freigeben. Das passiert automatisch, sobald er die App öffnet.
        </Alert>
      )}
      {loaded && visible.length === 0 && !query && !scopeVault?.waitingForKey ? (
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start', p: 1 }}>
          <Typography color="text.secondary">Noch keine Einträge.</Typography>
          {defaultVault && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => startNew('login')}>
              Ersten Eintrag anlegen
            </Button>
          )}
        </Stack>
      ) : (
        <List disablePadding sx={{ display: 'grid', gap: 0.25 }}>
          {visible.map((v) => (
            <ListItemButton
              key={`${v.vaultId}/${v.id}`}
              className="entry-row"
              selected={selected?.id === v.id && selected.vaultId === v.vaultId && !editing}
              onClick={() => {
                setEditing(null);
                setSelected({ vaultId: v.vaultId, id: v.id });
              }}
            >
              <ListItemAvatar>
                <ItemAvatar item={v.item} />
              </ListItemAvatar>
              <ListItemText
                primary={v.item.title || 'Ohne Titel'}
                secondary={scope === ALL && vaults.length > 1 ? `${subtitle(v.item)}, ${vaultName(v.vaultId)}` : subtitle(v.item)}
                slotProps={{ primary: { noWrap: true, sx: { fontWeight: 700 } }, secondary: { noWrap: true } }}
              />
            </ListItemButton>
          ))}
          {query && visible.length === 0 && (
            <Typography color="text.secondary" sx={{ p: 1 }}>
              Nichts gefunden für „{query}“.
            </Typography>
          )}
        </List>
      )}
    </Stack>
  );

  const detail = editing ? (
    <ItemEditor
      key={`${editing.vaultId}/${editing.id ?? 'new'}`}
      initial={editing.item}
      isNew={editing.id === null}
      vaultId={editing.vaultId}
      vaults={vaults}
      onSave={save}
      onCancel={() => setEditing(null)}
    />
  ) : current ? (
    <ItemDetail
      entry={current}
      vault={vaults.find((v) => v.id === current.vaultId)}
      onEdit={() => setEditing({ vaultId: current.vaultId, id: current.id, item: current.item })}
      onDelete={() => remove(current.vaultId, current.id)}
      onBack={() => setSelected(null)}
    />
  ) : (
    <Box sx={{ height: '60vh', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
      <Typography color="text.secondary">Wähle einen Eintrag aus oder lege einen neuen an.</Typography>
    </Box>
  );

  const dialogVault = vaults.find((v) => v.id === vaultDialog);

  return (
    <Box sx={{ minHeight: '100dvh' }}>
      <AppBar>
        <Toolbar sx={{ minHeight: TOOLBAR, gap: 1 }}>
          {!wide && (
            <IconButton aria-label="Tresore anzeigen" onClick={() => setDrawer(true)} edge="start">
              <MenuIcon />
            </IconButton>
          )}
          <Brand />
          <Box sx={{ flex: 1 }} />
          {wide ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={(e) => setNewMenu(e.currentTarget)}
              disabled={!defaultVault}
              aria-haspopup="menu"
            >
              Neuer Eintrag
            </Button>
          ) : (
            <IconButton
              aria-label="Neuer Eintrag"
              onClick={(e) => setNewMenu(e.currentTarget)}
              disabled={!defaultVault}
              sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } }}
            >
              <AddIcon />
            </IconButton>
          )}
          <Tooltip title="Tresor sperren">
            <IconButton aria-label="Sperren" onClick={() => onLock()}>
              <LockOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Menu anchorEl={newMenu} open={newMenu !== null} onClose={() => setNewMenu(null)}>
        {TYPE_ORDER.map((t) => {
          const Icon = TYPE_ICONS[t];
          return (
            <MenuItem key={t} onClick={() => startNew(t)}>
              <ListItemIcon>
                <Icon fontSize="small" />
              </ListItemIcon>
              {TEMPLATES[t].label}
            </MenuItem>
          );
        })}
      </Menu>

      {!wide && (
        <Drawer open={drawer} onClose={() => setDrawer(false)}>
          {nav}
        </Drawer>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(14rem, 17rem) minmax(16rem, 22rem) minmax(0, 1fr)' },
        }}
      >
        {wide && (
          <Box sx={{ borderRight: 1, borderColor: 'divider', position: 'sticky', top: TOOLBAR, height: `calc(100dvh - ${TOOLBAR}px)`, overflowY: 'auto' }}>
            {nav}
          </Box>
        )}
        {(wide || !showDetail) && (
          <Box
            component="aside"
            aria-label="Einträge"
            sx={{
              borderRight: { md: 1 },
              borderColor: { md: 'divider' },
              p: 1.5,
              position: { md: 'sticky' },
              top: { md: TOOLBAR },
              height: { md: `calc(100dvh - ${TOOLBAR}px)` },
              overflowY: { md: 'auto' },
            }}
          >
            {listPane}
          </Box>
        )}
        {(wide || showDetail) && (
          <Box component="main" sx={{ p: { xs: 2.5, md: 5 }, minWidth: 0 }}>
            {detail}
          </Box>
        )}
      </Box>

      <NewVaultDialog
        open={creatingVault}
        onClose={() => setCreatingVault(false)}
        onCreate={async (name) => {
          const id = await manager.createVault(name);
          setScope(id);
          setVaultDialog(id);
        }}
      />
      {dialogVault && <VaultDialog vault={dialogVault} manager={manager} me={session.userId} onClose={() => setVaultDialog(null)} />}
    </Box>
  );
}
