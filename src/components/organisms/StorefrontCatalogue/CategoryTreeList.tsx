import { Link } from '@/components/atoms/Link';
import type { StorefrontCategory } from '@/modules/taxonomy/storefront-category.service';

// The full L1–L4 tree as nested lists, so screen readers announce the depth.
export function CategoryTreeList({
  categories,
  label,
}: Readonly<{ categories: readonly StorefrontCategory[]; label?: string }>) {
  return (
    <ul aria-label={label} className="flex flex-col gap-sm">
      {categories.map((category) => (
        <li key={category.id} className="flex flex-col gap-sm">
          <Link
            href={`/categories/${category.slug}`}
            appearance={category.level === 1 ? 'plain' : 'subtle'}
            variant={category.level === 1 ? 'body1-medium' : 'body2'}
          >
            {category.name}
          </Link>
          {category.children.length === 0 ? null : (
            <div className="border-l border-lowlight pl-lg">
              <CategoryTreeList categories={category.children} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
