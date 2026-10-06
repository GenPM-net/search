// Tarea de reindexado completo (prográmala a diario; el indexado incremental llega por `subscribe`).
import { z } from 'zod';
import { defineJob } from '../jobs/index.js';
import { reindex } from './search.js';

export const reindexJob = defineJob('search.reindex', z.object({ types: z.array(z.string()).optional() }), async ({ types }) => {
  await reindex(types);
}, { timeoutMs: 15 * 60_000, maxAttempts: 3 });
