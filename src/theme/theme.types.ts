import type { ThemeTokenValues } from './theme-tokens';

export type ThemeSurface = 'store' | 'admin';

export type StoreBranding = Readonly<{
  storeName: string;
  logoUrl: string | null;
  primaryColour: string | null;
}>;

export type ThemeContextValue = Readonly<{
  surface: ThemeSurface;
  tokens: ThemeTokenValues;
  storeBranding: StoreBranding | null;
}>;

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type StatusAppearance = Readonly<{ label: string; tone: StatusTone }>;

export type SpacingToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
