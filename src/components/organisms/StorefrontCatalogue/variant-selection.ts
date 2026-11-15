export type SelectableVariant = Readonly<{
  id: string;
  optionValues: Readonly<Record<string, string>>;
}>;

export type OptionSelection = Readonly<Record<string, string>>;

export type OptionValueState = 'available' | 'out-of-stock' | 'unavailable';

function matches(variant: SelectableVariant, selection: OptionSelection): boolean {
  return Object.entries(selection).every(([code, value]) => variant.optionValues[code] === value);
}

export function findVariantForSelection<Variant extends SelectableVariant>(
  variants: readonly Variant[],
  selection: OptionSelection,
): Variant | null {
  return variants.find((variant) => matches(variant, selection)) ?? null;
}

// First variant with stock, else the first variant: the page opens on something the customer can buy.
export function initialSelection(
  variants: readonly SelectableVariant[],
  availabilityByVariant: Readonly<Record<string, number>>,
): OptionSelection {
  const preferred =
    variants.find((variant) => (availabilityByVariant[variant.id] ?? 0) > 0) ?? variants[0];
  return preferred === undefined ? {} : { ...preferred.optionValues };
}

// C16: a value that forms no active variant with the other choices is unavailable; one whose variant has
// no stock is out of stock. Both are disabled in the picker.
export function optionValueState(
  variants: readonly SelectableVariant[],
  availabilityByVariant: Readonly<Record<string, number>>,
  selection: OptionSelection,
  code: string,
  value: string,
): OptionValueState {
  const variant = findVariantForSelection(variants, { ...selection, [code]: value });
  if (variant === null) return 'unavailable';
  return (availabilityByVariant[variant.id] ?? 0) > 0 ? 'available' : 'out-of-stock';
}

// Choosing a value that does not combine with the other choices jumps to the closest variant that has it,
// preferring one in stock.
export function selectOptionValue(
  variants: readonly SelectableVariant[],
  availabilityByVariant: Readonly<Record<string, number>>,
  selection: OptionSelection,
  code: string,
  value: string,
): OptionSelection {
  const next = { ...selection, [code]: value };
  if (findVariantForSelection(variants, next) !== null) return next;
  const withValue = variants.filter((variant) => variant.optionValues[code] === value);
  const fallback =
    withValue.find((variant) => (availabilityByVariant[variant.id] ?? 0) > 0) ?? withValue[0];
  return fallback === undefined ? selection : { ...fallback.optionValues };
}
