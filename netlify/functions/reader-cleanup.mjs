import { runCleanup } from '../cleanup.mjs';

export default async function handler() {
  await runCleanup({ origin: process.env.URL, secret: process.env.CRON_SECRET });
}

// Published production deploys only. Midnight UTC / 05:30 India time.
export const config = { schedule: '0 0 * * *' };
