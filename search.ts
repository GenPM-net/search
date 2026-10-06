// Indexado y consulta con el texto completo de Postgres (y pg_trgm, si está instalado, para erratas).
import { and, eq, inArray, notInArray, type SQL, sql } from 'drizzle-orm';
import type { SearchChange, SearchDocument, SearchSource } from '../contracts/index.ts';
import { type Executor, getDb } from '../db/index.ts';
import { searchDocuments } from './schema.ts';

/** Idioma → configuración de texto de Postgres. Lo demás usa `simple` (sin raíces, funciona en cualquier idioma). */
const CONFIGS: Record<string, string> = {
  en: 'english', es: 'spanish', pt: 'portuguese', fr: 'french', de: 'german', it: 'italian', nl: 'dutch',
  sv: 'swedish', da: 'danish', fi: 'finnish', no: 'norwegian', nb: 'norwegian', ru: 'russian', tr: 'turkish',
  hu: 'hungarian', ro: 'romanian',
};

export const textConfig = (locale: string | undefined) => CONFIGS[(locale ?? 'en').toLowerCase().split('-')[0]!] ?? 'simple';

const MAX_BODY = 100_000;

const vector = (config: string, title: string, body: string) =>
  sql`setweight(to_tsvector(${config}::regconfig, ${title}), 'A') || setweight(to_tsvector(${config}::regconfig, ${body}), 'B')`;

export async function indexDocument(doc: SearchDocument, db: Executor = getDb()): Promise<void> {
  const locale = doc.locale ?? 'en';
  const config = textConfig(locale);
  const body = doc.body.slice(0, MAX_BODY);
  const values = { type: doc.type, id: doc.id, locale, url: doc.url, title: doc.title, body, config, tsv: vector(config, doc.title, body), indexedAt: new Date() };
  await db
    .insert(searchDocuments)
    .values(values as never)
    .onConflictDoUpdate({ target: [searchDocuments.type, searchDocuments.id], set: values as never });
}

export async function removeDocument(type: string, id: string, db: Executor = getDb()): Promise<void> {
  await db.delete(searchDocuments).where(and(eq(searchDocuments.type, type), eq(searchDocuments.id, id)));
}

const sources = new Map<string, { source: SearchSource; unsubscribe?: () => void }>();

/** Registra una fuente (en `src/genpm/search.ts`). Sus avisos incrementales se indexan al momento. */
export function registerSearchSource(source: SearchSource): void {
  sources.get(source.type)?.unsubscribe?.();
  const unsubscribe = source.subscribe?.((change: SearchChange) =>
    change.op === 'upsert' ? indexDocument(change.doc) : removeDocument(change.type, change.id),
  );
  sources.set(source.type, { source, unsubscribe });
}

/** Solo tests. */
export function clearSearchSources(): void {
  for (const s of sources.values()) s.unsubscribe?.();
  sources.clear();
}

/** Reindexa todas las fuentes (o las de `types`) y borra los documentos que ya no existen. */
export async function reindex(types?: string[], db: Executor = getDb()): Promise<{ indexed: number; removed: number }> {
  let indexed = 0;
  let removed = 0;
  for (const [type, { source }] of sources) {
    if (types && !types.includes(type)) continue;
    const seen: string[] = [];
    for await (const doc of source.documents()) {
      await indexDocument({ ...doc, type }, db);
      seen.push(doc.id);
      indexed++;
    }
    const stale = await db
      .delete(searchDocuments)
      .where(and(eq(searchDocuments.type, type), seen.length ? notInArray(searchDocuments.id, seen) : undefined))
      .returning({ id: searchDocuments.id });
    removed += stale.length;
  }
  return { indexed, removed };
}

/** Palabras de la consulta, sin operadores: solo letras y números (seguro para to_tsquery). */
export function queryWords(q: string): string[] {
  return (q.normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12).map((w) => w.toLowerCase());
}

