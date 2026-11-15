import { Link } from '@/components/atoms/Link';
import type { StorefrontCategory } from '@/modules/taxonomy/storefront-category.service';

// Top-level categories (C7); each page lists its own sub-categories, and /categories shows the whole tree.
export function CategoryMenu({
  categories,
}: Readonly<{ categories: readonly StorefrontCategory[] }>) {
  if (categories.length === 0) return null;
  return (
    <nav aria-label="Shop by category">
      <ul className="flex flex-wrap items-center gap-x-lg gap-y-sm">
        {categories.map((category) => (
          <li key={category.id}>
            <Link href={`/categories/${category.slug}`} appearance="subtle" variant="body2-medium">
              {category.name}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/categories" appearance="subtle" variant="body2">
            All categories
          </Link>
        </li>
      </ul>
    </nav>
  );
}
