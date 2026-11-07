import type { SpacingToken } from '@/theme';

export type SpacingOption = SpacingToken | 'none';

export const gapClassNames: Readonly<Record<SpacingOption, string>> = {
  none: 'gap-0',
  xs: 'gap-xs',
  sm: 'gap-sm',
  md: 'gap-md',
  lg: 'gap-lg',
  xl: 'gap-xl',
  '2xl': 'gap-2xl',
  '3xl': 'gap-3xl',
};

export const paddingClassNames: Readonly<Record<SpacingOption, string>> = {
  none: 'p-0',
  xs: 'p-xs',
  sm: 'p-sm',
  md: 'p-md',
  lg: 'p-lg',
  xl: 'p-lg md:p-xl',
  '2xl': 'p-lg md:p-2xl',
  '3xl': 'p-xl md:p-3xl',
};
