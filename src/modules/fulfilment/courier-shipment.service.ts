import { getDatabase } from '@/lib/db';
import { getLogger } from '@/lib/logger';

import { findCourierPartnerAdapters } from './courier.repository';
import type { CreatedCourierShipment, CourierProvider } from './courier-provider';
import { courierProviderFor } from './demo-courier';

async function providerForPartner(courierPartnerId: string): Promise<CourierProvider> {
  const [partner] = await findCourierPartnerAdapters(getDatabase(), [courierPartnerId]);
  if (partner === undefined) throw new Error(`Courier partner ${courierPartnerId} not found`);
  return courierProviderFor(partner.adapterKey);
}

export async function requestCourierAwb(input: {
  courierPartnerId: string;
  shipmentId: string;
  orderNumber: string;
  pincode: string;
}): Promise<CreatedCourierShipment> {
  const provider = await providerForPartner(input.courierPartnerId);
  return provider.createShipment(input);
}

// After a cancellation has committed; a failure is logged, never undoes the cancellation.
export async function cancelCourierAwbs(
  awbNumbers: readonly { awbNumber: string; courierPartnerId: string }[],
): Promise<void> {
  for (const { awbNumber, courierPartnerId } of awbNumbers) {
    try {
      await (await providerForPartner(courierPartnerId)).cancelShipment({ awbNumber });
    } catch (error) {
      getLogger().warn({ err: error, awbNumber }, 'courier cancellation failed; retry manually');
    }
  }
}
