import { describe, expect, it } from 'vitest';
import {
  findVariantForSelection,
  initialSelection,
  optionValueState,
  selectOptionValue,
} from './variant-selection';

const variants = [
  { id: 'red-s', optionValues: { colour: 'Red', size: 'S' } },
  { id: 'red-m', optionValues: { colour: 'Red', size: 'M' } },
  { id: 'blue-m', optionValues: { colour: 'Blue', size: 'M' } },
] as const;
const availability = { 'red-s': 0, 'red-m': 4, 'blue-m': 2 };

describe('variant selection', () => {
  it('opens on the first variant that has stock', () => {
    expect(initialSelection(variants, availability)).toEqual({ colour: 'Red', size: 'M' });
  });

  it('falls back to the first variant when nothing is in stock', () => {
    expect(initialSelection(variants, {})).toEqual({ colour: 'Red', size: 'S' });
  });

  it('finds the variant for a full selection', () => {
    expect(findVariantForSelection(variants, { colour: 'Blue', size: 'M' })?.id).toBe('blue-m');
    expect(findVariantForSelection(variants, { colour: 'Blue', size: 'S' })).toBeNull();
  });

  it('marks values that form no variant as unavailable and empty variants as out of stock', () => {
    const selection = { colour: 'Blue', size: 'M' };
    expect(optionValueState(variants, availability, selection, 'size', 'S')).toBe('unavailable');
    expect(optionValueState(variants, availability, selection, 'colour', 'Red')).toBe('available');
    expect(
      optionValueState(variants, availability, { colour: 'Red', size: 'M' }, 'size', 'S'),
    ).toBe('out-of-stock');
  });

  it('jumps to the closest in-stock variant when the combination does not exist', () => {
    expect(
      selectOptionValue(variants, availability, { colour: 'Red', size: 'S' }, 'colour', 'Blue'),
    ).toEqual({ colour: 'Blue', size: 'M' });
  });

  it('keeps the other choices when the combination exists', () => {
    expect(
      selectOptionValue(variants, availability, { colour: 'Blue', size: 'M' }, 'colour', 'Red'),
    ).toEqual({ colour: 'Red', size: 'M' });
  });
});
