import { appStore as getStore } from '@/server/app-store';
import { after } from 'next/server';
import { body, owner, respond } from '@/server/http';
import { deliverReceipt } from '@/server/mail';
export const runtime = 'nodejs';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return respond(async () => {
    const value = await body(request);
    const order = await getStore().resolve(
      (await params).id,
      await owner(),
      value.attemptId,
      value.result
    );
    if (order.status === 'paid') after(() => deliverReceipt(order.id));
    return { order };
  });
}
