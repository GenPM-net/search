# @core/search — rules for AI agents

## Purpose
Site search on Postgres full-text search: one `search_documents` table fed by any `SearchSource` (@core/contracts),
weighted title/body vectors with the stemmer of each document's language, prefix matching for search-as-you-type,
snippets returned as plain parts (never HTML) and, if the `pg_trgm` extension exists, a typo-tolerant fallback on
titles. No external engine, no semantic search.

## Map
- `index.ts` — public API: `search`, `registerSearchSource`, `reindex`, `indexDocument`, `removeDocument`, `reindexJob`.
- `search.ts` — indexing and querying. `schema.ts` — table and GIN index.
- `adapters/hono.ts` — `searchRoutes()`. `adapters/next.ts` — `searchRoute` (GET).

## Integration
1. Generate and apply migrations (see `src/lib/db/AGENTS.md`). Optional typo tolerance: run
   `create extension if not exists pg_trgm;` once (available on Neon, Supabase, RDS).
2. Register sources in the project file `src/genpm/search.ts`, imported at startup:
   `registerSearchSource(contentSearchSource('pages', { path: ({ slug }) => `/${slug}` }))`.
3. Build the index once and then daily: `await reindexJob.enqueue({})` and `schedule('search.reindex', '0 3 * * *')` (@core/jobs).
4. Query: `const { hits } = await search(q, { locale })`, or mount `searchRoutes()` / `searchRoute` at `/api/search`.
5. Render snippets by mapping parts: `hit.snippet.map(p => p.match ? <mark>{p.text}</mark> : p.text)`.
6. Verify: index a document and find it by the first letters of a word in its title.

## Conventions
- Sources yield plain text bodies (strip Markdown/HTML first, e.g. with `toPlainText` of @core/rich-text).
- Pass `locale` when you know it: the query uses that language's stemmer and the GIN index.
- Only index published, public content; private data never goes into `search_documents`.

## Don't
- Don't build SQL from the query string; `search()` already sanitizes it to words.
- Don't render snippets with `dangerouslySetInnerHTML`.
- Don't call `reindex()` inside a request: use the job.
