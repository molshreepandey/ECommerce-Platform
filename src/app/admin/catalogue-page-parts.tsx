import { z } from 'zod';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Link } from '@/components/atoms/Link';

export function BackLink({ href, label }: Readonly<{ href: string; label: string }>) {
  return (
    <Link href={href} appearance="subtle" variant="body3">
      {label}
    </Link>
  );
}

export function CatalogueNotFound({
  what,
  backHref,
  backLabel,
}: Readonly<{ what: string; backHref: string; backLabel: string }>) {
  return (
    <EmptyState
      icon="circle-alert"
      headingLevel={2}
      title={`This ${what} was not found`}
      description="It may have been removed, or the link is wrong."
      action={<BackLink href={backHref} label={backLabel} />}
    />
  );
}

export function isUuid(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

export { isNotFoundError as isNotFound } from '@/lib/errors';

// Query strings may repeat a key; pages use the first value only.
export function firstSearchValues(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(searchParams).flatMap(([key, value]) => {
      const first = Array.isArray(value) ? value[0] : value;
      return first === undefined ? [] : [[key, first]];
    }),
  );
}
