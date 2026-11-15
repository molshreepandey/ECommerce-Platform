import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { createStaffSchema } from '@/modules/identity/staff-admin.schema';
import { createStaffMember, listStaffMembers } from '@/modules/identity/staff-admin.service';

// D3: staff.manage only (SUPER_ADMIN).
export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'staff.manage');
  return Response.json({ staff: await listStaffMembers(staff) });
});

// 201; 409 STAFF_EMAIL_TAKEN; 422 ROLE_NOT_FOUND; 400 for the demo email domain or password outside
// development and test.
export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'staff.manage');
  const input = await parseJsonBody(request, createStaffSchema);
  const created = await createStaffMember(staff, input, requestMetadata(request, requestContext));
  return Response.json({ staffUser: created }, { status: 201 });
});
