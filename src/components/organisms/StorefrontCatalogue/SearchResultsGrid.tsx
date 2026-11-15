import { EmptyState } from '@/components/atoms/EmptyState';
import { ProductCard, type ProductCardProduct } from '@/components/molecules/ProductCard';

export function SearchResultsGrid({
  products,
  emptyAction,
}: Readonly<{
  products: readonly (ProductCardProduct & { productId: string })[];
  emptyAction?: React.ReactNode;
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
    <ul aria-label="Products" className="grid grid-cols-1 gap-lg sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        <li key={product.productId}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
