import type { SeedClient } from './seed-client';

const metroPincodes = [
  '560001',
  '560034',
  '560068',
  '600001',
  '110001',
  '110017',
  '110020',
  '400001',
  '400050',
  '421302',
  '411001',
  '500001',
  '700001',
] as const;

const courierPartnerSeeds = [
  {
    code: 'demo-express',
    name: 'Demo Express',
    priority: 1,
    serviceablePincodes: metroPincodes.map((pincode) => ({
      pincode,
      codAvailable: true,
      maxCodValuePaise: null,
      etaDays: 2,
    })),
  },
  {
    code: 'demo-surface',
    name: 'Demo Surface',
    priority: 2,
    serviceablePincodes: [
      ...metroPincodes.map((pincode) => ({
        pincode,
        codAvailable: true,
        maxCodValuePaise: 2000000,
        etaDays: 5,
      })),
      { pincode: '302001', codAvailable: true, maxCodValuePaise: 2000000, etaDays: 5 },
      { pincode: '380001', codAvailable: true, maxCodValuePaise: 2000000, etaDays: 5 },
      { pincode: '226001', codAvailable: true, maxCodValuePaise: 2000000, etaDays: 6 },
      { pincode: '682001', codAvailable: true, maxCodValuePaise: 2000000, etaDays: 6 },
      // Phagwara, Punjab.
      { pincode: '144011', codAvailable: true, maxCodValuePaise: 2000000, etaDays: 6 },
      { pincode: '799001', codAvailable: false, maxCodValuePaise: null, etaDays: 7 },
      { pincode: '744101', codAvailable: false, maxCodValuePaise: null, etaDays: 9 },
    ],
  },
] as const;

export interface SeededCourierPartner {
  id: string;
  code: string;
  priority: number;
  serviceablePincodes: ReadonlySet<string>;
}

export async function seedCourierPartners(client: SeedClient): Promise<SeededCourierPartner[]> {
  const seededCourierPartners: SeededCourierPartner[] = [];
  for (const courierSeed of courierPartnerSeeds) {
    const courierFields = {
      name: courierSeed.name,
      adapterKey: 'demo_courier',
      supportsCod: true,
      priority: courierSeed.priority,
      isActive: true,
    };
    const courierPartner = await client.courierPartner.upsert({
      where: { code: courierSeed.code },
      create: { code: courierSeed.code, ...courierFields },
      update: courierFields,
      select: { id: true },
    });
    for (const serviceablePincode of courierSeed.serviceablePincodes) {
      const pincodeFields = {
        codAvailable: serviceablePincode.codAvailable,
        maxCodValuePaise: serviceablePincode.maxCodValuePaise,
        etaDays: serviceablePincode.etaDays,
      };
      await client.courierServiceablePincode.upsert({
        where: {
          courierPartnerId_pincode: {
            courierPartnerId: courierPartner.id,
            pincode: serviceablePincode.pincode,
          },
        },
        create: {
          courierPartnerId: courierPartner.id,
          pincode: serviceablePincode.pincode,
          ...pincodeFields,
        },
        update: pincodeFields,
      });
    }
    seededCourierPartners.push({
      id: courierPartner.id,
      code: courierSeed.code,
      priority: courierSeed.priority,
      serviceablePincodes: new Set(
        courierSeed.serviceablePincodes
          .filter((pincode) => pincode.codAvailable)
          .map((pincode) => pincode.pincode),
      ),
    });
  }
  return seededCourierPartners;
}
