import { cva } from 'class-variance-authority';
import type { HeadingLevel, HeadingProps, HeadingVariant } from './heading.types';

const headingClassNames = cva('font-sans', {
  variants: {
    variant: {
      heading1: 'text-heading2 md:text-heading1-5 lg:text-heading1',
      'heading1-5': 'text-heading2 md:text-heading1-5',
      heading2: 'text-heading2-5 md:text-heading2',
      'heading2-5': 'text-heading2-5',
      heading3: 'text-heading3',
      heading4: 'text-heading4',
      heading5: 'text-heading5',
      heading6: 'text-heading6',
    },
    tone: { default: 'text-headings', primary: 'text-primary', inverse: 'text-white' },
    align: { start: 'text-start', center: 'text-center', end: 'text-end' },
  },
});

const defaultVariantByLevel: Readonly<Record<HeadingLevel, HeadingVariant>> = {
  1: 'heading2',
  2: 'heading2-5',
  3: 'heading3',
  4: 'heading4',
  5: 'heading5',
  6: 'heading6',
};

const headingElementByLevel = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
} as const satisfies Record<HeadingLevel, string>;

export function Heading({
  level,
  variant,
  tone = 'default',
  align = 'start',
  id,
  children,
}: HeadingProps) {
  const HeadingElement = headingElementByLevel[level];
  const resolvedVariant = variant ?? defaultVariantByLevel[level];
  return (
    <HeadingElement
      id={id}
      className={headingClassNames({ variant: resolvedVariant, tone, align })}
    >
      {children}
    </HeadingElement>
  );
}
