import type { Metadata } from 'next';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { AuthLayout } from '@/components/layouts/AuthLayout';
import { LoginForm } from '@/components/organisms/LoginForm';
import { storeName } from '../store-shell';

export const metadata: Metadata = { title: 'Sign in' };

export default function StoreLoginPage() {
  return (
    <AuthLayout
      title="Sign in"
      description={`Welcome back to ${storeName}.`}
      footer={
        <div className="flex flex-col items-center gap-sm">
          <Text align="center">
            New here? <Link href="/register">Create an account</Link>
          </Text>
          <Link href="/" appearance="subtle" variant="body3">
            Back to the store
          </Link>
        </div>
      }
    >
      <LoginForm endpoint="/api/store/auth/login" defaultDestination="/account" />
    </AuthLayout>
  );
}
