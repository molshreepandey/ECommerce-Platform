export const themeTokenVariables = {
  primary: '--color-primary',
  primaryGradient1: '--color-primary-gradient-1',
  primaryGradient2: '--color-primary-gradient-2',
  accentBlue: '--color-accent-blue',
  accentLight1: '--color-accent-light-1',
  accentLight2: '--color-accent-light-2',
  headings: '--color-headings',
  subtitles: '--color-subtitles',
  textMuted: '--color-text-muted',
  grey: '--color-grey',
  white: '--color-white',
  background: '--color-background',
  strokes: '--color-strokes',
  lowlight: '--color-lowlight',
  navBackground: '--color-nav-background',
  statusGreen: '--color-status-green',
  statusYellow: '--color-status-yellow',
  statusRed: '--color-status-red',
  statusOrange: '--color-status-orange',
  highlight1: '--color-highlight-1',
  highlight2: '--color-highlight-2',
} as const;

export type ThemeTokenName = keyof typeof themeTokenVariables;

export type ThemeTokenValues = Readonly<Record<ThemeTokenName, string>>;

export function readThemeTokenValues(
  readVariable: (variableName: string) => string,
): ThemeTokenValues {
  const read = (tokenName: ThemeTokenName) => readVariable(themeTokenVariables[tokenName]).trim();
  return {
    primary: read('primary'),
    primaryGradient1: read('primaryGradient1'),
    primaryGradient2: read('primaryGradient2'),
    accentBlue: read('accentBlue'),
    accentLight1: read('accentLight1'),
    accentLight2: read('accentLight2'),
    headings: read('headings'),
    subtitles: read('subtitles'),
    textMuted: read('textMuted'),
    grey: read('grey'),
    white: read('white'),
    background: read('background'),
    strokes: read('strokes'),
    lowlight: read('lowlight'),
    navBackground: read('navBackground'),
    statusGreen: read('statusGreen'),
    statusYellow: read('statusYellow'),
    statusRed: read('statusRed'),
    statusOrange: read('statusOrange'),
    highlight1: read('highlight1'),
    highlight2: read('highlight2'),
  };
}

export const unresolvedThemeTokenValues: ThemeTokenValues = readThemeTokenValues(() => '');
