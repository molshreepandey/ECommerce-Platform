import type { ReactNode } from 'react';
import type { SpacingOption } from '../spacing-classes';

export type CardElement = 'div' | 'section' | 'article' | 'li';

export type CardProps = Readonly<{
  as?: CardElement;
  padding?: SpacingOption;
  elevation?: 'flat' | 'raised';
  id?: string;
  'aria-labelledby'?: string;
  children: ReactNode;
}>;
