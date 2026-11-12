import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Snackbar from '@mui/material/Snackbar';
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
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';
import { useEffect, useMemo, useState } from 'react';
import { ItemAvatar, TYPE_ICONS } from '../../components/TypeIcon';
import { describeError } from '../../session';
import { count, entries, TOOLBAR } from '../../layout';
import type { ShellContext } from '../../Shell';
import { emptyItem, matchesSearch, subtitle, TEMPLATES, type Item, type ItemType } from '../../vault/item';
import type { ModuleDef } from '../registry';
import { ItemDetail } from './ItemDetail';
import { ExportDialog } from './ExportDialog';
import { ImportDialog } from './ImportDialog';
import { ItemEditor } from './ItemEditor';
import { SecurityCheck } from './SecurityCheck';
import { audit } from '../../vault/audit';
import { isTrashed, TRASH_DAYS } from '../../vault/trash';

const ALL = 'all';
const TRASH = 'trash';

type Selection = { vaultId: string; id: string } | null;
type Editing = { vaultId: string; id: string | null; item: Item } | null;

export function PasswordsModule({ ctx, module }: { ctx: ShellContext; module: ModuleDef }) {
  const { session, snapshot, loaded, syncError, openSpace, createSpace } = ctx;
  const manager = session.vaults;
  const { vaults } = snapshot;
  const rolledBack = vaults.reduce((n, v) => n + v.rolledBack, 0);
  const items = useMemo(() => snapshot.items.filter((i) => module.types.includes(i.item.type)), [snapshot.items, module.types]);
  const trash = useMemo(() => snapshot.trash.filter((i) => module.types.includes(i.item.type)), [snapshot.trash, module.types]);
  const [scope, setScope] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selection>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [newMenu, setNewMenu] = useState<HTMLElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [checking, setChecking] = useState(() => window.location.hash.endsWith('/sicherheit'));
  const [undo, setUndo] = useState<{ vaultId: string; id: string; title: string } | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const wide = useMediaQuery((t) => t.breakpoints.up('md'), { noSsr: true });

  useEffect(() => {
    if (scope !== ALL && scope !== TRASH && !vaults.some((v) => v.id === scope)) setScope(ALL);
  }, [scope, vaults]);

  const scopeVault = vaults.find((v) => v.id === scope);
  const inTrash = scope === TRASH;
  const visible = useMemo(
    () =>
      inTrash
        ? trash.filter((i) => matchesSearch(i.item, query))
        : items.filter((i) => (scope === ALL || i.vaultId === scope) && matchesSearch(i.item, query)),
    [items, trash, inTrash, scope, query],
  );
  const current = selected
    ? ([...items, ...trash].find((i) => i.vaultId === selected.vaultId && i.id === selected.id) ?? null)
    : null;
  const emptiable = trash.some((i) => vaults.find((v) => v.id === i.vaultId)?.canWrite);
  const writable = vaults.filter((v) => v.canWrite);
  const defaultVault = scopeVault?.canWrite ? scopeVault.id : (writable[0]?.id ?? null);
  const showDetail = editing !== null || current !== null || checking;
  const report = useMemo(() => audit(items), [items]);
  const issues = report.weak.length + report.reused.reduce((n, g) => n + g.length, 0);
  const vaultName = (id: string) => vaults.find((v) => v.id === id)?.name ?? '';
  const inSpace = (id: string) => items.filter((i) => i.vaultId === id).length;
  const types = module.types as ItemType[];

  const startNew = (type: ItemType) => {
    setNewMenu(null);
    if (!defaultVault) return;
    setChecking(false);
    setEditing({ vaultId: defaultVault, id: null, item: emptyItem(type) });
  };

  const save = async (vaultId: string, item: Item) => {
    if (!editing) return;
    const id = await manager.saveItem(vaultId, editing.id, item, editing.vaultId);
    setEditing(null);
    setSelected({ vaultId, id });
  };

  const attempt = async (fn: () => Promise<void>) => {
    try {
      setActionError(null);
      await fn();
    } catch (e) {
      setActionError(describeError(e));
    }
  };

  const toTrash = (vaultId: string, id: string, title: string) =>
    attempt(async () => {
      await manager.trashItem(vaultId, id);
      setSelected(null);
      setUndo({ vaultId, id, title });
    });

  const restore = (vaultId: string, id: string) =>
    attempt(async () => {
      await manager.restoreItem(vaultId, id);
      setUndo(null);
      if (inTrash) setSelected(null);
    });

  const remove = (vaultId: string, id: string) =>
    attempt(async () => {
      await manager.removeItem(vaultId, id, inTrash ? isTrashed : undefined);
      setSelected(null);
    });

  const emptyTrash = () =>
    attempt(async () => {
      await manager.emptyTrash();
      setSelected(null);
      setConfirmEmpty(false);
    });

  const nav = (
    <Box component="nav" aria-label="Bereiche" sx={{ width: { xs: 280, md: 'auto' }, p: 1.5 }}>
      <List
        disablePadding
        subheader={
          <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: 2.5, px: 1 }}>
            Bereiche
          </ListSubheader>
        }
        sx={{ display: 'grid', gap: 0.25 }}
      >
        <ListItemButton
          selected={scope === ALL && !checking}
          onClick={() => {
            setChecking(false);
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
                selected={scope === v.id && !checking}
                onClick={() => {
                  setChecking(false);
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
                        ? entries(inSpace(v.id))
                        : `${entries(inSpace(v.id))}, ${count(v.members.length, 'Person', 'Personen')}`
                  }
                  slotProps={{ primary: { noWrap: true } }}
                />
              </ListItemButton>
              {!v.personal && (
                <Tooltip title="Mitglieder und Einstellungen">
                  <IconButton aria-label={`${v.name}: Mitglieder und Einstellungen`} onClick={() => openSpace(v.id)}>
                    <SettingsOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          );
        })}
      </List>
      <List disablePadding sx={{ mt: 1 }}>
        <ListItemButton
          className="security-nav"
          selected={checking}
          onClick={() => {
            setEditing(null);
            setSelected(null);
            setChecking(true);
            setDrawer(false);
          }}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>{issues > 0 ? <GppMaybeOutlinedIcon color="primary" /> : <ShieldOutlinedIcon />}</ListItemIcon>
          <ListItemText primary="Sicherheits-Check" secondary={issues > 0 ? count(issues, 'Hinweis', 'Hinweise') : 'Alles in Ordnung'} />
        </ListItemButton>
        <ListItemButton
          className="trash-nav"
          selected={inTrash && !checking}
          onClick={() => {
            setChecking(false);
            setEditing(null);
            setSelected(null);
            setScope(TRASH);
            setDrawer(false);
          }}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>
            <DeleteOutlinedIcon />
          </ListItemIcon>
          <ListItemText primary="Papierkorb" secondary={trash.length ? entries(trash.length) : 'Leer'} />
        </ListItemButton>
      </List>
      <Stack sx={{ mt: 1, alignItems: 'flex-start' }}>
        <Button startIcon={<AddIcon />} onClick={() => createSpace((id) => setScope(id))} sx={{ color: 'text.secondary' }}>
          Neuer Bereich
        </Button>
        <Button
          startIcon={<FileUploadOutlinedIcon />}
          onClick={() => {
            setDrawer(false);
            setImporting(true);
          }}
          disabled={!defaultVault}
          sx={{ color: 'text.secondary' }}
        >
          Importieren
        </Button>
        <Button
          startIcon={<FileDownloadOutlinedIcon />}
          onClick={() => {
            setDrawer(false);
            setExporting(true);
          }}
          disabled={snapshot.items.length === 0}
          sx={{ color: 'text.secondary' }}
        >
          Exportieren
        </Button>
      </Stack>
    </Box>
  );

  const listPane = (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {!wide && (
          <Tooltip title="Bereiche">
            <IconButton aria-label="Bereiche anzeigen" onClick={() => setDrawer(true)} edge="start">
              <FilterListIcon />
            </IconButton>
          </Tooltip>
        )}
        <TextField
          type="search"
          placeholder={inTrash ? 'Papierkorb durchsuchen' : scopeVault ? `In „${scopeVault.name}“ suchen` : 'Passwörter durchsuchen'}
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
        <Tooltip title="Neuer Eintrag">
          <span>
            <IconButton
              aria-label="Neuer Eintrag"
              aria-haspopup="menu"
              onClick={(e) => setNewMenu(e.currentTarget)}
              disabled={!defaultVault}
              sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } }}
            >
              <AddIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {(actionError ?? syncError) && <Alert severity="warning">{actionError ?? syncError}</Alert>}
      {vaults.some((v) => v.unreadable > 0) && (
        <Alert severity="warning">Einige Einträge ließen sich nicht entschlüsseln und werden ausgeblendet.</Alert>
      )}
      {rolledBack > 0 && (
        <Alert severity="error" className="rollback-warning">
          Der Server hat bei {rolledBack === 1 ? 'einem Eintrag' : `${rolledBack} Einträgen`} einen älteren Stand geliefert, als
          dieses Gerät schon kannte. MelonApp zeigt weiter den neueren Stand, solange er noch geladen ist. Das kann auf einen manipulierten
          Server hindeuten: Ändere vorerst nichts an diesen Einträgen und sprich mit dem Betreiber.
        </Alert>
      )}
      {inTrash && (
        <Stack spacing={1} sx={{ px: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Gelöschte Einträge bleiben {TRASH_DAYS} Tage hier und lassen sich wiederherstellen. Danach verschwinden sie endgültig.
          </Typography>
          {emptiable && (
            <Button color="error" size="small" startIcon={<DeleteOutlinedIcon />} onClick={() => setConfirmEmpty(true)} sx={{ alignSelf: 'flex-start' }}>
              Papierkorb leeren
            </Button>
          )}
        </Stack>
      )}
      {scopeVault?.waitingForKey && (
        <Alert severity="info">
          Du bist eingeladen. Ein Besitzer muss dir den Zugang noch freigeben. Das passiert automatisch, sobald er die App öffnet.
        </Alert>
      )}
      {inTrash && visible.length === 0 && !query ? (
        <Typography color="text.secondary" sx={{ p: 1 }}>
          Der Papierkorb ist leer.
        </Typography>
      ) : loaded && visible.length === 0 && !query && !scopeVault?.waitingForKey ? (
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start', p: 1 }}>
          <Typography color="text.secondary">Noch keine Einträge.</Typography>
          {defaultVault && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => startNew('login')}>
                Ersten Eintrag anlegen
              </Button>
              <Button variant="outlined" startIcon={<FileUploadOutlinedIcon />} onClick={() => setImporting(true)}>
                Aus anderem Passwortmanager importieren
              </Button>
            </Stack>
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
                setChecking(false);
                setSelected({ vaultId: v.vaultId, id: v.id });
              }}
            >
              <ListItemAvatar>
                <ItemAvatar item={v.item} />
              </ListItemAvatar>
              <ListItemText
                primary={v.item.title || 'Ohne Titel'}
                secondary={(scope === ALL || inTrash) && vaults.length > 1 ? `${subtitle(v.item)}, ${vaultName(v.vaultId)}` : subtitle(v.item)}
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
      onTrash={() => toTrash(current.vaultId, current.id, current.item.title)}
      onRestore={() => restore(current.vaultId, current.id)}
      onDelete={() => remove(current.vaultId, current.id)}
      onBack={() => setSelected(null)}
    />
  ) : checking ? (
    <SecurityCheck
      items={items}
      onSelect={(v) => {
        setChecking(false);
        setSelected({ vaultId: v.vaultId, id: v.id });
      }}
    />
  ) : (
    <Box sx={{ height: '60vh', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
      <Typography color="text.secondary">Wähle einen Eintrag aus oder lege einen neuen an.</Typography>
    </Box>
  );

  const sticky = { position: { md: 'sticky' }, top: { md: TOOLBAR }, height: { md: `calc(100dvh - ${TOOLBAR}px)` }, overflowY: { md: 'auto' } } as const;

  return (
    <>
      <Menu anchorEl={newMenu} open={newMenu !== null} onClose={() => setNewMenu(null)}>
        {types.map((t) => {
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

      {importing && defaultVault && (
        <ImportDialog
          manager={manager}
          vaults={vaults}
          existing={items}
          initialVault={defaultVault}
          onClose={() => setImporting(false)}
          onImported={(id) => setScope(id)}
        />
      )}

      <Snackbar
        open={undo !== null}
        autoHideDuration={8000}
        onClose={(_, reason) => reason !== 'clickaway' && setUndo(null)}
        message={undo ? `„${undo.title || 'Ohne Titel'}“ liegt im Papierkorb.` : ''}
        action={
          undo && (
            <Button color="inherit" size="small" onClick={() => void restore(undo.vaultId, undo.id)}>
              Rückgängig
            </Button>
          )
        }
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />

      <Dialog open={confirmEmpty} onClose={() => setConfirmEmpty(false)}>
        <DialogTitle>Papierkorb leeren?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Alle Einträge im Papierkorb verschwinden endgültig, auch für die anderen Mitglieder geteilter Bereiche. Das lässt sich
            nicht rückgängig machen.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmEmpty(false)}>Abbrechen</Button>
          <Button variant="contained" color="error" onClick={() => void emptyTrash()}>
            Endgültig löschen
          </Button>
        </DialogActions>
      </Dialog>

      {exporting && <ExportDialog session={session} items={snapshot.items} vaults={vaults} onClose={() => setExporting(false)} />}

      {!wide && (
        <Drawer open={drawer} onClose={() => setDrawer(false)}>
          {nav}
        </Drawer>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(14rem, 17rem) minmax(16rem, 22rem) minmax(0, 1fr)' } }}>
        {wide && <Box sx={{ borderRight: 1, borderColor: 'divider', ...sticky }}>{nav}</Box>}
        {(wide || !showDetail) && (
          <Box component="aside" aria-label="Einträge" sx={{ borderRight: { md: 1 }, borderColor: { md: 'divider' }, p: 1.5, ...sticky }}>
            {listPane}
          </Box>
        )}
        {(wide || showDetail) && (
          <Box component="main" sx={{ p: { xs: 2.5, md: 5 }, minWidth: 0 }}>
            {detail}
          </Box>
        )}
      </Box>
    </>
  );
}
