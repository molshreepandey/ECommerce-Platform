import { Link } from '@/components/atoms/Link';
import type { WarehouseChoice } from '@/components/organisms/InventoryAdmin';
import { DomainError } from '@/lib/errors';
import type { StaffContext } from '@/modules/identity/access-control';
import { listWarehouses } from '@/modules/inventory/warehouse.service';

export async function warehouseChoices(staff: StaffContext): Promise<WarehouseChoice[]> {
  return (await listWarehouses(staff)).map(({ id, code, name, isActive }) => ({
    id,
    code,
    name,
    isActive,
  }));
}

export function isInvalidCursor(error: unknown): boolean {
  return error instanceof DomainError && error.code === 'INVALID_CURSOR';
}

// "First page" and "Next page" links that keep the current filters.
export function PageLinks({
  basePath,
  filters,
  isFirstPage,
  nextCursor,
}: Readonly<{
  basePath: string;
  filters: Readonly<Record<string, string>>;
  isFirstPage: boolean;
  nextCursor: string | null;
}>) {
  const query = (extra: Record<string, string>) => {
    const search = new URLSearchParams({ ...filters, ...extra }).toString();
    return search === '' ? basePath : `${basePath}?${search}`;
  };
  if (isFirstPage && nextCursor === null) return null;
  return (
    <nav aria-label="Pages" className="flex gap-md">
      {isFirstPage ? null : (
        <Link href={query({})} variant="body2-medium">
          First page
        </Link>
      )}
      {nextCursor === null ? null : (
        <Link href={query({ cursor: nextCursor })} variant="body2-medium">
          Next page
        </Link>
      )}
    </nav>
  );
}
