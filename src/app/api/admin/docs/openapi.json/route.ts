import openApiDocument from '../../../../../../docs/openapi.json';
import { apiHandler } from '@/lib/api-handler';
import { requireStaff } from '@/modules/identity/access-control';

// D49: the generated OpenAPI 3.1 document (`npm run docs:openapi`) for the Swagger UI at /docs.
export const GET = apiHandler(async (request) => {
  await requireStaff(request);
  return Response.json(openApiDocument, { headers: { 'Cache-Control': 'private, no-store' } });
});
