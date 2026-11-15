import NextLink from 'next/link';
import { Icon } from '../Icon';
import { buttonClassNames, iconSizeByButtonSize } from './Button';
import type { ButtonLinkProps } from './button.types';

// A navigation link that looks like a button (for example "Start shopping"); it is still a link, so it
// works without JavaScript and opens in a new tab like any other link.
export function ButtonLink({
  appearance = 'default',
  size = 'md',
  isFullWidth = false,
  iconBefore,
  iconAfter,
  children,
  ...linkAttributes
}: ButtonLinkProps) {
  const iconSize = iconSizeByButtonSize[size];
  return (
    <NextLink {...linkAttributes} className={buttonClassNames({ appearance, size, isFullWidth })}>
      {iconBefore !== undefined ? <Icon name={iconBefore} size={iconSize} /> : null}
      {children}
      {iconAfter !== undefined ? <Icon name={iconAfter} size={iconSize} /> : null}
    </NextLink>
  );
}
