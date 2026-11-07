import { cva } from 'class-variance-authority';
import { focusRingClassNames } from '../focus-ring';
import { Icon, type IconSize } from '../Icon';
import { Spinner } from '../Spinner';
import type { ButtonProps, ButtonSize } from './button.types';

const buttonClassNames = cva(
  [
    'inline-flex items-center justify-center gap-sm rounded-default font-sans whitespace-nowrap transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-60',
    focusRingClassNames,
  ],
  {
    variants: {
      appearance: {
        primary: 'bg-primary text-white hover:bg-primary-gradient-2',
        default: 'border border-lowlight bg-white text-headings hover:bg-strokes',
        ghost: 'bg-transparent text-headings hover:bg-strokes',
        link: 'bg-transparent text-primary underline-offset-4 hover:underline',
        subtle: 'bg-accent-light-1 text-primary hover:bg-accent-light-2',
      },
      size: {
        xs: 'h-6 px-sm text-body3-medium',
        sm: 'h-8 px-md text-body2-medium',
        md: 'h-10 px-lg text-body2-medium',
        lg: 'h-12 px-xl text-body1-medium',
      },
      isFullWidth: { true: 'w-full', false: '' },
    },
    compoundVariants: [{ appearance: 'link', className: 'h-auto px-0' }],
  },
);

const iconSizeByButtonSize: Readonly<Record<ButtonSize, IconSize>> = {
  xs: 'xs',
  sm: 'sm',
  md: 'sm',
  lg: 'md',
};

export function Button({
  appearance = 'default',
  size = 'md',
  isFullWidth = false,
  isLoading = false,
  iconBefore,
  iconAfter,
  type = 'button',
  disabled,
  children,
  ...buttonAttributes
}: ButtonProps) {
  const iconSize = iconSizeByButtonSize[size];
  return (
    <button
      {...buttonAttributes}
      type={type}
      disabled={disabled === true || isLoading}
      aria-busy={isLoading}
      className={buttonClassNames({ appearance, size, isFullWidth })}
    >
      {isLoading ? <Spinner size={iconSize} /> : null}
      {!isLoading && iconBefore !== undefined ? <Icon name={iconBefore} size={iconSize} /> : null}
      {children}
      {iconAfter !== undefined ? <Icon name={iconAfter} size={iconSize} /> : null}
    </button>
  );
}
