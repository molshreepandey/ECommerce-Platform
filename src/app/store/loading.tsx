import { Flexbox } from '@/components/atoms/Flexbox';
import { Grid } from '@/components/atoms/Grid';
import { Skeleton } from '@/components/atoms/Skeleton';
import { Spinner } from '@/components/atoms/Spinner';

export default function LoadingPage() {
  return (
    <Flexbox as="main" direction="column" gap="lg" padding="xl">
      <Spinner label="Loading page" />
      <Skeleton shape="line" width="half" />
      <Grid columns={3} gap="lg">
        <Skeleton shape="block" height="md" />
        <Skeleton shape="block" height="md" />
        <Skeleton shape="block" height="md" />
      </Grid>
    </Flexbox>
  );
}
