'use client';

import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { Text } from '@/components/atoms/Text';
import { maximumSearchTextLength } from '@/modules/search/product-search.schema';

const suggestionsSchema = z.object({
  suggestions: z.object({
    products: z.array(z.object({ name: z.string(), slug: z.string() })),
    categories: z.array(z.object({ name: z.string(), slug: z.string() })),
  }),
});

type Option = Readonly<{ label: string; kind: 'Product' | 'Category'; href: string }>;

const minimumQueryLength = 2;
const debounceMilliseconds = 150;

// C14 (Wave 16): the header search with suggestions, following the ARIA combobox pattern (arrow keys
// move, Enter opens the highlighted suggestion or searches, Escape closes). Still a plain GET form to
// /search, so searching works without JavaScript.
export function StoreSearch({ defaultValue = '' }: Readonly<{ defaultValue?: string }>) {
  const router = useRouter();
  const listboxId = useId();
  const [text, setText] = useState(defaultValue);
  const [options, setOptions] = useState<readonly Option[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const query = text.trim();
    if (query.length < minimumQueryLength) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/store/search/suggest?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
        .then(async (response) =>
          response.ok ? suggestionsSchema.parse(await response.json()) : null,
        )
        .then((body) => {
          if (body === null) return;
          setOptions([
            ...body.suggestions.products.map((product) => ({
              label: product.name,
              kind: 'Product' as const,
              href: `/products/${product.slug}`,
            })),
            ...body.suggestions.categories.map((category) => ({
              label: category.name,
              kind: 'Category' as const,
              href: `/categories/${category.slug}`,
            })),
          ]);
          setActiveIndex(-1);
        })
        .catch(() => undefined);
    }, debounceMilliseconds);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  const isExpanded = isOpen && options.length > 0 && text.trim().length >= minimumQueryLength;
  const optionId = (index: number) => `${listboxId}-option-${String(index)}`;

  function open(option: Option) {
    setIsOpen(false);
    router.push(option.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return;
      event.preventDefault();
      setIsOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + step + options.length) % options.length);
    } else if (event.key === 'Enter' && isExpanded && activeIndex >= 0) {
      const option = options[activeIndex];
      if (option === undefined) return;
      event.preventDefault();
      open(option);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <form role="search" action="/search" method="get" className="flex w-full gap-sm md:w-96">
      <div className="relative w-full">
        <Input
          type="search"
          name="q"
          role="combobox"
          aria-label="Search products"
          aria-autocomplete="list"
          aria-expanded={isExpanded}
          aria-controls={listboxId}
          {...(isExpanded && activeIndex >= 0
            ? { 'aria-activedescendant': optionId(activeIndex) }
            : {})}
          autoComplete="off"
          placeholder="Search for products and brands"
          value={text}
          maxLength={maximumSearchTextLength}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setText(value);
            setIsOpen(true);
            if (value.trim().length < minimumQueryLength) {
              setOptions([]);
              setActiveIndex(-1);
            }
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setIsOpen(true);
          }}
          onBlur={() => {
            setIsOpen(false);
          }}
        />
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Search suggestions"
          hidden={!isExpanded}
          className="absolute top-full right-0 left-0 z-30 mt-xs flex flex-col rounded-default border border-lowlight bg-white py-xs shadow-md"
        >
          {options.map((option, index) => (
            <li
              key={option.href}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={`flex cursor-pointer items-center justify-between gap-sm px-md py-sm ${
                index === activeIndex ? 'bg-accent-light-1' : ''
              }`}
              onMouseDown={(event) => {
                // Keeps focus in the input so the click below still sees the list.
                event.preventDefault();
              }}
              onClick={() => {
                open(option);
              }}
            >
              <Text as="span" variant="body3">
                {option.label}
              </Text>
              <Text as="span" variant="body4" tone="muted">
                {option.kind}
              </Text>
            </li>
          ))}
        </ul>
      </div>
      <Button type="submit" appearance="primary" iconBefore="search">
        Search
      </Button>
    </form>
  );
}
