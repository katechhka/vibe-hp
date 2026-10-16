import { after } from 'next/server';
import { respond, ShopError } from '@/server/http';
import { Payments } from '@/server/payments';
import { deliverReceipt } from '@/server/mail';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return respond(async () => {
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new ShopError(415, 'Ожидается JSON.');
    const reader = request.body?.getReader();
    if (!reader) throw new ShopError(400, 'Пустой запрос.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 24000) {
        await reader.cancel();
        throw new ShopError(413, 'Слишком большой запрос.');
      }
      chunks.push(part.value);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new ShopError(400, 'Некорректный JSON.');
    }
    const order = await new Payments().webhook(value);
    if (order?.status === 'paid') after(() => deliverReceipt(order.id));
    return { accepted: true }; // Never return order content to an unauthenticated webhook.
  });
}
