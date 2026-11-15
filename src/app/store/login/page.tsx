import type { Metadata } from 'next';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { AuthLayout } from '@/components/layouts/AuthLayout';
import { LoginForm } from '@/components/organisms/LoginForm';
import { OtpLoginForm } from '@/components/organisms/OtpLoginForm';
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
      <div className="flex flex-col gap-xl">
        <LoginForm endpoint="/api/store/auth/login" defaultDestination="/account" />
        <div className="flex flex-col gap-md border-t border-lowlight pt-lg">
          <Text variant="body2-medium">Or sign in with a one-time code</Text>
          <OtpLoginForm />
        </div>
      </div>
    </AuthLayout>
  );
}
