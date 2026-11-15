import { apiHandler } from '@/lib/api-handler';
import { auditListSchema, listAuditEntries } from '@/modules/audit/audit-query.service';
import { requirePermission } from '@/modules/identity/access-control';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'audit.read');
  const query = auditListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  return Response.json(await listAuditEntries(staff, query));
});
