import { appStore as getStore } from '@/server/app-store';
import { owner, respond } from '@/server/http';
import { ShopError } from '@/server/store';
export const runtime = 'nodejs';
export async function GET() {
  return respond(async () => {
    let identity: string | undefined;
    try {
      identity = await owner();
    } catch (e) {
      if (!(e instanceof ShopError) || e.status !== 404) throw e;
    }
    return { stock: await getStore().stock(identity) };
  });
}
