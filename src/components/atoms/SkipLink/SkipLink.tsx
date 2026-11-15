import { focusRingClassNames } from '../focus-ring';

export const mainContentId = 'main-content';

// WCAG 2.4.1: the first focusable element of every page; hidden until focused, it jumps past the header
// and navigation to the page content.
export function SkipLink() {
  return (
    <a
      href={`#${mainContentId}`}
      className={`sr-only z-50 rounded-default bg-white px-md py-sm text-body2-medium text-primary focus:not-sr-only focus:fixed focus:top-md focus:left-md ${focusRingClassNames}`}
    >
      Skip to main content
    </a>
  );
}
