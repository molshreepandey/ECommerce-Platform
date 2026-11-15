import type { Page } from '@playwright/test';

// Wave 14 accessibility audit, run inside the page (no extra dependency): document language, one main
// landmark, one visible h1, an accessible name for every visible control and link, alt text on images,
// unique ids among visible elements, no positive tabindex, aria references that resolve, named dialogs.
// Returns one line per problem; an empty list means the page passed.
export async function accessibilityProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const isVisible = (element: Element): boolean => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
      if (element.closest('[hidden], [aria-hidden="true"]') !== null) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const textOf = (ids: string): string =>
      ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
    const accessibleName = (element: Element): string => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy !== null && textOf(labelledBy) !== '') return textOf(labelledBy);
      const label = element.getAttribute('aria-label')?.trim() ?? '';
      if (label !== '') return label;
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLButtonElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) {
        const fromLabels = Array.from(element.labels ?? [])
          .map((item) => item.textContent)
          .join(' ')
          .trim();
        if (fromLabels !== '') return fromLabels;
      }
      if (element instanceof HTMLInputElement && ['submit', 'button'].includes(element.type)) {
        return element.value.trim();
      }
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) {
        const text = element.textContent.trim();
        if (text !== '') return text;
        const image = element.querySelector('img[alt]');
        if (image !== null) return image.getAttribute('alt') ?? '';
      }
      return element.getAttribute('title')?.trim() ?? '';
    };

    if (document.documentElement.lang === '') problems.push('the html element has no lang');
    const mains = [...document.querySelectorAll('main')].filter(isVisible);
    if (mains.length !== 1) problems.push(`visible main landmarks: ${String(mains.length)}`);
    const headings = [...document.querySelectorAll('h1')].filter(isVisible);
    if (headings.length !== 1) problems.push(`visible h1 headings: ${String(headings.length)}`);
    for (const image of document.querySelectorAll('img')) {
      if (!image.hasAttribute('alt')) problems.push(`image without alt: ${image.src.slice(0, 80)}`);
    }
    const interactive = document.querySelectorAll(
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="option"], [role="link"]',
    );
    for (const element of interactive) {
      if (!isVisible(element)) continue;
      if (accessibleName(element) === '') {
        problems.push(`no accessible name: ${element.outerHTML.slice(0, 140)}`);
      }
    }
    const idCounts = new Map<string, number>();
    for (const element of document.querySelectorAll('[id]')) {
      if (!isVisible(element)) continue;
      idCounts.set(element.id, (idCounts.get(element.id) ?? 0) + 1);
    }
    for (const [id, count] of idCounts) {
      if (count > 1) problems.push(`duplicate visible id "${id}" (${String(count)})`);
    }
    for (const element of document.querySelectorAll('[tabindex]')) {
      if (Number(element.getAttribute('tabindex')) > 0) {
        problems.push(`positive tabindex: ${element.outerHTML.slice(0, 100)}`);
      }
    }
    for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        if (!isVisible(element)) continue;
        for (const id of (element.getAttribute(attribute) ?? '').split(/\s+/)) {
          if (id !== '' && document.getElementById(id) === null) {
            problems.push(`${attribute} points to a missing id "${id}"`);
          }
        }
      }
    }
    for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      const named =
        (dialog.getAttribute('aria-label') ?? '').trim() !== '' ||
        textOf(dialog.getAttribute('aria-labelledby') ?? '') !== '';
      if (isVisible(dialog) && !named) problems.push('a dialog has no name');
    }
    return problems;
  });
}
