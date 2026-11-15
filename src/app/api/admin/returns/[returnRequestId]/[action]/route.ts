import { apiHandler } from '@/lib/api-handler';
import { DomainError } from '@/lib/errors';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import {
  decideReturn,
  exchangeReturn,
  markReturnPickedUp,
  markReturnReceived,
  refundReturn,
  restockReturn,
} from '@/modules/returns/return-admin.service';
import { decideReturnSchema, refundSchema } from '@/modules/returns/returns.schema';

import { uuidParam } from '../../../merchandising-id';

// D43: decide, pick-up, receive, restock, refund, exchange. 204 on success; 409 INVALID_TRANSITION.
export const POST = apiHandler(
  async (
    request,
    { params }: { params: Promise<{ returnRequestId: string; action: string }> },
    requestContext,
  ) => {
    const staff = await requirePermission(request, 'returns.write');
    const returnRequestId = await uuidParam(params, 'returnRequestId', 'RETURN_NOT_FOUND');
    const { action } = await params;
    const metadata = requestMetadata(request, requestContext);
    switch (action) {
      case 'decide':
        await decideReturn(
          staff,
          returnRequestId,
          await parseJsonBody(request, decideReturnSchema),
          metadata,
        );
        break;
      case 'pick-up':
        await markReturnPickedUp(staff, returnRequestId, metadata);
        break;
      case 'receive':
        await markReturnReceived(staff, returnRequestId, metadata);
        break;
      case 'restock':
        await restockReturn(staff, returnRequestId, metadata);
        break;
      case 'refund':
        await refundReturn(
          staff,
          returnRequestId,
          await parseJsonBody(request, refundSchema),
          metadata,
        );
        break;
      case 'exchange':
        await exchangeReturn(staff, returnRequestId, metadata);
        break;
      default:
        throw new DomainError({ kind: 'NOT_FOUND', code: 'NOT_FOUND', message: 'Not found' });
    }
    return new Response(null, { status: 204 });
  },
);
