import { apiHandler } from '@/lib/api-handler';
import { requireStaff } from '@/modules/identity/access-control';
import { getStaffProfile } from '@/modules/identity/staff-account.service';

export const GET = apiHandler(async (request) => {
  const staff = await requireStaff(request);
  return Response.json({ staffUser: await getStaffProfile(staff) });
});
