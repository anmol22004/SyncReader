import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCleanup } from '../netlify/cleanup.mjs';
import { config } from '../netlify/functions/reader-cleanup.mjs';

test('Netlify daily cleanup authenticates to the production maintenance route', async () => {
  assert.equal(config.schedule, '0 0 * * *');
  let calls = 0;
  await runCleanup({ origin: 'https://folio.1mol.in', secret: 'test-secret', fetcher: async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://folio.1mol.in/api/maintenance');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, 'Bearer test-secret');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(null, { status: 200 });
  } });
  assert.equal(calls, 1);
});

test('Netlify cleanup fails before a request if configuration is missing or unsafe', async () => {
  const fetcher = async () => { assert.fail('Must not send credentials'); };
  for (const configuration of [{}, { secret: 'test-secret' }, { origin: 'http://example.com', secret: 'test-secret' }, { origin: 'https://user:password@example.com', secret: 'test-secret' }]) {
    await assert.rejects(runCleanup({ ...configuration, fetcher }));
  }
});

test('Netlify cleanup exposes failed status without backend details or secrets', async () => {
  await assert.rejects(runCleanup({ origin: 'https://folio.1mol.in', secret: 'test-secret', fetcher: async () => new Response('private backend error', { status: 503 }) }), {
    message: 'Scheduled reader cleanup failed with HTTP 503'
  });
});
