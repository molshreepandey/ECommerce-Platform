import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata } from '@/modules/identity/access-control';
import { requestLoginOtp, requestOtpSchema } from '@/modules/identity/otp-login.service';

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const input = await parseJsonBody(request, requestOtpSchema);
  return Response.json({
    otp: await requestLoginOtp(input, requestMetadata(request, requestContext)),
  });
});
