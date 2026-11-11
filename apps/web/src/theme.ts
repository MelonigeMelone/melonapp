import type { CSSProperties } from 'react';
import { createTheme } from '@mui/material/styles';

interface MelonColors {
  rind: string;
  rindLight: string;
  flesh: string;
  seed: string;
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
export const monoFont = '"Atkinson Hyperlegible Mono Variable", ui-monospace, "Cascadia Mono", monospace';

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#E2365F', dark: '#B8173F', contrastText: '#FFFFFF' },
        secondary: { main: '#2E6A43', contrastText: '#FFFFFF' },
        error: { main: '#B3261E' },
        success: { main: '#2E6A43' },
        info: { main: '#1F6B8F' },
        background: { default: '#F2F7F1', paper: '#FFFFFF' },
        text: { primary: '#17231C', secondary: '#5B6B61' },
        divider: '#D3E0D2',
        melon: {
          rind: '#2E6A43',
          rindLight: '#A7D3A0',
          flesh: '#E2365F',
          seed: '#1C241F',
          sunk: '#E6EFE5',
          digit: '#1F6B8F',
          symbol: '#B8173F',
        },
      },
    },
    dark: {
      palette: {
        primary: { main: '#FF5A85', dark: '#FF86A5', contrastText: '#1A0A10' },
        secondary: { main: '#5FAE74', contrastText: '#0E1912' },
        error: { main: '#FF8A80' },
        success: { main: '#5FAE74' },
        info: { main: '#7CC7E8' },
        background: { default: '#0E1912', paper: '#16251B' },
        text: { primary: '#E6EFE8', secondary: '#9DB1A3' },
        divider: '#26392C',
        melon: {
          rind: '#5FAE74',
          rindLight: '#2E6A43',
          flesh: '#FF5A85',
          seed: '#0E1912',
          sunk: '#0B140E',
          digit: '#7CC7E8',
          symbol: '#FF86A5',
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
      styleOverrides: { body: { WebkitFontSmoothing: 'antialiased' } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 999, minHeight: 44, paddingInline: 18, whiteSpace: 'nowrap' },
        sizeSmall: { minHeight: 34, paddingInline: 14 },
        outlined: ({ theme }) => ({
          borderColor: theme.vars?.palette.divider,
          color: theme.vars?.palette.text.primary,
          backgroundColor: theme.vars?.palette.background.paper,
          '&:hover': { borderColor: theme.vars?.palette.secondary.main },
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
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'transparent', position: 'sticky' },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.vars?.palette.background.default,
          borderBottom: `1px solid ${theme.vars?.palette.divider}`,
        }),
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.vars?.palette.background.paper,
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: theme.vars?.palette.secondary.main },
        }),
      },
    },
    MuiInputLabel: {
      styleOverrides: { root: ({ theme }) => ({ '&.Mui-focused': { color: theme.vars?.palette.secondary.main } }) },
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
          '&.Mui-selected': {
            color: theme.vars?.palette.text.primary,
            backgroundColor: theme.vars?.palette.background.paper,
            boxShadow: `0 1px 2px rgb(0 0 0 / 0.18)`,
          },
        }),
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 10,
          '&.Mui-selected, &.Mui-selected:hover': {
            backgroundColor: theme.vars?.palette.background.paper,
            boxShadow: `inset 3px 0 0 ${theme.vars?.palette.primary.main}`,
          },
        }),
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.vars?.palette.secondary.main,
          color: theme.vars?.palette.background.default,
          fontFamily: display,
          fontWeight: 700,
        }),
      },
    },
    MuiCheckbox: { defaultProps: { color: 'secondary' } },
    MuiSlider: { defaultProps: { color: 'primary' } },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0 },
      styleOverrides: { root: { backgroundColor: 'transparent', '&::before': { display: 'none' } } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 18 } },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 10 } },
    },
  },
});
