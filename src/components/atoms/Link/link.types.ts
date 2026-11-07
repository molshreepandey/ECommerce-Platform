import type NextLink from 'next/link';
import type { ComponentPropsWithRef } from 'react';
import type { TextVariant } from '../Text';

export type LinkAppearance = 'default' | 'subtle' | 'inverse' | 'plain';

export type LinkProps = Omit<ComponentPropsWithRef<typeof NextLink>, 'className' | 'style'> & {
  appearance?: LinkAppearance;
  variant?: TextVariant;
};
