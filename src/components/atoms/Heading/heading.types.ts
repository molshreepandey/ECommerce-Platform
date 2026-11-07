import type { ReactNode } from 'react';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type HeadingVariant =
  | 'heading1'
  | 'heading1-5'
  | 'heading2'
  | 'heading2-5'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6';

export type HeadingTone = 'default' | 'primary' | 'inverse';

export type HeadingProps = Readonly<{
  level: HeadingLevel;
  variant?: HeadingVariant;
  tone?: HeadingTone;
  align?: 'start' | 'center' | 'end';
  id?: string;
  children: ReactNode;
}>;
