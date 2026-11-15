import { cva } from 'class-variance-authority';
import type { BadgeProps } from './badge.types';

const badgeClassNames = cva('inline-flex items-center gap-xs rounded-pill whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-strokes text-subtitles',
      info: 'bg-accent-light-1 text-primary',
      success: 'bg-green-50 text-headings',
      warning: 'bg-yellow-100 text-headings',
      danger: 'bg-red-50 text-red-500',
      primary: 'bg-primary text-white',
    },
    size: { sm: 'px-sm py-xs text-body4-medium', md: 'px-sm py-xs text-body3-medium' },
  },
});

const badgeDotClassNames = cva('size-1.5 shrink-0 rounded-pill', {
  variants: {
    tone: {
      neutral: 'bg-grey',
      info: 'bg-primary',
      success: 'bg-status-green',
      warning: 'bg-status-yellow',
      danger: 'bg-status-red',
      primary: 'bg-white',
    },
  },
});

export function Badge({ tone = 'neutral', size = 'md', hasDot = true, children }: BadgeProps) {
  return (
    <span className={badgeClassNames({ tone, size })}>
      {hasDot ? <span aria-hidden="true" className={badgeDotClassNames({ tone })} /> : null}
      {children}
    </span>
  );
}
