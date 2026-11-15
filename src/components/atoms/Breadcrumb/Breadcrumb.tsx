import { Icon } from '../Icon';
import { Link } from '../Link';
import { Text } from '../Text';
import type { BreadcrumbProps } from './breadcrumb.types';

// The last item is the current page: plain text with aria-current, never a link to itself.
export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-xs">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            <li key={`${item.label}-${String(index)}`} className="flex items-center gap-xs">
              {index > 0 ? <Icon name="chevron-right" size="xs" /> : null}
              {isCurrent || item.href === undefined ? (
                <span aria-current={isCurrent ? 'page' : undefined}>
                  <Text as="span" variant="body3" tone={isCurrent ? 'default' : 'subtitle'}>
                    {item.label}
                  </Text>
                </span>
              ) : (
                <Link href={item.href} appearance="subtle" variant="body3">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
