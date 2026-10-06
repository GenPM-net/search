// Adaptador Hono: `app.route('/api/search', searchRoutes())` → GET /api/search?q=taza&locale=es&type=product
import { Hono } from 'hono';
import { search } from '../index.ts';

export function searchRoutes() {
  return new Hono().get('/', async (c) => {
    const q = (c.req.query('q') ?? '').slice(0, 200);
    const types = c.req.queries('type');
    const res = await search(q, { locale: c.req.query('locale'), types, limit: Number(c.req.query('limit') ?? 10) || 10 });
    c.header('cache-control', 'public, max-age=60');
    return c.json(res);
  });
}
