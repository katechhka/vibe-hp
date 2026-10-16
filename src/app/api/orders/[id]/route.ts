import { after } from 'next/server';
import { owner, respond } from '@/server/http';
import { deliverReceipt } from '@/server/mail';
import { Payments } from '@/server/payments';
export const runtime = 'nodejs';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return respond(async () => {
    const order = await new Payments().refresh(
      (await params).id,
      await owner()
    );
    if (order.status === 'paid') after(() => deliverReceipt(order.id));
    return { order };
  });
}
