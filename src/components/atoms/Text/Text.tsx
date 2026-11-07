import { cva } from 'class-variance-authority';
import type { TextProps } from './text.types';

export const textClassNames = cva('font-sans', {
  variants: {
    variant: {
      body1: 'text-body1',
      body2: 'text-body2',
      body3: 'text-body3',
      body4: 'text-body4',
      'body1-medium': 'text-body1-medium',
      'body2-medium': 'text-body2-medium',
      'body3-medium': 'text-body3-medium',
      'body4-medium': 'text-body4-medium',
    },
    tone: {
      default: 'text-headings',
      subtitle: 'text-subtitles',
      muted: 'text-text-muted',
      primary: 'text-primary',
      inverse: 'text-white',
      success: 'text-status-green',
      warning: 'text-status-orange',
      danger: 'text-red-500',
    },
    align: { start: 'text-start', center: 'text-center', end: 'text-end' },
    isTruncated: { true: 'truncate', false: '' },
  },
});

export function Text({
  as: Element = 'p',
  variant = 'body2',
  tone = 'default',
  align = 'start',
  isTruncated = false,
  id,
  children,
}: TextProps) {
  return (
    <Element id={id} className={textClassNames({ variant, tone, align, isTruncated })}>
      {children}
    </Element>
  );
}
