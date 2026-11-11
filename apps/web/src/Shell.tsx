import AppBar from '@mui/material/AppBar';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Badge from '@mui/material/Badge';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import useMediaQuery from '@mui/material/useMediaQuery';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from './api';
import { Brand } from './components/Brand';
import { MODULES, moduleByPath, type ModuleDef } from './modules/registry';
import { PasswordsModule } from './modules/passwords/PasswordsModule';
import { AccountScreen } from './screens/AccountScreen';
import { RecoveryKitDialog } from './screens/RecoveryKit';
import { HomeScreen } from './screens/HomeScreen';
import { NewSpaceDialog, SpaceDialog } from './screens/SpaceDialog';
import { TOOLBAR } from './layout';
import { describeError, type Account, type Session } from './session';
import type { Snapshot } from './vault/manager';

const SYNC_INTERVAL_MS = 30_000;
const HOME = '';
const ACCOUNT = 'konto';

export interface ShellContext {
  session: Session;
  snapshot: Snapshot;
  loaded: boolean;
  syncError: string | null;
  navigate: (path: string) => void;
  openSpace: (id: string) => void;
  createSpace: (onCreated?: (id: string) => void) => void;
  openKit: () => void;
}

function currentPath(): string {
  return window.location.hash.replace(/^#\/?/, '').split('/')[0] ?? HOME;
}

function useHashPath(): [string, (p: string) => void] {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((p: string) => {
    window.location.hash = p ? `#/${p}` : '#/';
  }, []);
  return [path, navigate];
}

export function Shell({
  session,
  onLock,
  onUpdate,
}: {
  session: Session;
  onLock: (notice?: string) => void;
  onUpdate: (update: Partial<Account>) => void;
}) {
  const manager = session.vaults;
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const [path, navigate] = useHashPath();
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [kitOpen, setKitOpen] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [spaceDialog, setSpaceDialog] = useState<string | null>(null);
  const afterCreate = useRef<((id: string) => void) | undefined>(undefined);
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

  const module: ModuleDef | undefined = moduleByPath(path);
  const tab = module ? module.path : path === ACCOUNT ? false : HOME;
  const ctx: ShellContext = {
    session,
    snapshot,
    loaded,
    syncError,
    navigate,
    openSpace: setSpaceDialog,
    createSpace: (onCreated) => {
      afterCreate.current = onCreated;
      setCreatingSpace(true);
    },
    openKit: () => setKitOpen(true),
  };
  const dialogSpace = snapshot.vaults.find((v) => v.id === spaceDialog);

  return (
    <Box sx={{ minHeight: '100dvh', pb: { xs: 9, md: 0 } }}>
      <AppBar>
        <Toolbar sx={{ minHeight: TOOLBAR, gap: 1 }}>
          <ButtonBase onClick={() => navigate(HOME)} aria-label="Zum Start" sx={{ borderRadius: 2, px: 0.5, py: 0.5 }}>
            <Brand />
          </ButtonBase>
          {wide && (
            <Tabs value={tab} onChange={(_, v: string) => navigate(v)} aria-label="Module" sx={{ ml: 3, bgcolor: 'transparent', p: 0 }}>
              <Tab value={HOME} label="Start" sx={{ flex: 'none', px: 2.5 }} />
              {MODULES.map((m) => (
                <Tab key={m.id} value={m.path} label={m.name} sx={{ flex: 'none', px: 2.5 }} />
              ))}
            </Tabs>
          )}
          <Box sx={{ flex: 1 }} />
          <Tooltip title={session.hasRecovery ? 'Konto' : 'Konto: Notfall-Kit fehlt'}>
            <IconButton aria-label="Konto" aria-current={path === ACCOUNT ? 'page' : undefined} onClick={() => navigate(ACCOUNT)} sx={{ p: 0.75 }}>
              <Badge color="primary" variant="dot" invisible={session.hasRecovery} overlap="circular">
                <Avatar
                  sx={{
                    width: 32,
                    height: 32,
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    bgcolor: path === ACCOUNT ? 'secondary.main' : 'melon.sunk',
                    color: path === ACCOUNT ? 'secondary.contrastText' : 'text.primary',
                  }}
                >
                  {session.email.slice(0, 1).toUpperCase()}
                </Avatar>
              </Badge>
            </IconButton>
          </Tooltip>
          <Tooltip title="Sperren">
            <IconButton aria-label="Sperren" onClick={() => onLock()}>
              <LockOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      {module?.id === 'passwords' ? (
        <PasswordsModule ctx={ctx} module={module} />
      ) : path === ACCOUNT ? (
        <AccountScreen ctx={ctx} onUpdate={onUpdate} />
      ) : (
        <HomeScreen ctx={ctx} />
      )}

      {!wide && (
        <Paper square sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, borderTop: 1, borderColor: 'divider', zIndex: 3 }}>
          <BottomNavigation showLabels value={tab} onChange={(_, v: string) => navigate(v)} sx={{ bgcolor: 'background.default' }}>
            <BottomNavigationAction value={HOME} label="Start" icon={<HomeOutlinedIcon />} />
            {MODULES.map((m) => {
              const Icon = m.icon;
              return <BottomNavigationAction key={m.id} value={m.path} label={m.name} icon={<Icon />} />;
            })}
          </BottomNavigation>
        </Paper>
      )}

      {kitOpen && (
        <RecoveryKitDialog
          session={session}
          onClose={() => setKitOpen(false)}
          onDone={(update) => {
            onUpdate(update);
            setKitOpen(false);
          }}
        />
      )}
      <NewSpaceDialog
        open={creatingSpace}
        onClose={() => setCreatingSpace(false)}
        onCreate={async (name) => {
          const id = await manager.createVault(name);
          afterCreate.current?.(id);
          afterCreate.current = undefined;
          setSpaceDialog(id);
        }}
      />
      {dialogSpace && <SpaceDialog vault={dialogSpace} manager={manager} me={session.userId} onClose={() => setSpaceDialog(null)} />}
    </Box>
  );
}
