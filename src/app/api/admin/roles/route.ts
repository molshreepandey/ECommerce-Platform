import { apiHandler } from '@/lib/api-handler';
import { requirePermission } from '@/modules/identity/access-control';
import { listRoles } from '@/modules/identity/staff-admin.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'staff.manage');
  return Response.json({ roles: await listRoles(staff) });
});
