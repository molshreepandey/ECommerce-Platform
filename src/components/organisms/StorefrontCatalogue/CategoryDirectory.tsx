import Image from 'next/image';
import NextLink from 'next/link';
import { ButtonLink } from '@/components/atoms/Button';
import { focusRingClassNames } from '@/components/atoms/focus-ring';
import { Heading } from '@/components/atoms/Heading';
import { Icon } from '@/components/atoms/Icon';
import { Text, textClassNames } from '@/components/atoms/Text';
import { categoryArtUrl } from '@/modules/catalogue/catalogue-art';
import type { StorefrontCategory } from '@/modules/taxonomy/storefront-category.service';

// Background of each department; a department added later gets the neutral one.
const departmentTints: Readonly<Record<string, string>> = {
  apparel: 'bg-highlight-3',
  footwear: 'bg-yellow-100',
  electronics: 'bg-accent-light-1',
  beauty: 'bg-highlight-4',
};

const pillClassNames = `inline-flex items-center rounded-pill border border-lowlight bg-white px-md py-xs text-subtitles transition-colors hover:border-primary hover:text-primary ${focusRingClassNames} ${textClassNames({ variant: 'body3-medium' })}`;

function CategoryPicture({ slug, sizes }: Readonly<{ slug: string; sizes: string }>) {
  const url = categoryArtUrl(slug);
  if (url === null) {
    return (
      <span className="flex h-full w-full items-center justify-center text-grey">
        <Icon name="layers" size="lg" />
      </span>
    );
  }
  return <Image src={url} alt="" fill sizes={sizes} className="object-cover" unoptimized />;
}

function countDescendants(category: StorefrontCategory): number {
  return category.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

// One card per second-level category: its picture, its name, and every deeper category as a link.
function GroupCard({ group }: Readonly<{ group: StorefrontCategory }>) {
  return (
    <li className="flex gap-md rounded-card border border-lowlight bg-white p-md transition-shadow hover:shadow-lg sm:p-lg">
      <div className="relative size-20 shrink-0 overflow-hidden rounded-card bg-strokes sm:size-24">
        <CategoryPicture slug={group.slug} sizes="96px" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-sm">
        <Heading level={3} variant="heading4">
          <NextLink
            href={`/categories/${group.slug}`}
            className={`rounded-default text-headings hover:text-primary ${focusRingClassNames}`}
          >
            {group.name}
          </NextLink>
        </Heading>
        {group.children.length === 0 ? (
          <Text variant="body3" tone="subtitle">
            Browse every product in {group.name}.
          </Text>
        ) : (
          <ul className="flex flex-col gap-sm">
            {group.children.map((section) => (
              <li key={section.id} className="flex flex-col gap-xs">
                <NextLink
                  href={`/categories/${section.slug}`}
                  className={`self-start rounded-default text-headings hover:text-primary hover:underline ${focusRingClassNames} ${textClassNames({ variant: 'body2-medium' })}`}
                >
                  {section.name}
                </NextLink>
                {section.children.length === 0 ? null : (
                  <ul className="flex flex-wrap gap-xs">
                    {section.children.map((leaf) => (
                      <li key={leaf.id}>
                        <NextLink href={`/categories/${leaf.slug}`} className={pillClassNames}>
                          {leaf.name}
                        </NextLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

// /categories: a jump bar, then one section per department with its picture and its groups as cards.
// Every category in the tree keeps a link to its own page.
export function CategoryDirectory({
  categories,
}: Readonly<{ categories: readonly StorefrontCategory[] }>) {
  return (
    <div className="flex flex-col gap-3xl">
      <nav aria-label="Departments">
        <ul className="flex flex-wrap gap-sm">
          {categories.map((department) => (
            <li key={department.id}>
              <a href={`#department-${department.slug}`} className={pillClassNames}>
                {department.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {categories.map((department) => (
        <section
          key={department.id}
          id={`department-${department.slug}`}
          aria-labelledby={`department-heading-${department.slug}`}
          className="flex scroll-mt-lg flex-col gap-lg"
        >
          <div className="flex flex-wrap items-end justify-between gap-sm">
            <div className="flex flex-col gap-xs">
              <Heading level={2} variant="heading2-5" id={`department-heading-${department.slug}`}>
                {department.name}
              </Heading>
              <Text variant="body2" tone="subtitle">
                {countDescendants(department)} categories
              </Text>
            </div>
            <ButtonLink
              href={`/categories/${department.slug}`}
              appearance="subtle"
              size="sm"
              iconAfter="arrow-right"
            >
              Shop all {department.name}
            </ButtonLink>
          </div>
          <div className="grid grid-cols-1 gap-lg lg:grid-cols-[18rem_minmax(0,1fr)]">
            <NextLink
              href={`/categories/${department.slug}`}
              aria-hidden="true"
              tabIndex={-1}
              className={`group relative hidden aspect-square overflow-hidden rounded-card lg:block ${departmentTints[department.slug] ?? 'bg-strokes'}`}
            >
              <span className="absolute inset-0 transition-transform duration-300 group-hover:scale-105">
                <CategoryPicture slug={department.slug} sizes="288px" />
              </span>
            </NextLink>
            {department.children.length === 0 ? (
              <Text variant="body2" tone="subtitle">
                Browse every product in {department.name}.
              </Text>
            ) : (
              <ul className="grid grid-cols-1 gap-md sm:grid-cols-2">
                {department.children.map((group) => (
                  <GroupCard key={group.id} group={group} />
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
