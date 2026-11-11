// The one navigation entry for the current page: the most specific href that matches, so /inventory is not
// also highlighted on /inventory/movements when both are in the menu. "/" matches only itself.
export function activeNavigationHref(currentPath: string, hrefs: readonly string[]): string | null {
  const matches = hrefs.filter((href) =>
    href === '/' ? currentPath === '/' : currentPath === href || currentPath.startsWith(`${href}/`),
  );
  return matches.reduce<string | null>(
    (best, href) => (best === null || href.length > best.length ? href : best),
    null,
  );
}
