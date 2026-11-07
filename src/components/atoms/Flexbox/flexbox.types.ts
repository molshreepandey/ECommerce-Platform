import type { AriaRole, ReactNode } from 'react';
import type { SpacingOption } from '../spacing-classes';

export type FlexboxElement =
  'div' | 'section' | 'header' | 'footer' | 'nav' | 'main' | 'ul' | 'ol' | 'li' | 'span';

export type FlexboxDirection = 'row' | 'column' | 'column-then-row';

export type FlexboxProps = Readonly<{
  as?: FlexboxElement;
  direction?: FlexboxDirection;
  gap?: SpacingOption;
  padding?: SpacingOption;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: 'nowrap' | 'wrap';
  isFullWidth?: boolean;
  shouldGrow?: boolean;
  id?: string;
  role?: AriaRole;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  children: ReactNode;
}>;
