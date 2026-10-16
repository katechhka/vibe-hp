import { respond } from '@/server/http';
import { paymentMode } from '@/server/yookassa';
export const runtime = 'nodejs';
export async function GET() {
  return respond(() => ({ mode: paymentMode() }));
}
