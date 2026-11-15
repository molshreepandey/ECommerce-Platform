'use client';

import { useEffect, useRef } from 'react';

// Applies a filter the moment a checkbox changes. The filter form stays a plain GET form, so it also
// works without JavaScript through its Apply button (price fields are applied with that button or Enter).
export function FilterAutoSubmit() {
  const markerRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = markerRef.current?.closest('form');
    if (form === null || form === undefined) return undefined;
    // The checkboxes are Radix buttons (role="checkbox"): a click or Space toggles them and updates their
    // hidden form input, so submit once that has happened.
    const applyOnToggle = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[role="checkbox"], input[type="checkbox"]') === null) return;
      window.setTimeout(() => {
        form.requestSubmit();
      }, 0);
    };
    form.addEventListener('click', applyOnToggle);
    return () => {
      form.removeEventListener('click', applyOnToggle);
    };
  }, []);
  return <span ref={markerRef} hidden />;
}
