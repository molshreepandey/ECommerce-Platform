import { Icon } from '../Icon';
import { Link } from '../Link';
import { Text } from '../Text';
import type { PaginationProps } from './pagination.types';

// Link-based paging: every page is a URL (plan C12), so it works without JavaScript and can be shared.
export function Pagination({
  page,
  pageCount,
  hrefForPage,
  label = 'Pagination',
}: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-lg">
      {page > 1 ? (
        <Link href={hrefForPage(page - 1)} rel="prev">
          <span className="inline-flex items-center gap-xs">
            <Icon name="chevron-left" size="sm" />
            Previous
          </span>
        </Link>
      ) : null}
      <Text as="span" variant="body2" tone="subtitle">
        Page {page} of {pageCount}
      </Text>
      {page < pageCount ? (
        <Link href={hrefForPage(page + 1)} rel="next">
          <span className="inline-flex items-center gap-xs">
            Next
            <Icon name="chevron-right" size="sm" />
          </span>
        </Link>
      ) : null}
    </nav>
  );
}
