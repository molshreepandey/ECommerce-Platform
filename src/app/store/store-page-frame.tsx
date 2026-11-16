import { connection } from 'next/server';
import { type ReactNode, Suspense } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { Icon } from '@/components/atoms/Icon';
import { Link } from '@/components/atoms/Link';
import { Skeleton } from '@/components/atoms/Skeleton';
import { StoreLayout } from '@/components/layouts/StoreLayout';
import { StoreSearch } from '@/components/organisms/StoreSearch';
import { CategoryMenu } from '@/components/organisms/StorefrontCatalogue';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';
import { StoreBrand } from './store-brand';
import { currentVisitorCartItemCount } from './store-cart';
import { storeName, storeNavigationLinks } from './store-shell';

// Request time, not the static shell: the tree is cached in Redis and expired by category changes.
async function StoreCategoryMenu() {
  await connection();
  return <CategoryMenu categories={await getStorefrontCategoryTree()} />;
}

function CartLink({ itemCount }: Readonly<{ itemCount: number | null }>) {
  const label =
    itemCount === null || itemCount === 0
      ? 'Cart'
      : `Cart, ${String(itemCount)} ${itemCount === 1 ? 'item' : 'items'}`;
  return (
    <Link href="/cart" appearance="subtle" aria-label={label}>
      <span className="inline-flex items-center gap-xs">
        <Icon name="shopping-cart" size="sm" />
        <span className="hidden xl:inline">Cart</span>
        {itemCount === null || itemCount === 0 ? null : (
          <Badge tone="primary" size="sm" hasDot={false}>
            {itemCount}
          </Badge>
        )}
      </span>
    </Link>
  );
}

async function HeaderCartLink() {
  return <CartLink itemCount={await currentVisitorCartItemCount()} />;
}

// Every store page: header search, category menu (cached tree) and the cart link.
export function StorePageFrame({
  searchText,
  headerActions,
  children,
  fullWidth = false,
}: Readonly<{
  searchText?: string | undefined;
  headerActions?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}>) {
  return (
    <StoreLayout
      storeName={storeName}
      navigationLinks={storeNavigationLinks}
      fullWidth={fullWidth}
      brand={
        <Suspense
          fallback={
            <Link href="/" appearance="plain" variant="body1-medium">
              {storeName}
            </Link>
          }
        >
          <StoreBrand />
        </Suspense>
      }
      headerSearch={<StoreSearch key={searchText ?? ''} defaultValue={searchText ?? ''} />}
      headerActions={
        <>
          {headerActions}
          <Suspense fallback={<CartLink itemCount={null} />}>
            <HeaderCartLink />
          </Suspense>
        </>
      }
      categoryNavigation={
        <Suspense fallback={<Skeleton shape="line" width="half" />}>
          <StoreCategoryMenu />
        </Suspense>
      }
    >
      {children}
    </StoreLayout>
  );
}
