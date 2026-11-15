import type { ReactNode } from 'react';
import type { StatusTone } from '@/theme';

export type BadgeTone = StatusTone | 'primary';

export type BadgeSize = 'sm' | 'md';

export type BadgeProps = Readonly<{
  tone?: BadgeTone;
  size?: BadgeSize;
  // The leading status dot; off for plain counts such as the header cart badge.
  hasDot?: boolean;
  children: ReactNode;
}>;
