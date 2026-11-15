import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StaffManager } from '@/components/organisms/StaffAdmin';
import { formatDateTime } from '@/lib/date-format';
import { listRoles, listStaffMembers } from '@/modules/identity/staff-admin.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';

export const metadata: Metadata = { title: 'Staff' };

export default function StaffPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/staff"
        title="Staff"
        readPermission="staff.manage"
        writePermission="staff.manage"
      >
        {async ({ staff }) => {
          const [members, roles] = await Promise.all([listStaffMembers(staff), listRoles(staff)]);
          return (
            <StaffManager
              currentStaffUserId={staff.staffUserId}
              roles={roles.map(({ code, name }) => ({ code, name }))}
              members={members.map((member) => ({
                id: member.id,
                fullName: member.fullName,
                email: member.email,
                status: member.status,
                lastLoginLabel:
                  member.lastLoginAt === null ? 'never' : formatDateTime(member.lastLoginAt),
                roles: member.roles.map(({ role }) => role),
              }))}
            />
          );
        }}
      </AdminPageFrame>
    </Suspense>
  );
}
