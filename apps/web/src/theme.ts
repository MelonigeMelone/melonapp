import type { CSSProperties } from 'react';
import { createTheme } from '@mui/material/styles';

interface MelonColors {
  aurora1: string;
  aurora2: string;
  aurora3: string;
  edge: string;
  sunk: string;
  digit: string;
  symbol: string;
}

declare module '@mui/material/styles' {
  interface Palette {
    melon: MelonColors;
  }
  interface PaletteOptions {
    melon?: MelonColors;
  }
  interface TypographyVariants {
    password: CSSProperties;
  }
  interface TypographyVariantsOptions {
    password?: CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    password: true;
  }
}

const display = '"Bricolage Grotesque Variable", "Segoe UI", system-ui, sans-serif';
const body = '"Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif';
const mix = (color: string | undefined, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

export const monoFont = '"Atkinson Hyperlegible Mono Variable", ui-monospace, "Cascadia Mono", monospace';

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#5B45F0', dark: '#4330D0', contrastText: '#FFFFFF' },
        secondary: { main: '#0A7FC0', contrastText: '#FFFFFF' },
        error: { main: '#C8264A' },
        warning: { main: '#B25E00' },
        success: { main: '#0B7F72' },
        info: { main: '#0A7FC0' },
        background: { default: '#F4F5FA', paper: '#FFFFFF' },
        text: { primary: '#0D0F1A', secondary: '#565C74' },
        divider: '#DDE0EB',
        melon: {
          aurora1: '#8B7BFF',
          aurora2: '#52C1FF',
          aurora3: '#C7B8FF',
          edge: '#C9C2FF',
          sunk: '#ECEEF6',
          digit: '#0A6FB0',
          symbol: '#6A3FE0',
        },
      },
    },
    dark: {
      palette: {
        primary: { main: '#9686FF', dark: '#B3A8FF', contrastText: '#0A0818' },
        secondary: { main: '#5CC8FF', contrastText: '#03101A' },
        error: { main: '#FF7A93' },
        warning: { main: '#FFB55C' },
        success: { main: '#5EDBC8' },
        info: { main: '#5CC8FF' },
        background: { default: '#05060A', paper: '#0D0F17' },
        text: { primary: '#E9EBF4', secondary: '#8B91A8' },
        divider: '#1B1F2E',
        melon: {
          aurora1: '#6A4DFF',
          aurora2: '#1E9BFF',
          aurora3: '#3A2A9E',
          edge: '#2E2770',
          sunk: '#090B12',
          digit: '#7CC4FF',
          symbol: '#C4A8FF',
        },
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: body,
    h1: { fontFamily: display, fontWeight: 650, fontSize: '3.25rem', lineHeight: 1.05, letterSpacing: '-0.02em' },
    h2: { fontFamily: display, fontWeight: 650, fontSize: '2.25rem', lineHeight: 1.1, letterSpacing: '-0.01em' },
    h3: { fontFamily: display, fontWeight: 650, fontSize: '1.625rem', lineHeight: 1.15 },
    h6: { fontFamily: display, fontWeight: 700, fontSize: '1.25rem', letterSpacing: '-0.02em' },
    subtitle2: { fontWeight: 700, fontSize: '0.875rem' },
    button: { textTransform: 'none', fontWeight: 700, letterSpacing: 0 },
    password: {
      fontFamily: monoFont,
      fontVariantLigatures: 'none',
      wordBreak: 'break-all',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        body: { WebkitFontSmoothing: 'antialiased' },
        '::selection': { backgroundColor: mix(theme.vars?.palette.primary.main, 35) },
        '*': { scrollbarColor: `${theme.vars?.palette.divider} transparent` },
      }),
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: ({ theme, ownerState }) => ({
          borderRadius: 999,
          minHeight: 44,
          paddingInline: 18,
          whiteSpace: 'nowrap',
          transition: 'transform 160ms ease, box-shadow 220ms ease, background-color 160ms ease, filter 160ms ease',
          '&:active': { transform: 'scale(0.98)' },
          ...(ownerState.variant === 'contained' && ownerState.color === 'primary'
            ? {
                backgroundImage: `linear-gradient(135deg, ${theme.vars?.palette.primary.main}, ${theme.vars?.palette.secondary.main})`,
                boxShadow: `0 8px 24px -10px ${mix(theme.vars?.palette.primary.main, 70)}`,
                '&:hover': {
                  filter: 'brightness(1.08)',
                  boxShadow: `0 10px 32px -8px ${mix(theme.vars?.palette.primary.main, 85)}`,
                },
                '&.Mui-disabled': { backgroundImage: 'none', boxShadow: 'none' },
              }
            : {}),
        }),
        sizeSmall: { minHeight: 34, paddingInline: 14 },
        outlined: ({ theme }) => ({
          borderColor: theme.vars?.palette.divider,
          color: theme.vars?.palette.text.primary,
          backgroundColor: mix(theme.vars?.palette.background.paper, 70),
          '&:hover': { borderColor: theme.vars?.palette.primary.main, backgroundColor: mix(theme.vars?.palette.primary.main, 8) },
        }),
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: ({ theme }) => ({ '&:focus-visible': { outline: `3px solid ${theme.vars?.palette.info.main}` } }),
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: ({ theme }) => ({
          backgroundColor: mix(theme.vars?.palette.background.paper, 78),
          backdropFilter: 'blur(14px)',
          transition: 'border-color 200ms ease, box-shadow 260ms ease, transform 260ms ease',
          ...theme.applyStyles('dark', {
            backgroundImage: 'linear-gradient(180deg, rgb(255 255 255 / 0.035), rgb(255 255 255 / 0) 60%)',
          }),
        }),
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'transparent', position: 'sticky' },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: mix(theme.vars?.palette.background.default, 72),
          backdropFilter: 'blur(18px) saturate(150%)',
          borderBottom: `1px solid ${theme.vars?.palette.divider}`,
        }),
      },
    },
    MuiBottomNavigation: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: mix(theme.vars?.palette.background.default, 78),
          backdropFilter: 'blur(18px) saturate(150%)',
        }),
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: mix(theme.vars?.palette.background.paper, 85),
          transition: 'box-shadow 200ms ease',
          '&.Mui-focused': { boxShadow: `0 0 0 4px ${mix(theme.vars?.palette.primary.main, 18)}` },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: theme.vars?.palette.primary.main },
        }),
        notchedOutline: ({ theme }) => ({ borderColor: theme.vars?.palette.divider }),
      },
    },
    MuiInputLabel: {
      styleOverrides: { root: ({ theme }) => ({ '&.Mui-focused': { color: theme.vars?.palette.primary.main } }) },
    },
    MuiTabs: {
      styleOverrides: {
        root: ({ theme }) => ({
          minHeight: 44,
          padding: 4,
          borderRadius: 999,
          backgroundColor: theme.vars?.palette.melon.sunk,
        }),
        indicator: { display: 'none' },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: ({ theme }) => ({
          minHeight: 36,
          flex: 1,
          borderRadius: 999,
          textTransform: 'none',
          fontWeight: 700,
          transition: 'color 160ms ease, background-color 200ms ease, box-shadow 200ms ease',
          '&.Mui-selected': {
            color: theme.vars?.palette.text.primary,
            backgroundColor: theme.vars?.palette.background.paper,
            boxShadow: `0 1px 2px rgb(0 0 0 / 0.2), inset 0 0 0 1px ${theme.vars?.palette.divider}`,
          },
        }),
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 10,
          transition: 'background-color 160ms ease',
          '&.Mui-selected, &.Mui-selected:hover': {
            backgroundColor: mix(theme.vars?.palette.primary.main, 12),
            boxShadow: `inset 3px 0 0 ${theme.vars?.palette.primary.main}`,
          },
        }),
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundImage: `linear-gradient(135deg, ${theme.vars?.palette.primary.main}, ${theme.vars?.palette.secondary.main})`,
          color: theme.vars?.palette.primary.contrastText,
          fontFamily: display,
          fontWeight: 700,
        }),
      },
    },
    MuiCheckbox: { defaultProps: { color: 'primary' } },
    MuiSlider: { defaultProps: { color: 'primary' } },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0 },
      styleOverrides: { root: { backgroundColor: 'transparent', '&::before': { display: 'none' } } },
    },
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }) => ({
          borderRadius: 20,
          border: `1px solid ${theme.vars?.palette.divider}`,
          boxShadow: `0 40px 120px -30px ${mix(theme.vars?.palette.melon.aurora1, 45)}`,
        }),
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: { variants: [{ props: { invisible: false }, style: { backdropFilter: 'blur(6px)', backgroundColor: 'rgb(3 4 8 / 0.55)' } }] },
      },
    },
    MuiTooltip: {
      styleOverrides: { tooltip: { borderRadius: 8, fontWeight: 700, backdropFilter: 'blur(8px)' } },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 12 } },
    },
  },
});
