import { readStoredImage } from '@/server/uploads';
import { ShopError } from '@/server/store';
export const runtime = 'nodejs';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const bytes = await readStoredImage((await params).name);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public,max-age=31536000,immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return new Response('Изображение не найдено', {
      status: error instanceof ShopError ? error.status : 500,
    });
  }
}
