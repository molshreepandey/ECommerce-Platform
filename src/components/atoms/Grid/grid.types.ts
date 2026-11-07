import type { ReactNode } from 'react';
import type { SpacingOption } from '../spacing-classes';

export type GridColumns = 1 | 2 | 3 | 4 | 6;

export type GridProps = Readonly<{
  as?: 'div' | 'section' | 'ul';
  columns: GridColumns;
  gap?: SpacingOption;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  children: ReactNode;
}>;
