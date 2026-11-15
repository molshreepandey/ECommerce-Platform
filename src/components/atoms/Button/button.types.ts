import type NextLink from 'next/link';
import type { ComponentPropsWithRef } from 'react';
import type { IconName } from '../Icon';

export type ButtonAppearance = 'primary' | 'default' | 'ghost' | 'link' | 'subtle';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<ComponentPropsWithRef<'button'>, 'className' | 'style'> & {
  appearance?: ButtonAppearance;
  size?: ButtonSize;
  isFullWidth?: boolean;
  isLoading?: boolean;
  iconBefore?: IconName;
  iconAfter?: IconName;
};

export type ButtonLinkProps = Omit<
  ComponentPropsWithRef<typeof NextLink>,
  'className' | 'style'
> & {
  appearance?: ButtonAppearance;
  size?: ButtonSize;
  isFullWidth?: boolean;
  iconBefore?: IconName;
  iconAfter?: IconName;
};
