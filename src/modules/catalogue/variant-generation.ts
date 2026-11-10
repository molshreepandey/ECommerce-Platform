import type { OptionValues } from './attribute-validation';
import { skuPattern } from './catalogue.schema';

// size: [S, M] × colour: [White] → [{colour: White, size: S}, {colour: White, size: M}]
export function optionCombinations(
  options: Readonly<Record<string, readonly string[]>>,
): OptionValues[] {
  const codes = Object.keys(options).sort();
  return codes.reduce<OptionValues[]>(
    (combinations, code) =>
      combinations.flatMap((combination) =>
        [...new Set(options[code] ?? [])].map((value) => ({ ...combination, [code]: value })),
      ),
    [{}],
  );
}

export function combinationCount(options: Readonly<Record<string, readonly string[]>>): number {
  return Object.values(options).reduce((count, values) => count * new Set(values).size, 1);
}

function skuPart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// "KURTA-001" + {colour: Indigo, size: M} → "KURTA-001-INDIGO-M" (option codes in sorted order).
export function generatedSku(skuPrefix: string, optionValues: OptionValues): string | null {
  const parts = Object.keys(optionValues)
    .sort()
    .map((code) => skuPart(optionValues[code] ?? ''));
  const sku = [skuPrefix, ...parts].join('-');
  return sku.length <= 64 && skuPattern.test(sku) ? sku : null;
}
