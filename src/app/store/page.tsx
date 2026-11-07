import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Grid } from '@/components/atoms/Grid';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';
import { StoreLayout } from '@/components/layouts/StoreLayout';
import { storeName, storeNavigationLinks } from './store-shell';

const storePromises = [
  {
    title: 'Cash on Delivery',
    description: 'Pay when your order arrives at your door.',
    badge: 'COD',
  },
  {
    title: 'Ships from the nearest stock',
    description: 'Orders are packed at the warehouse that has your items ready.',
    badge: 'Fast',
  },
  {
    title: 'Track every shipment',
    description: 'Follow each package from pickup to delivery.',
    badge: 'Live',
  },
] as const;

export default function StoreHomePage() {
  return (
    <StoreLayout storeName={storeName} navigationLinks={storeNavigationLinks}>
      <Flexbox direction="column" gap="xl">
        <Card padding="2xl" elevation="raised">
          <Flexbox direction="column" gap="lg" align="start">
            <Badge tone="info">Now open</Badge>
            <Heading level={1} variant="heading1">
              Everyday essentials, delivered
            </Heading>
            <Text variant="body1" tone="subtitle">
              Browse apparel, footwear, electronics and beauty. Pay with Cash on Delivery.
            </Text>
            <Flexbox gap="sm" wrap="wrap">
              <Button appearance="primary" size="lg" iconBefore="shopping-cart">
                Start shopping
              </Button>
              <Button appearance="default" size="lg" iconBefore="search">
                Search products
              </Button>
            </Flexbox>
          </Flexbox>
        </Card>
        <Grid columns={3} gap="lg" as="ul">
          {storePromises.map((storePromise) => (
            <Card as="li" key={storePromise.title}>
              <Flexbox direction="column" gap="sm" align="start">
                <Badge tone="success">{storePromise.badge}</Badge>
                <Heading level={2} variant="heading4">
                  {storePromise.title}
                </Heading>
                <Text tone="subtitle">{storePromise.description}</Text>
              </Flexbox>
            </Card>
          ))}
        </Grid>
      </Flexbox>
    </StoreLayout>
  );
}
