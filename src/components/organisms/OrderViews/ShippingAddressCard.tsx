import { z } from 'zod';
import { Card } from '@/components/atoms/Card';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';

const shippingAddressSchema = z.object({
  recipientName: z.string(),
  phone: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  landmark: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
});

// The address as it was when the order was placed (snapshot), not the current address book entry.
export function ShippingAddressCard({ address }: Readonly<{ address: unknown }>) {
  const parsed = shippingAddressSchema.safeParse(address);
  return (
    <Card>
      <div className="flex flex-col gap-xs">
        <Heading level={2} variant="heading5">
          Delivery address
        </Heading>
        {parsed.success ? (
          <address className="flex flex-col gap-xs not-italic">
            <Text variant="body2-medium">{parsed.data.recipientName}</Text>
            <Text variant="body2">{parsed.data.addressLine1}</Text>
            {parsed.data.addressLine2 === null ? null : (
              <Text variant="body2">{parsed.data.addressLine2}</Text>
            )}
            {parsed.data.landmark === null ? null : (
              <Text variant="body3" tone="subtitle">
                Near {parsed.data.landmark}
              </Text>
            )}
            <Text variant="body2">
              {parsed.data.city}, {parsed.data.state} {parsed.data.pincode}
            </Text>
            <Text variant="body3" tone="subtitle">
              Phone {parsed.data.phone}
            </Text>
          </address>
        ) : (
          <Text tone="muted">Not available</Text>
        )}
      </div>
    </Card>
  );
}
