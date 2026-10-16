import { appStore as getStore } from '@/server/app-store';
import { body, owner, respond } from '@/server/http';
import { paymentMode, credentials } from '@/server/yookassa';
import { Payments } from '@/server/payments';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return respond(async () => {
    const value = await body(request);
    const mode = paymentMode();
    if (mode === 'yookassa_test') credentials();
    const session = await owner(true);
    const saved = await getStore().create(value, session, mode);
    return { order: await new Payments().start(saved.id, session) };
  });
}
