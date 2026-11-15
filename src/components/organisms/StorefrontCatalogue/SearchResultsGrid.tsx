import { EmptyState } from '@/components/atoms/EmptyState';
import { ProductCard, type ProductCardProduct } from '@/components/molecules/ProductCard';

const gridColumnClassNames = {
  // Beside the filter sidebar.
  default: 'lg:grid-cols-3',
  // Full width (home page).
  wide: 'lg:grid-cols-4',
} as const;

export function SearchResultsGrid({
  products,
  emptyAction,
  columns = 'default',
}: Readonly<{
  products: readonly (ProductCardProduct & { productId: string })[];
  emptyAction?: React.ReactNode;
  columns?: keyof typeof gridColumnClassNames;
}>) {
  if (products.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="No products match"
        description="Try other words, or remove a filter."
        action={emptyAction}
      />
    );
  }
  return (
    <ul
      aria-label="Products"
      className={`grid grid-cols-2 gap-sm sm:gap-lg md:grid-cols-3 ${gridColumnClassNames[columns]}`}
    >
      {products.map((product) => (
        <li key={product.productId}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
