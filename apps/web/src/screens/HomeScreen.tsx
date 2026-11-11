import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { count, entries } from '../layout';
import { MODULES } from '../modules/registry';
import type { ShellContext } from '../Shell';
import { ROLE_LABELS } from './SpaceDialog';


export function HomeScreen({ ctx }: { ctx: ShellContext }) {
  const { session, snapshot, syncError, navigate, openSpace, createSpace, openKit } = ctx;
  const { vaults, items } = snapshot;

  return (
    <Box component="main" sx={{ maxWidth: '64rem', mx: 'auto', px: { xs: 2, md: 4 }, py: { xs: 3, md: 6 } }}>
      <Stack spacing={5}>
        <Stack spacing={1.5}>
          <Typography variant="h1" sx={{ fontSize: { xs: '2.25rem', md: '3rem' } }}>
            Start
          </Typography>
          {!session.hasRecovery && (
            <Alert
              severity="warning"
              action={
                <Button color="inherit" size="small" onClick={openKit}>
                  Erstellen
                </Button>
              }
            >
              Noch kein Notfall-Kit. Ohne es sind deine Daten verloren, wenn du dein Master-Passwort vergisst.
            </Alert>
          )}
          {syncError && <Alert severity="warning">{syncError}</Alert>}
        </Stack>

        <Box component="section" aria-labelledby="modules-heading">
          <Typography id="modules-heading" variant="h3" component="h2" sx={{ mb: 2 }}>
            Module
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
            {MODULES.map((m) => {
              const Icon = m.icon;
              const own = items.filter((i) => m.types.includes(i.item.type));
              const spaces = new Set(own.map((i) => i.vaultId)).size;
              return (
                <Paper key={m.id} variant="outlined" sx={{ borderRadius: '18px', overflow: 'hidden' }}>
                  <ButtonBase
                    onClick={() => navigate(m.path)}
                    aria-label={`${m.name} öffnen`}
                    sx={{ width: '100%', p: 2.5, display: 'flex', gap: 2, alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left' }}
                  >
                    <Box
                      sx={{
                        flex: 'none',
                        width: 56,
                        height: 56,
                        borderRadius: '16px',
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                      }}
                    >
                      <Icon />
                    </Box>
                    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                      <Typography variant="h3" component="span" sx={{ fontSize: '1.375rem' }}>
                        {m.name}
                      </Typography>
                      <Typography color="text.secondary" variant="body2">
                        {m.description}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, pt: 0.5 }}>
                        {own.length ? `${entries(own.length)} in ${count(spaces, 'Bereich', 'Bereichen')}` : 'Noch leer'}
                      </Typography>
                    </Stack>
                  </ButtonBase>
                </Paper>
              );
            })}
            <Paper
              variant="outlined"
              sx={{ borderRadius: '18px', borderStyle: 'dashed', p: 2.5, display: 'flex', alignItems: 'center', bgcolor: 'transparent' }}
            >
              <Typography color="text.secondary" variant="body2">
                Weitere Module wie Kalender oder Notizen kommen hier dazu. Sie nutzen dieselben Bereiche.
              </Typography>
            </Paper>
          </Box>
        </Box>

        <Box component="section" aria-labelledby="spaces-heading">
          <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 1, gap: 2 }}>
            <Typography id="spaces-heading" variant="h3" component="h2">
              Bereiche
            </Typography>
            <Button startIcon={<AddIcon />} onClick={() => createSpace()} sx={{ color: 'text.secondary' }}>
              Neuer Bereich
            </Button>
          </Stack>
          <Typography color="text.secondary" sx={{ mb: 2, maxWidth: '60ch' }}>
            Ein Bereich gilt für alle Module. Wer Mitglied ist, sieht darin alles, was du dort ablegst.
          </Typography>
          <Stack spacing={1}>
            {vaults.map((v) => {
              const Icon = v.waitingForKey ? HourglassEmptyOutlinedIcon : v.personal ? PersonOutlinedIcon : GroupsOutlinedIcon;
              const detail = v.waitingForKey
                ? 'Wartet auf Freigabe durch einen Besitzer'
                : v.personal
                  ? `${entries(v.itemCount)}, nur für dich`
                  : `${entries(v.itemCount)}, ${count(v.members.length, 'Person', 'Personen')}`;
              return (
                <Paper key={v.id} variant="outlined" className="space-row" sx={{ borderRadius: '14px', px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Icon sx={{ color: 'secondary.main' }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700 }} noWrap>
                      {v.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {detail}
                    </Typography>
                  </Box>
                  {!v.personal && (
                    <Chip size="small" label={ROLE_LABELS[v.role]} variant="outlined" sx={{ display: { xs: 'none', sm: 'inline-flex' } }} />
                  )}
                  {!v.personal && (
                    <Button
                      size="small"
                      onClick={() => openSpace(v.id)}
                      aria-label={`${v.name}: Mitglieder und Einstellungen`}
                      sx={{ minWidth: 0, gap: 0.75 }}
                    >
                      <SettingsOutlinedIcon fontSize="small" />
                      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                        Verwalten
                      </Box>
                    </Button>
                  )}
                </Paper>
              );
            })}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}
