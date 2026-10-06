// Adaptador Next.js: `app/api/search/route.ts` → `export { searchRoute as GET } from '@/lib/search/adapters/next';`
// En Server Components llama a `search()` directamente.
import { search } from '../index.js';

export async function searchRoute(req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams;
  const res = await search((p.get('q') ?? '').slice(0, 200), {
    locale: p.get('locale') ?? undefined,
    types: p.getAll('type'),
    limit: Number(p.get('limit') ?? 10) || 10,
  });
  return Response.json(res, { headers: { 'cache-control': 'public, max-age=60' } });
}
