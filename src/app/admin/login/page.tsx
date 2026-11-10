import type { Metadata } from 'next';
import { AuthLayout } from '@/components/layouts/AuthLayout';
import { LoginForm } from '@/components/organisms/LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function AdminLoginPage() {
  return (
    <AuthLayout title="Admin sign in" description="For store staff only.">
      <LoginForm endpoint="/api/admin/auth/login" defaultDestination="/" />
    </AuthLayout>
  );
}
