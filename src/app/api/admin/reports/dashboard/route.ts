import { apiHandler } from '@/lib/api-handler';
import { requirePermission } from '@/modules/identity/access-control';
import {
  getDashboard,
  reportRangeSchema,
  resolveReportRange,
} from '@/modules/reporting/report.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'reports.read');
  const range = resolveReportRange(
    reportRangeSchema.parse(Object.fromEntries(request.nextUrl.searchParams)),
  );
  return Response.json({
    range: { from: range.fromDay, to: range.toDay },
    ...(await getDashboard(staff, range)),
  });
});
