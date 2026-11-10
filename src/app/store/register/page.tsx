import type { Metadata } from 'next';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { AuthLayout } from '@/components/layouts/AuthLayout';
import { RegisterForm } from '@/components/organisms/RegisterForm';

export const metadata: Metadata = { title: 'Create an account' };

export default function StoreRegisterPage() {
  return (
    <AuthLayout
      title="Create an account"
      description="Save addresses and track your orders."
      footer={
        <div className="flex flex-col items-center gap-sm">
          <Text align="center">
            Already have an account? <Link href="/login">Sign in</Link>
          </Text>
          <Link href="/" appearance="subtle" variant="body3">
            Back to the store
          </Link>
        </div>
      }
    >
      <RegisterForm />
    </AuthLayout>
  );
}
