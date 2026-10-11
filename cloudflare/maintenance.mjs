export async function runCleanup(env) {
 if (!env.CRON_SECRET) throw new Error('Set CRON_SECRET before enabling daily cleanup.');
 const response = await env.WORKER_SELF_REFERENCE.fetch('https://sync-reader.internal/api/maintenance', {
  method: 'POST', headers: { authorization: 'Bearer ' + env.CRON_SECRET }
 });
 const status = response.status;
 await response.body?.cancel();
 if (!response.ok) throw new Error('Scheduled reader cleanup failed with HTTP ' + status);
}
