// Tablas de @core/search. Las recoge drizzle-kit vía src/lib/db/drizzle.config.ts.
import { customType, index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/** Índice de búsqueda: una fila por documento (`type` + `id`) con su vector ponderado (título A, cuerpo B). */
export const searchDocuments = pgTable(
  'search_documents',
  {
    type: text('type').notNull(),
    id: text('id').notNull(),
    locale: text('locale').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Configuración de texto de Postgres usada (`spanish`, `english`, `simple`…). */
    config: text('config').notNull(),
    tsv: tsvector('tsv').notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.type, t.id] }),
    index('search_documents_tsv_idx').using('gin', t.tsv),
    index('search_documents_locale_idx').on(t.locale, t.type),
  ],
);

export type SearchRow = typeof searchDocuments.$inferSelect;
