import { describe, expect, it } from 'vitest';

import { optionSignature } from './attribute-validation';
import { combinationCount, generatedSku, optionCombinations } from './variant-generation';

describe('optionCombinations', () => {
  it('builds every size × colour combination in a stable order', () => {
    expect(optionCombinations({ size: ['S', 'M'], colour: ['White', 'Indigo'] })).toEqual([
      { colour: 'White', size: 'S' },
      { colour: 'White', size: 'M' },
      { colour: 'Indigo', size: 'S' },
      { colour: 'Indigo', size: 'M' },
    ]);
  });

  it('ignores a value listed twice and gives one empty combination for no options', () => {
    expect(optionCombinations({ size: ['S', 'S', 'M'] })).toHaveLength(2);
    expect(optionCombinations({})).toEqual([{}]);
  });

  it('produces unique signatures for every combination', () => {
    const combinations = optionCombinations({ size: ['S', 'M', 'L'], colour: ['White', 'Indigo'] });
    expect(new Set(combinations.map(optionSignature)).size).toBe(6);
    expect(combinationCount({ size: ['S', 'M', 'L'], colour: ['White', 'Indigo'] })).toBe(6);
  });
});

describe('generatedSku', () => {
  it('joins the prefix and the option values in code order, upper-cased', () => {
    expect(generatedSku('KURTA-001', { size: 'M', colour: 'Indigo' })).toBe('KURTA-001-INDIGO-M');
  });

  it('turns spaces, symbols and accents into single hyphens', () => {
    expect(generatedSku('TEE', { colour: 'Off White / Crème', size: 'XL' })).toBe(
      'TEE-OFF-WHITE-CREME-XL',
    );
  });

  it('returns null when the result would not be a valid SKU', () => {
    expect(generatedSku('A'.repeat(60), { size: 'XXL' })).toHaveLength(64);
    expect(generatedSku('A'.repeat(61), { size: 'XXL' })).toBeNull();
    expect(generatedSku('TEE', { size: '***' })).toBeNull();
  });
});
