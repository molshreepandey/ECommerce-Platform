import { cva } from 'class-variance-authority';
import { gapClassNames, paddingClassNames } from '../spacing-classes';
import type { FlexboxProps } from './flexbox.types';

const flexboxClassNames = cva('flex min-w-0', {
  variants: {
    direction: {
      row: 'flex-row',
      column: 'flex-col',
      'column-then-row': 'flex-col md:flex-row',
    },
    align: {
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      stretch: 'items-stretch',
      baseline: 'items-baseline',
    },
    justify: {
      start: 'justify-start',
      center: 'justify-center',
      end: 'justify-end',
      between: 'justify-between',
    },
    wrap: { nowrap: 'flex-nowrap', wrap: 'flex-wrap' },
    isFullWidth: { true: 'w-full', false: '' },
    shouldGrow: { true: 'flex-1', false: '' },
  },
});

export function Flexbox({
  as: Element = 'div',
  direction = 'row',
  gap = 'none',
  padding = 'none',
  align = 'stretch',
  justify = 'start',
  wrap = 'nowrap',
  isFullWidth = false,
  shouldGrow = false,
  id,
  role,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  children,
}: FlexboxProps) {
  const layoutClassNames = flexboxClassNames({
    direction,
    align,
    justify,
    wrap,
    isFullWidth,
    shouldGrow,
  });
  return (
    <Element
      id={id}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={`${layoutClassNames} ${gapClassNames[gap]} ${paddingClassNames[padding]}`}
    >
      {children}
    </Element>
  );
}
