import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCleanup } from '../cloudflare/maintenance.mjs';
test('scheduled maintenance authenticates through the internal binding', async () => {
 let calls = 0;
 await runCleanup({ CRON_SECRET: 'test-secret', WORKER_SELF_REFERENCE: { async fetch(url, options) {
  calls++; assert.equal(url, 'https://sync-reader.internal/api/maintenance');
  assert.equal(options.method, 'POST'); assert.equal(options.headers.authorization, 'Bearer test-secret');
  return new Response('{}');
 } } });
 assert.equal(calls, 1);
});
test('scheduled maintenance without a secret makes no request', async () => {
 await assert.rejects(runCleanup({ WORKER_SELF_REFERENCE: { fetch() { throw new Error('Unexpected request'); } } }), /Set CRON_SECRET/);
});
test('cleanup failures are visible without leaking response content or secrets', async () => {
 await assert.rejects(runCleanup({ CRON_SECRET: 'test-secret', WORKER_SELF_REFERENCE: { async fetch() { return new Response('private backend error', { status: 503 }); } } }), error => {
  assert.equal(error.message, 'Scheduled reader cleanup failed with HTTP 503'); return true;
 });
});
