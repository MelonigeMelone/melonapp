import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined';
import type { SvgIconComponent } from '@mui/icons-material';
import type { ItemType } from '../vault/item';

export type ModuleId = 'passwords';

export interface ModuleDef {
  id: ModuleId;
  name: string;
  description: string;
  path: string;
  icon: SvgIconComponent;
  types: readonly ItemType[];
}

export const MODULES: readonly ModuleDef[] = [
  {
    id: 'passwords',
    name: 'Passwörter',
    description: 'Logins, Kreditkarten, Identitäten, WLAN und sichere Notizen',
    path: 'passwoerter',
    icon: VpnKeyOutlinedIcon,
    types: ['login', 'note', 'card', 'identity', 'wifi'],
  },
];

export function moduleByPath(path: string): ModuleDef | undefined {
  return MODULES.find((m) => m.path === path);
}
