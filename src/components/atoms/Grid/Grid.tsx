import { gapClassNames } from '../spacing-classes';
import type { GridColumns, GridProps } from './grid.types';

const responsiveColumnClassNames: Readonly<Record<GridColumns, string>> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
};

export function Grid({
  as: Element = 'div',
  columns,
  gap = 'lg',
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  children,
}: GridProps) {
  return (
    <Element
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={`grid min-w-0 ${responsiveColumnClassNames[columns]} ${gapClassNames[gap]}`}
    >
      {children}
    </Element>
  );
}
