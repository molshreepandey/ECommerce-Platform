import type { SeedClient } from './seed-client';

export const seededStoreSettings = {
  default_tax_rate_basis_points: 1800,
  shipping_fee_paise: 4900,
  free_shipping_threshold_paise: 49900,
  cod_fee_paise: 2900,
  max_cod_order_value_paise: 5000000,
  return_window_days: 7,
  store_branding: { storeName: 'ShopSphere', logoUrl: null, primaryColour: null },
} as const;

export async function seedStoreSettings(client: SeedClient): Promise<void> {
  for (const [key, value] of Object.entries(seededStoreSettings)) {
    await client.storeSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}
