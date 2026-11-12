import { keyframes } from '@mui/material/styles';

export const rise = keyframes`
  from { opacity: 0; transform: translate3d(0, 14px, 0); filter: blur(6px); }
  to { opacity: 1; transform: none; filter: none; }
`;

export const fade = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

export const drift = keyframes`
  0% { transform: translate3d(0, 0, 0) scale(1) rotate(0deg); }
  33% { transform: translate3d(8vw, -6vh, 0) scale(1.15) rotate(20deg); }
  66% { transform: translate3d(-6vw, 5vh, 0) scale(0.92) rotate(-12deg); }
  100% { transform: translate3d(0, 0, 0) scale(1) rotate(0deg); }
`;

export const spin = keyframes`
  to { transform: rotate(360deg); }
`;

export const shimmer = keyframes`
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
`;

export const float = keyframes`
  0%, 100% { transform: translate3d(0, 0, 0); }
  50% { transform: translate3d(0, -6px, 0); }
`;

export const reducedMotion = '@media (prefers-reduced-motion: reduce)';

export const riseIn = (delayMs = 0) => ({
  animation: `${rise} 700ms cubic-bezier(0.2, 0.8, 0.2, 1) ${delayMs}ms both`,
  [reducedMotion]: { animation: `${fade} 200ms ease both` },
});
