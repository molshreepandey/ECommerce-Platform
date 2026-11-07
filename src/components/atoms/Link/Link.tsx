import { cva } from 'class-variance-authority';
import NextLink from 'next/link';
import { focusRingClassNames } from '../focus-ring';
import { textClassNames } from '../Text';
import type { LinkProps } from './link.types';

const linkClassNames = cva(['rounded-default underline-offset-4', focusRingClassNames], {
  variants: {
    appearance: {
      default: 'text-primary hover:underline',
      subtle: 'text-subtitles hover:text-headings hover:underline',
      inverse: 'text-white hover:underline',
      plain: 'text-headings hover:text-primary',
    },
  },
});

export function Link({ appearance = 'default', variant = 'body2', ...linkAttributes }: LinkProps) {
  return (
    <NextLink
      {...linkAttributes}
      className={`${linkClassNames({ appearance })} ${textClassNames({ variant })}`}
    />
  );
}
