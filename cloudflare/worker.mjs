// OpenNext generates this module during build.
import handler from '../.open-next/worker.js';
import { runCleanup } from './maintenance.mjs';
export default {
 fetch: handler.fetch,
 async scheduled(_event, env) { await runCleanup(env); }
};
