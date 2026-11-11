import type { ReactNode } from 'react';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Spinner } from '@/components/atoms/Spinner';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { AdminSessionMenu } from '@/components/organisms/AdminSessionMenu';
import type { StaffContext } from '@/modules/identity/access-control';
import { currentStaffOrRedirect } from '@/modules/identity/current-session';
import type { PermissionCode } from '@/modules/identity/permissions';
import { getStaffProfile } from '@/modules/identity/staff-account.service';
import { adminNavigationEntries, visibleNavigationItems } from './admin-shell';

export type AdminPageAccess = Readonly<{ staff: StaffContext; canWrite: boolean }>;

// Server-rendered shell for signed-in admin pages: session (redirects to sign-in), role-aware
// navigation, and an access-denied state when the page's permission is missing. The API checks again.
export async function AdminPageFrame({
  path,
  title,
  readPermission,
  writePermission,
  children,
}: Readonly<{
  path: string;
  title: string;
  readPermission: PermissionCode;
  writePermission: PermissionCode;
  children: (access: AdminPageAccess) => ReactNode | Promise<ReactNode>;
}>) {
  const staff = await currentStaffOrRedirect(path);
  const profile = await getStaffProfile(staff);
  const roleNames = profile.roles.map(({ name }) => name).join(', ');
  const canRead = staff.permissionCodes.has(readPermission);
  return (
    <AdminLayout
      navigationItems={visibleNavigationItems(adminNavigationEntries, staff.permissionCodes)}
      title={title}
      headerActions={<AdminSessionMenu fullName={profile.fullName} roleNames={roleNames} />}
    >
      {canRead ? (
        await children({ staff, canWrite: staff.permissionCodes.has(writePermission) })
      ) : (
        <EmptyState
          icon="circle-alert"
          headingLevel={2}
          title="You do not have access to this page"
          description="Ask a super admin for the permission this page needs if you need it."
        />
      )}
    </AdminLayout>
  );
}

export function AdminPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size="lg" label="Loading" />
    </div>
  );
}
