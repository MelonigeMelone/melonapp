import Avatar from '@mui/material/Avatar';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined';
import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined';
import WifiOutlinedIcon from '@mui/icons-material/WifiOutlined';
import type { SvgIconComponent } from '@mui/icons-material';
import type { Item, ItemType } from '../vault/item';

export const TYPE_ICONS: Record<ItemType, SvgIconComponent> = {
  login: VpnKeyOutlinedIcon,
  note: StickyNote2OutlinedIcon,
  card: CreditCardOutlinedIcon,
  identity: BadgeOutlinedIcon,
  wifi: WifiOutlinedIcon,
};

export function ItemAvatar({ item }: { item: Item }) {
  if (item.type === 'login') {
    return (
      <Avatar aria-hidden="true">{(item.title.trim()[0] ?? '?').toLocaleUpperCase('de')}</Avatar>
    );
  }
  const Icon = TYPE_ICONS[item.type];
  return (
    <Avatar aria-hidden="true" sx={{ bgcolor: 'melon.sunk', color: 'secondary.main' }}>
      <Icon />
    </Avatar>
  );
}
