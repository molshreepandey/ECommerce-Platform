import type { ReactNode } from 'react';
import type { StatusTone } from '@/theme';

export type BadgeTone = StatusTone | 'primary';

export type BadgeSize = 'sm' | 'md';

export type BadgeProps = Readonly<{
  tone?: BadgeTone;
  size?: BadgeSize;
  children: ReactNode;
}>;
