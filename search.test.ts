import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SearchChange, SearchDocument } from '../contracts/index.ts';
import { type Db, setDb } from '../db/index.ts';
import { searchRoutes } from './adapters/hono.ts';
import { searchRoute } from './adapters/next.ts';
import * as schema from './schema.ts';
import {
  clearSearchSources,
  indexDocument,
  queryWords,
  registerSearchSource,
  reindex,
  removeDocument,
  resetSearchCache,
  search,
  textConfig,
} from './index.ts';

// Como el fixture de @core/db, pero con pg_trgm instalado (opcional en producción).
async function testDbWithTrigram(trigram: boolean): Promise<Db> {
  const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api');
  const client = new PGlite({ extensions: { pg_trgm } });
  if (trigram) await client.exec('create extension pg_trgm');
  for (const s of await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema))) await client.exec(s);
  const db = drizzle(client) as unknown as Db;
  setDb(db);
  return db;
}

const doc = (id: string, title: string, body: string, extra: Partial<SearchDocument> = {}): SearchDocument => ({
  id, type: 'page', url: `/${id}`, title, body, locale: 'es', ...extra,
});

beforeEach(async () => {
  await testDbWithTrigram(true);
  resetSearchCache();
  clearSearchSources();
});

describe('query parsing', () => {
  it('keeps only words and maps locales to text configs', () => {
    expect(queryWords("tazas & rojas | !'); drop")).toEqual(['tazas', 'rojas', 'drop']);
    expect(queryWords('   ')).toEqual([]);
    expect(textConfig('es-MX')).toBe('spanish');
    expect(textConfig('pt-BR')).toBe('portuguese');
    expect(textConfig('ja')).toBe('simple');
  });
});

describe('search', () => {
  it('stems by language, ranks titles first and matches prefixes', async () => {
    await indexDocument(doc('a', 'Tazas de cerámica', 'Hechas a mano en Valencia'));
    await indexDocument(doc('b', 'Platos', 'Combinan con nuestras tazas rojas'));
    await indexDocument(doc('c', 'Envíos', 'Enviamos a toda Europa'));
    const r = await search('taza', { locale: 'es' });
    expect(r.hits.map((h) => h.id)).toEqual(['a', 'b']);
    expect((await search('cerám')).hits.map((h) => h.id)).toEqual(['a']);
    expect((await search('', {})).hits).toEqual([]);
  });

  it('returns snippets as safe parts, never HTML', async () => {
    await indexDocument(doc('x', 'XSS', 'Texto <script>alert(1)</script> con tazas bonitas'));
    const [hit] = (await search('tazas')).hits;
    expect(hit!.snippet.find((p) => p.match)?.text).toBe('tazas');
    // ts_headline descarta las etiquetas; y las partes nunca se pintan como HTML.
    expect(hit!.snippet.map((p) => p.text).join('')).not.toContain('<script>');
  });

  it('filters by locale and type', async () => {
    await indexDocument(doc('es1', 'Tazas', 'cerámica'));
    await indexDocument(doc('en1', 'Mugs', 'ceramic mugs', { locale: 'en' }));
    await indexDocument(doc('p1', 'Taza azul', 'producto', { type: 'product' }));
    expect((await search('mug', { locale: 'en' })).hits.map((h) => h.id)).toEqual(['en1']);
    expect((await search('taza', { types: ['product'] })).hits.map((h) => h.id)).toEqual(['p1']);
  });

  it('falls back to trigram similarity for typos when pg_trgm exists', async () => {
    await indexDocument(doc('a', 'Cafetera italiana', 'Para espresso'));
    const r = await search('cafetrea', { locale: 'es' });
    expect(r.fuzzy).toBe(true);
    expect(r.hits.map((h) => h.id)).toEqual(['a']);
  });

  it('works without pg_trgm (no fuzzy fallback)', async () => {
    await testDbWithTrigram(false);
    resetSearchCache();
    await indexDocument(doc('a', 'Cafetera italiana', 'Para espresso'));
    expect(await search('cafetrea')).toEqual({ hits: [], fuzzy: false });
    expect((await search('cafetera')).hits).toHaveLength(1);
  });
});

describe('sources', () => {
  it('reindexes registered sources and removes stale documents', async () => {
    let docs = [doc('1', 'Uno', 'primero'), doc('2', 'Dos', 'segundo')];
    registerSearchSource({ type: 'page', async *documents() { yield* docs; } });
    expect(await reindex()).toEqual({ indexed: 2, removed: 0 });
    docs = [doc('1', 'Uno editado', 'primero')];
    expect(await reindex(['page'])).toEqual({ indexed: 1, removed: 1 });
    expect((await search('editado')).hits.map((h) => h.id)).toEqual(['1']);
    expect((await search('segundo')).hits).toEqual([]);
  });

  it('indexes incremental changes from subscribe', async () => {
    let emit: (c: SearchChange) => void | Promise<void> = () => {};
    registerSearchSource({
      type: 'post',
      async *documents() {},
      subscribe(listener) {
        emit = listener;
        return () => {
          emit = () => {};
        };
      },
    });
    await emit({ op: 'upsert', doc: doc('p', 'Novedades de otoño', 'Lanzamos colección', { type: 'post' }) });
    expect((await search('otoño')).hits.map((h) => h.type)).toEqual(['post']);
    await emit({ op: 'delete', type: 'post', id: 'p' });
    expect((await search('otoño')).hits).toEqual([]);
    await removeDocument('post', 'missing');
  });
});

describe('adapters', () => {
  it('Hono and Next expose GET search with cache headers', async () => {
    await indexDocument(doc('a', 'Tazas', 'cerámica'));
    const app = new Hono().route('/api/search', searchRoutes());
    const res = await app.request('/api/search?q=taza&locale=es');
    expect(res.headers.get('cache-control')).toContain('max-age');
    expect(((await res.json()) as { hits: unknown[] }).hits).toHaveLength(1);
    const n = await searchRoute(new Request('http://x/api/search?q=taza&type=page'));
    expect(((await n.json()) as { hits: unknown[] }).hits).toHaveLength(1);
  });
});
