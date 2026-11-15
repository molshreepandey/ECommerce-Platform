import type { DatabaseClient } from '@/lib/db';

import { findServiceableCourierRows } from './courier.repository';
import type { ServiceableCourier } from './courier-selection';

export async function findServiceableCouriers(
  database: DatabaseClient,
  pincode: string,
): Promise<ServiceableCourier[]> {
  const rows = await findServiceableCourierRows(database, pincode);
  return rows.map((row) => ({
    courierPartnerId: row.courierPartner.id,
    courierName: row.courierPartner.name,
    priority: row.courierPartner.priority,
    supportsCod: row.courierPartner.supportsCod,
    codAvailable: row.codAvailable,
    maxCodValuePaise: row.maxCodValuePaise,
    etaDays: row.etaDays,
  }));
}

export interface PincodeServiceability {
  pincode: string;
  isServiceable: boolean;
  estimatedDeliveryDays: number | null;
  isCashOnDeliveryAvailable: boolean;
}

// C19: the product-page pincode check, by the same rules checkout uses (best-priority active courier; COD
// needs a courier that supports it and offers it at the pincode).
export async function checkPincodeServiceability(
  database: DatabaseClient,
  pincode: string,
): Promise<PincodeServiceability> {
  const couriers = await findServiceableCouriers(database, pincode);
  const [best] = couriers;
  return {
    pincode,
    isServiceable: best !== undefined,
    estimatedDeliveryDays: best?.etaDays ?? null,
    isCashOnDeliveryAvailable: couriers.some(
      (courier) => courier.supportsCod && courier.codAvailable,
    ),
  };
}
