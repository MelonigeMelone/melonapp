import Box from '@mui/material/Box';
import { drift, reducedMotion } from '../motion';

const BLOBS = [
  { color: 'aurora1', size: '62vmax', top: '-22vmax', left: '-14vmax', duration: 38, delay: 0 },
  { color: 'aurora2', size: '52vmax', top: '-10vmax', left: '52vw', duration: 46, delay: -12 },
  { color: 'aurora3', size: '58vmax', top: '48vh', left: '18vw', duration: 54, delay: -24 },
] as const;

export function Aurora() {
  return (
    <Box
      aria-hidden="true"
      sx={{ position: 'fixed', inset: 0, zIndex: -1, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {BLOBS.map((b) => (
        <Box
          key={b.color}
          sx={(t) => ({
            position: 'absolute',
            top: b.top,
            left: b.left,
            width: b.size,
            height: b.size,
            borderRadius: '50%',
            background: `radial-gradient(circle at center, var(--mui-palette-melon-${b.color}) 0%, transparent 62%)`,
            opacity: 0.22,
            filter: 'blur(30px)',
            willChange: 'transform',
            animation: `${drift} ${b.duration}s ease-in-out ${b.delay}s infinite`,
            [reducedMotion]: { animation: 'none' },
            ...t.applyStyles('dark', { opacity: 0.38 }),
          })}
        />
      ))}
      <Box
        sx={(t) => ({
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(rgb(0 0 0 / 0.07) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, black, transparent)',
          ...t.applyStyles('dark', { backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px)' }),
        })}
      />
    </Box>
  );
}
