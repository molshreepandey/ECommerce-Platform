import { Heading } from '../Heading';
import { Icon } from '../Icon';
import { Text } from '../Text';
import type { EmptyStateProps } from './empty-state.types';

export function EmptyState({
  icon = 'inbox',
  title,
  headingLevel = 2,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-md px-lg py-2xl text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-pill bg-accent-light-1 text-primary">
        <Icon name={icon} size="lg" />
      </span>
      <Heading level={headingLevel} variant="heading4" align="center">
        {title}
      </Heading>
      {description === undefined ? null : (
        <Text tone="subtitle" align="center">
          {description}
        </Text>
      )}
      {action}
    </div>
  );
}
