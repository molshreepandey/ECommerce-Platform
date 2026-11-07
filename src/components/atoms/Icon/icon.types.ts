import type { iconRegistry } from './icon-registry';

export type IconName = keyof typeof iconRegistry;

export type IconSize = 'xs' | 'sm' | 'md' | 'lg';

export type IconProps = Readonly<{
  name: IconName;
  size?: IconSize;
  label?: string;
}>;
