import { cva } from 'class-variance-authority';
import { iconRegistry } from './icon-registry';
import type { IconProps } from './icon.types';

const iconClassNames = cva('shrink-0', {
  variants: {
    size: { xs: 'size-3', sm: 'size-4', md: 'size-5', lg: 'size-6' },
  },
});

export function Icon({ name, size = 'sm', label }: IconProps) {
  const IconGlyph = iconRegistry[name];
  if (label === undefined) {
    return <IconGlyph className={iconClassNames({ size })} aria-hidden="true" focusable="false" />;
  }
  return <IconGlyph className={iconClassNames({ size })} role="img" aria-label={label} />;
}
