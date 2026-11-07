'use client';

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  readThemeTokenValues,
  unresolvedThemeTokenValues,
  type ThemeTokenValues,
} from './theme-tokens';
import type { StoreBranding, ThemeContextValue, ThemeSurface } from './theme.types';

const ThemeContext = createContext<ThemeContextValue | null>(null);

let cachedTokenSignature = '';
let cachedTokenValues: ThemeTokenValues = unresolvedThemeTokenValues;

function readDocumentTokenValues(): ThemeTokenValues {
  const documentStyles = getComputedStyle(document.documentElement);
  const tokenValues = readThemeTokenValues((variableName) =>
    documentStyles.getPropertyValue(variableName),
  );
  const tokenSignature = JSON.stringify(tokenValues);
  if (tokenSignature !== cachedTokenSignature) {
    cachedTokenSignature = tokenSignature;
    cachedTokenValues = tokenValues;
  }
  return cachedTokenValues;
}

function subscribeToTokenChanges(): () => void {
  return () => undefined;
}

function readServerTokenValues(): ThemeTokenValues {
  return unresolvedThemeTokenValues;
}

type ThemeProviderProps = Readonly<{
  surface: ThemeSurface;
  storeBranding: StoreBranding | null;
  children: ReactNode;
}>;

export function ThemeProvider({ surface, storeBranding, children }: ThemeProviderProps) {
  const tokens = useSyncExternalStore(
    subscribeToTokenChanges,
    readDocumentTokenValues,
    readServerTokenValues,
  );
  const contextValue = useMemo(
    () => ({ surface, tokens, storeBranding }),
    [surface, tokens, storeBranding],
  );
  return <ThemeContext value={contextValue}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const themeContextValue = useContext(ThemeContext);
  if (themeContextValue === null) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return themeContextValue;
}
