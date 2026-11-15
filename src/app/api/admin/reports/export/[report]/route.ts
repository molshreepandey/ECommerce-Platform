import { csvResponse } from '@/lib/csv';
import { apiHandler } from '@/lib/api-handler';
import { DomainError } from '@/lib/errors';
import { requirePermission } from '@/modules/identity/access-control';
import { reportRangeSchema, resolveReportRange } from '@/modules/reporting/report.service';
import { buildReportExport, reportExportSchema } from '@/modules/reporting/report-export.service';

// D8: GET /api/admin/reports/export/{orders|sales|gst-summary|inventory}?from=YYYY-MM-DD&to=YYYY-MM-DD
// (IST days, same range rules as the reports page); 422 EXPORT_TOO_LARGE for an oversized range.
export const GET = apiHandler(
  async (request, { params }: { params: Promise<{ report: string }> }) => {
    const staff = await requirePermission(request, 'reports.read');
    const report = reportExportSchema.safeParse((await params).report);
    if (!report.success) {
      throw new DomainError({ kind: 'NOT_FOUND', code: 'NOT_FOUND', message: 'Not found' });
    }
    const range = resolveReportRange(
      reportRangeSchema.parse(Object.fromEntries(request.nextUrl.searchParams)),
    );
    const csv = await buildReportExport(staff, report.data, range);
    const suffix = report.data === 'inventory' ? range.toDay : `${range.fromDay}_to_${range.toDay}`;
    return csvResponse(csv, `${report.data}-${suffix}.csv`);
  },
);
