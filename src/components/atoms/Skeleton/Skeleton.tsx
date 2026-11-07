import { cva } from 'class-variance-authority';
import type { SkeletonProps } from './skeleton.types';

const skeletonClassNames = cva('block animate-pulse bg-lowlight', {
  variants: {
    shape: { line: 'h-4 rounded-default', block: 'rounded-card', circle: 'rounded-pill' },
    width: { full: 'w-full', 'three-quarters': 'w-3/4', half: 'w-1/2', quarter: 'w-1/4' },
    height: { sm: '', md: '', lg: '' },
  },
  compoundVariants: [
    { shape: 'block', height: 'sm', className: 'h-16' },
    { shape: 'block', height: 'md', className: 'h-32' },
    { shape: 'block', height: 'lg', className: 'h-48' },
    { shape: 'circle', height: 'sm', className: 'size-8' },
    { shape: 'circle', height: 'md', className: 'size-12' },
    { shape: 'circle', height: 'lg', className: 'size-16' },
  ],
});

export function Skeleton({ shape = 'line', width = 'full', height = 'md' }: SkeletonProps) {
  const resolvedWidth = shape === 'circle' ? undefined : width;
  return (
    <span
      aria-hidden="true"
      className={skeletonClassNames({ shape, width: resolvedWidth, height })}
    />
  );
}
