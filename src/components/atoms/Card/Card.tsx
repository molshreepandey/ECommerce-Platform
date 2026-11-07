import { cva } from 'class-variance-authority';
import { paddingClassNames } from '../spacing-classes';
import type { CardProps } from './card.types';

const cardClassNames = cva('min-w-0 rounded-card border border-strokes bg-white', {
  variants: {
    elevation: { flat: '', raised: 'shadow-sm' },
  },
});

export function Card({
  as: Element = 'div',
  padding = 'lg',
  elevation = 'flat',
  id,
  'aria-labelledby': ariaLabelledBy,
  children,
}: CardProps) {
  return (
    <Element
      id={id}
      aria-labelledby={ariaLabelledBy}
      className={`${cardClassNames({ elevation })} ${paddingClassNames[padding]}`}
    >
      {children}
    </Element>
  );
}
