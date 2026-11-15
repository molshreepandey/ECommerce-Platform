import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { changeStaffStatusSchema } from '@/modules/identity/staff-admin.schema';
import { changeStaffStatus } from '@/modules/identity/staff-admin.service';

import { uuidParam } from '../../../merchandising-id';

// 204; deactivation revokes the member's sessions; 409 OWN_ACCOUNT or LAST_SUPER_ADMIN.
export const POST = apiHandler(
  async (request, { params }: { params: Promise<{ staffUserId: string }> }, requestContext) => {
    const staff = await requirePermission(request, 'staff.manage');
    const staffUserId = await uuidParam(params, 'staffUserId', 'STAFF_NOT_FOUND');
    const input = await parseJsonBody(request, changeStaffStatusSchema);
    await changeStaffStatus(staff, staffUserId, input, requestMetadata(request, requestContext));
    return new Response(null, { status: 204 });
  },
);
