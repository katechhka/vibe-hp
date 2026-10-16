import { appStore as getStore } from '@/server/app-store';
import { respond } from '@/server/http';
export const runtime = 'nodejs';
export async function GET() {
  return respond(async () => ({ products: await getStore().catalog() }));
}
