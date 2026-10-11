export async function runCleanup({ origin, secret, fetcher = fetch }) {
  if (!secret) throw new Error('Set CRON_SECRET in Netlify Functions environment variables.');
  if (!origin) throw new Error('Netlify site URL is unavailable.');
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Cleanup requires an HTTPS site URL.');
  // Do not forward the secret to redirects or print backend response content.
  const response = await fetcher(new URL('/api/maintenance', url.origin), {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    redirect: 'error',
    signal: AbortSignal.timeout(25000)
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Scheduled reader cleanup failed with HTTP ${response.status}`);
}