export type SnippetPart = { text: string; match: boolean };

export type SearchHit = { type: string; id: string; url: string; title: string; snippet: SnippetPart[]; rank: number };

export type SearchOptions = { types?: string[]; locale?: string; limit?: number; offset?: number };

const START = '\u0002';
const STOP = '\u0003';

/** Fragmento con coincidencias como partes (sin HTML: seguro de pintar). */
function toParts(headline: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  for (const piece of headline.split(START)) {
    const [hit, rest] = piece.includes(STOP) ? piece.split(STOP) : [null, piece];
    if (hit) parts.push({ text: hit, match: true });
    if (rest) parts.push({ text: rest, match: false });
  }
  return parts;
}

let trgm: boolean | null = null;
async function hasTrigram(db: Executor): Promise<boolean> {
  if (trgm === null) {
    const r = (await db.execute(sql`select 1 from pg_extension where extname = 'pg_trgm'`)) as unknown as { rows?: unknown[]; length?: number };
    trgm = (r.rows?.length ?? r.length ?? 0) > 0;
  }
  return trgm;
}

/** Solo tests. */
export const resetSearchCache = () => {
  trgm = null;
};

/**
 * Busca `q` (prefijo en la última palabra, para "mientras escribes"). Si no hay resultados y pg_trgm está
 * instalado, reintenta por similitud del título (erratas).
 */
export async function search(q: string, opts: SearchOptions = {}, db: Executor = getDb()): Promise<{ hits: SearchHit[]; fuzzy: boolean }> {
  const words = queryWords(q);
  if (!words.length) return { hits: [], fuzzy: false };
  const tsq = words.map((w, i) => (i === words.length - 1 ? `${w}:*` : w)).join(' & ');
  // Con idioma, configuración constante (usa el índice GIN); sin él, la de cada documento (busca en todos los idiomas).
  const query = opts.locale
    ? sql`to_tsquery(${textConfig(opts.locale)}::regconfig, ${tsq})`
    : sql`to_tsquery(${searchDocuments.config}::regconfig, ${tsq})`;
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const filters: SQL[] = [];
  if (opts.locale) filters.push(eq(searchDocuments.locale, opts.locale));
  if (opts.types?.length) filters.push(inArray(searchDocuments.type, opts.types));
  const columns = (rank: SQL) => ({
    type: searchDocuments.type,
    id: searchDocuments.id,
    url: searchDocuments.url,
    title: searchDocuments.title,
    rank: sql<number>`${rank}`.mapWith(Number),
    headline: sql<string>`ts_headline(${searchDocuments.config}::regconfig, ${searchDocuments.body}, ${query}, ${`StartSel=${START}, StopSel=${STOP}, MaxWords=30, MinWords=12, MaxFragments=1`})`,
  });
  const rows = await db
    .select(columns(sql`ts_rank_cd(${searchDocuments.tsv}, ${query})`))
    .from(searchDocuments)
    .where(and(sql`${searchDocuments.tsv} @@ ${query}`, ...filters))
    .orderBy(sql`5 desc`, searchDocuments.id)
    .limit(limit)
    .offset(Math.max(opts.offset ?? 0, 0));
  let fuzzy = false;
  let result = rows;
  if (!rows.length && !opts.offset && (await hasTrigram(db))) {
    const phrase = words.join(' ');
    fuzzy = true;
    result = await db
      .select(columns(sql`word_similarity(${phrase}, ${searchDocuments.title})`))
      .from(searchDocuments)
      .where(and(sql`word_similarity(${phrase}, ${searchDocuments.title}) > 0.4`, ...filters))
      .orderBy(sql`5 desc`, searchDocuments.id)
      .limit(limit);
  }
  return {
    fuzzy,
    hits: result.map((r) => ({
      type: r.type,
      id: r.id,
      url: r.url,
      title: r.title,
      rank: r.rank,
      snippet: toParts(r.headline),
    })),
  };
}
