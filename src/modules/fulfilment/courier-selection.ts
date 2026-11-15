export interface ServiceableCourier {
  courierPartnerId: string;
  courierName: string;
  priority: number;
  supportsCod: boolean;
  codAvailable: boolean;
  maxCodValuePaise: number | null;
  etaDays: number;
}

export type CourierSelection =
  | { isServiceable: true; courier: ServiceableCourier }
  | {
      isServiceable: false;
      reason: 'PINCODE_NOT_SERVICEABLE' | 'COD_NOT_AVAILABLE' | 'COD_LIMIT_EXCEEDED';
    };

// The best-priority active courier for the pincode; for Cash on Delivery it must also offer COD there
// and accept the order value (plan §7). Online payment needs only serviceability.
export function selectCourier(input: {
  couriers: readonly ServiceableCourier[];
  paymentMethod: 'COD' | 'ONLINE';
  orderTotalPaise: number;
}): CourierSelection {
  const [best] = input.couriers;
  if (best === undefined) return { isServiceable: false, reason: 'PINCODE_NOT_SERVICEABLE' };
  if (input.paymentMethod === 'ONLINE') return { isServiceable: true, courier: best };
  const codCouriers = input.couriers.filter(
    (courier) => courier.supportsCod && courier.codAvailable,
  );
  if (codCouriers.length === 0) return { isServiceable: false, reason: 'COD_NOT_AVAILABLE' };
  const withinLimit = codCouriers.find(
    (courier) =>
      courier.maxCodValuePaise === null || input.orderTotalPaise <= courier.maxCodValuePaise,
  );
  return withinLimit === undefined
    ? { isServiceable: false, reason: 'COD_LIMIT_EXCEEDED' }
    : { isServiceable: true, courier: withinLimit };
}
