import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { MelonMark } from '@web/components/Brand';
import { neverHosts, onNeverChange, removeNever } from '../shared/never';

export function Options() {
  const [hosts, setHosts] = useState<string[] | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);

  useEffect(() => {
    void neverHosts().then(setHosts);
    return onNeverChange(setHosts);
  }, []);

  const allow = async (host: string) => {
    await removeNever(host);
    setRemoved(host);
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 640, mx: 'auto', px: 2, py: 4 }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
        <MelonMark size={36} />
        <Typography variant="h5" component="h1">
          MelonApp-Erweiterung
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" component="h2">
          Ausgeschlossene Seiten
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
          Auf diesen Seiten fragt die Erweiterung nicht, ob sie neue oder geänderte Passwörter speichern soll. Ausfüllen
          funktioniert dort weiterhin.
        </Typography>
        {hosts && hosts.length > 0 && (
          <List dense disablePadding aria-label="Ausgeschlossene Seiten">
            {[...hosts].sort().map((host) => (
              <ListItem
                key={host}
                disableGutters
                divider
                secondaryAction={
                  <Button size="small" onClick={() => void allow(host)} aria-label={`${host} wieder fragen`}>
                    Wieder fragen
                  </Button>
                }
              >
                <ListItemText primary={host} slotProps={{ primary: { sx: { fontWeight: 700, overflowWrap: 'anywhere', pr: 14 } } }} />
              </ListItem>
            ))}
          </List>
        )}
        {hosts && hosts.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Keine. Seiten landen hier, wenn du beim Speichern „Nie für diese Seite“ wählst.
          </Typography>
        )}
        {removed && (
          <Alert severity="success" onClose={() => setRemoved(null)} sx={{ mt: 2 }}>
            Für {removed} wird wieder gefragt.
          </Alert>
        )}
      </Paper>
    </Stack>
  );
}
