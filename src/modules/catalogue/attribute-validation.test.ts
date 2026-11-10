import { describe, expect, it } from 'vitest';

import {
  type AttributeRule,
  attributeProblemsForActivation,
  optionSignature,
  validateProductAttributes,
  validateVariantOptions,
} from './attribute-validation';

const apparelRules: AttributeRule[] = [
  {
    code: 'fabric',
    label: 'Fabric',
    dataType: 'ENUM',
    scope: 'PRODUCT',
    isRequired: true,
    allowedValues: ['Cotton', 'Silk'],
  },
  {
    code: 'occasion',
    label: 'Occasion',
    dataType: 'MULTI_ENUM',
    scope: 'PRODUCT',
    isRequired: false,
    allowedValues: ['Casual', 'Festive', 'Office'],
  },
  {
    code: 'care_instructions',
    label: 'Care',
    dataType: 'TEXT',
    scope: 'PRODUCT',
    isRequired: false,
    allowedValues: null,
  },
  {
    code: 'warranty_months',
    label: 'Warranty',
    dataType: 'NUMBER',
    scope: 'PRODUCT',
    isRequired: false,
    allowedValues: null,
  },
  {
    code: 'is_vegan',
    label: 'Vegan',
    dataType: 'BOOLEAN',
    scope: 'PRODUCT',
    isRequired: false,
    allowedValues: null,
  },
  {
    code: 'size',
    label: 'Size',
    dataType: 'ENUM',
    scope: 'VARIANT_OPTION',
    isRequired: true,
    allowedValues: ['S', 'M', 'L'],
  },
  {
    code: 'colour',
    label: 'Colour',
    dataType: 'ENUM',
    scope: 'VARIANT_OPTION',
    isRequired: false,
    allowedValues: ['White', 'Indigo'],
  },
];

describe('validateProductAttributes', () => {
  it('accepts valid values of every data type and drops nothing', () => {
    const result = validateProductAttributes(apparelRules, {
      fabric: 'Cotton',
      occasion: ['Casual', 'Office'],
      care_instructions: '  Hand wash  ',
      warranty_months: 12,
      is_vegan: false,
    });
    expect(result).toEqual({
      success: true,
      values: {
        fabric: 'Cotton',
        occasion: ['Casual', 'Office'],
        care_instructions: 'Hand wash',
        warranty_months: 12,
        is_vegan: false,
      },
    });
  });

  it('reports a missing required attribute under attributes.<code>', () => {
    const result = validateProductAttributes(apparelRules, {});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(Object.keys(result.fieldErrors)).toEqual(['attributes.fabric']);
  });

  it('rejects an enum value that is not allowed', () => {
    const result = validateProductAttributes(apparelRules, { fabric: 'Wool' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.fieldErrors['attributes.fabric']?.[0]).toMatch(/Cotton, Silk/);
  });

  it('rejects an empty, duplicated or disallowed multi-enum value', () => {
    for (const occasion of [[], ['Casual', 'Casual'], ['Casual', 'Party'], 'Casual']) {
      const result = validateProductAttributes(apparelRules, { fabric: 'Silk', occasion });
      expect(result.success, JSON.stringify(occasion)).toBe(false);
    }
  });

  it('rejects wrong types: text must be non-blank, numbers finite, booleans real booleans', () => {
    for (const attributes of [
      { fabric: 'Silk', care_instructions: '   ' },
      { fabric: 'Silk', care_instructions: 'x'.repeat(501) },
      { fabric: 'Silk', warranty_months: '12' },
      { fabric: 'Silk', warranty_months: Number.POSITIVE_INFINITY },
      { fabric: 'Silk', is_vegan: 'yes' },
    ]) {
      expect(validateProductAttributes(apparelRules, attributes).success).toBe(false);
    }
  });

  it('rejects keys that are not product attributes of this type, including variant options', () => {
    const result = validateProductAttributes(apparelRules, {
      fabric: 'Silk',
      size: 'M',
      gsm: 180,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual(['attributes.gsm', 'attributes.size']);
  });

  it('rejects input that is not an object', () => {
    expect(validateProductAttributes(apparelRules, ['Silk']).success).toBe(false);
    expect(validateProductAttributes(apparelRules, null).success).toBe(false);
  });
});

describe('validateVariantOptions', () => {
  it('accepts allowed values and allows an optional option to be left out', () => {
    expect(validateVariantOptions(apparelRules, { size: 'M', colour: 'White' })).toEqual({
      success: true,
      values: { size: 'M', colour: 'White' },
    });
    expect(validateVariantOptions(apparelRules, { size: 'L' })).toEqual({
      success: true,
      values: { size: 'L' },
    });
  });

  it('reports a missing required option and disallowed or unknown options under optionValues.<code>', () => {
    const result = validateVariantOptions(apparelRules, { colour: 'Red', fabric: 'Silk' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual([
      'optionValues.colour',
      'optionValues.fabric',
      'optionValues.size',
    ]);
  });
});

describe('attributeProblemsForActivation', () => {
  it('lists problems with stored values and ignores keys of archived definitions', () => {
    expect(
      attributeProblemsForActivation(apparelRules, { fabric: 'Silk', retired_code: 'x' }),
    ).toEqual([]);
    expect(attributeProblemsForActivation(apparelRules, { fabric: 'Wool' })).toHaveLength(1);
    expect(attributeProblemsForActivation(apparelRules, {})[0]).toMatch(/^attributes\.fabric: /);
  });
});

describe('optionSignature', () => {
  it('sorts codes so the same combination always has the same signature (seed format)', () => {
    expect(optionSignature({ size: 'S', colour: 'White' })).toBe('colour=White|size=S');
    expect(optionSignature({ colour: 'White', size: 'S' })).toBe('colour=White|size=S');
    expect(optionSignature({})).toBe('');
  });
});
