import { appStore as getStore } from '@/server/app-store';
import { body, owner, respond } from '@/server/http';
import { Payments } from '@/server/payments';
export const runtime = 'nodejs';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return respond(async () => {
    const value = await body(request);
    const id = (await params).id,
      session = await owner();
    const payments = new Payments();
    await payments.refresh(id, session);
    await getStore().retry(id, session, value.requestKey);
    return { order: await payments.start(id, session) };
  });
}
