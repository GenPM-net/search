// @core/search — API pública. Importa desde aquí; endpoint en adapters/hono.ts y adapters/next.ts.
export { reindexJob } from './jobs.js';
export { type SearchRow, searchDocuments } from './schema.js';
export {
  clearSearchSources,
  indexDocument,
  queryWords,
  registerSearchSource,
  reindex,
  removeDocument,
  resetSearchCache,
  type SearchHit,
  type SearchOptions,
  type SnippetPart,
  search,
  textConfig,
} from './search.js';
