import type { ReactNode } from 'react';

export type TextVariant =
  | 'body1'
  | 'body2'
  | 'body3'
  | 'body4'
  | 'body1-medium'
  | 'body2-medium'
  | 'body3-medium'
  | 'body4-medium';

export type TextTone =
  'default' | 'subtitle' | 'muted' | 'primary' | 'inverse' | 'success' | 'warning' | 'danger';

export type TextAlign = 'start' | 'center' | 'end';

export type TextElement = 'p' | 'span' | 'div';

export type TextProps = Readonly<{
  as?: TextElement;
  variant?: TextVariant;
  tone?: TextTone;
  align?: TextAlign;
  isTruncated?: boolean;
  id?: string;
  children: ReactNode;
}>;
