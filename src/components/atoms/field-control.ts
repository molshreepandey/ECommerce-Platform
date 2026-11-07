import { cva } from 'class-variance-authority';
import { focusRingClassNames } from './focus-ring';

export const fieldControlClassNames = cva(
  [
    'w-full rounded-default border bg-white font-sans text-headings transition-colors',
    'placeholder:text-text-muted disabled:cursor-not-allowed disabled:bg-strokes disabled:text-text-muted',
    focusRingClassNames,
  ],
  {
    variants: {
      size: {
        sm: 'h-8 px-sm text-body3',
        md: 'h-10 px-md text-body2',
        lg: 'h-12 px-lg text-body1',
      },
      isInvalid: {
        true: 'border-status-red',
        false: 'border-lowlight hover:border-lowlight-2',
      },
    },
  },
);

export type FieldControlSize = 'sm' | 'md' | 'lg';
