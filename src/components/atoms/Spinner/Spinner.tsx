import { Icon } from '../Icon';
import type { SpinnerProps } from './spinner.types';

export function Spinner({ size = 'md', label }: SpinnerProps) {
  if (label === undefined) {
    return (
      <span className="inline-flex animate-spin" aria-hidden="true">
        <Icon name="loader" size={size} />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center" role="status">
      <span className="inline-flex animate-spin">
        <Icon name="loader" size={size} />
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
