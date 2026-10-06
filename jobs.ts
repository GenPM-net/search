// Tarea de reindexado completo (prográmala a diario; el indexado incremental llega por `subscribe`).
import { z } from 'zod';
import { defineJob } from '../jobs/index.ts';
import { reindex } from './search.ts';

export const reindexJob = defineJob('search.reindex', z.object({ types: z.array(z.string()).optional() }), async ({ types }) => {
  await reindex(types);
}, { timeoutMs: 15 * 60_000, maxAttempts: 3 });
