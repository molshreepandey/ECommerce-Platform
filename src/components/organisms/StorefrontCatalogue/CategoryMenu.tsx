import NextLink from 'next/link';
import { focusRingClassNames } from '@/components/atoms/focus-ring';
import { textClassNames } from '@/components/atoms/Text';
import type { StorefrontCategory } from '@/modules/taxonomy/storefront-category.service';

const departmentLinkClassNames = `inline-flex items-center whitespace-nowrap rounded-default py-xs tracking-[0.14em] text-headings uppercase hover:text-primary ${focusRingClassNames} ${textClassNames({ variant: 'body3-medium' })}`;
const panelLinkClassNames = `rounded-default text-subtitles hover:text-primary hover:underline ${focusRingClassNames} ${textClassNames({ variant: 'body2' })}`;

function leavesOf(category: StorefrontCategory): StorefrontCategory[] {
  return category.children.flatMap((child) =>
    child.children.length === 0 ? [child] : [child, ...leavesOf(child)],
  );
}

// Top-level categories (C7) with a dropdown of their groups and sub-categories. Pure CSS: on wide screens
// it opens on hover and on keyboard focus (focus-within), so Tab walks into it. The panel spans the bar
// (a mega menu), so it never reaches past the page edge; a closed panel is not rendered (display: none). Below lg the bar scrolls sideways and
// each department link leads to its page, which lists its sub-categories.
export function CategoryMenu({
  categories,
}: Readonly<{ categories: readonly StorefrontCategory[] }>) {
  if (categories.length === 0) return null;
  return (
    <nav aria-label="Shop by category">
      <ul className="-mx-lg flex items-center gap-x-xl overflow-x-auto px-lg lg:relative lg:mx-0 lg:w-full lg:flex-wrap lg:justify-center lg:gap-x-2xl lg:gap-y-xs lg:overflow-visible lg:px-0">
        {categories.map((category) => (
          <li key={category.id} className="group">
            <NextLink href={`/categories/${category.slug}`} className={departmentLinkClassNames}>
              {category.name}
            </NextLink>
            {category.children.length === 0 ? null : (
              <div className="absolute inset-x-0 top-full z-40 hidden pt-sm lg:group-focus-within:block lg:group-hover:block">
                <div className="flex flex-wrap gap-x-3xl gap-y-lg border border-lowlight bg-white p-xl shadow-lg">
                  {category.children.map((group) => (
                    <div key={group.id} className="flex min-w-36 flex-col gap-sm">
                      <NextLink
                        href={`/categories/${group.slug}`}
                        className={`rounded-default tracking-wider text-headings uppercase hover:text-primary ${focusRingClassNames} ${textClassNames({ variant: 'body3-medium' })}`}
                      >
                        {group.name}
                      </NextLink>
                      <ul className="flex flex-col gap-xs">
                        {leavesOf(group).map((leaf) => (
                          <li key={leaf.id}>
                            <NextLink
                              href={`/categories/${leaf.slug}`}
                              className={panelLinkClassNames}
                            >
                              {leaf.name}
                            </NextLink>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
        <li>
          <NextLink href="/categories" className={departmentLinkClassNames}>
            All categories
          </NextLink>
        </li>
      </ul>
    </nav>
  );
}
