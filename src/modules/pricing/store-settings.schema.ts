import { z } from 'zod';

const paise = (maximum: number) => z.int().min(0).max(maximum);

// D47: the settings checkout and pricing read. Store branding (D52, P1) is not edited here.
export const storeSettingsSchema = z.object({
  defaultTaxRateBasisPoints: z.int().min(0).max(2800),
  shippingFeePaise: paise(100_000),
  freeShippingThresholdPaise: paise(10_000_000),
  codFeePaise: paise(50_000),
  maxCodOrderValuePaise: z.int().min(100).max(100_000_000),
  returnWindowDays: z.int().min(0).max(90),
  // Wave 16: warehouse order for allocation; unset means the original priority order.
  allocationStrategy: z.enum(['PRIORITY', 'NEAREST_PINCODE']).default('PRIORITY'),
});

export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export const storeSettingKeys: Readonly<Record<keyof StoreSettings, string>> = {
  defaultTaxRateBasisPoints: 'default_tax_rate_basis_points',
  shippingFeePaise: 'shipping_fee_paise',
  freeShippingThresholdPaise: 'free_shipping_threshold_paise',
  codFeePaise: 'cod_fee_paise',
  maxCodOrderValuePaise: 'max_cod_order_value_paise',
  returnWindowDays: 'return_window_days',
  allocationStrategy: 'allocation_strategy',
};

// Used only for a key the database does not have yet (an empty test database); the seed writes all of them.
export const defaultStoreSettings: StoreSettings = {
  defaultTaxRateBasisPoints: 1800,
  shippingFeePaise: 4900,
  freeShippingThresholdPaise: 49900,
  codFeePaise: 2900,
  maxCodOrderValuePaise: 5_000_000,
  returnWindowDays: 7,
  allocationStrategy: 'PRIORITY',
};
