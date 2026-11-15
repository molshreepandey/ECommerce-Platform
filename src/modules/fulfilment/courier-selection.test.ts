import { describe, expect, it } from 'vitest';
import { type ServiceableCourier, selectCourier } from './courier-selection';

const courier = (overrides: Partial<ServiceableCourier>): ServiceableCourier => ({
  courierPartnerId: 'express',
  courierName: 'Demo Express',
  priority: 1,
  supportsCod: true,
  codAvailable: true,
  maxCodValuePaise: 2_000_000,
  etaDays: 3,
  ...overrides,
});

describe('selectCourier', () => {
  it('refuses an unserviceable pincode', () => {
    expect(selectCourier({ couriers: [], paymentMethod: 'ONLINE', orderTotalPaise: 100 })).toEqual({
      isServiceable: false,
      reason: 'PINCODE_NOT_SERVICEABLE',
    });
  });

  it('takes the first courier for online payment even without COD', () => {
    const selection = selectCourier({
      couriers: [courier({ codAvailable: false })],
      paymentMethod: 'ONLINE',
      orderTotalPaise: 5_000_000,
    });
    expect(selection).toMatchObject({
      isServiceable: true,
      courier: { courierPartnerId: 'express' },
    });
  });

  it('skips couriers without COD at the pincode for Cash on Delivery', () => {
    const selection = selectCourier({
      couriers: [
        courier({ codAvailable: false }),
        courier({ courierPartnerId: 'surface', priority: 2 }),
      ],
      paymentMethod: 'COD',
      orderTotalPaise: 100_000,
    });
    expect(selection).toMatchObject({ courier: { courierPartnerId: 'surface' } });
    expect(
      selectCourier({
        couriers: [courier({ supportsCod: false })],
        paymentMethod: 'COD',
        orderTotalPaise: 1,
      }),
    ).toEqual({ isServiceable: false, reason: 'COD_NOT_AVAILABLE' });
  });

  it('applies the courier COD limit at the pincode', () => {
    expect(
      selectCourier({ couriers: [courier({})], paymentMethod: 'COD', orderTotalPaise: 2_000_001 }),
    ).toEqual({ isServiceable: false, reason: 'COD_LIMIT_EXCEEDED' });
    expect(
      selectCourier({
        couriers: [courier({ maxCodValuePaise: null })],
        paymentMethod: 'COD',
        orderTotalPaise: 9_000_000,
      }),
    ).toMatchObject({ isServiceable: true });
  });
});
