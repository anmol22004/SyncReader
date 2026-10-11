import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expiredReceipt, expiredUpload, RETENTION_MS } from '../src/lib/retention';
const now = 100 * RETENTION_MS;
test('cleanup expires only receipts outside the retry window', () => {
 assert.equal(expiredReceipt(now - RETENTION_MS - 1, 'old', new Set(), now), true);
 assert.equal(expiredReceipt(now - RETENTION_MS, 'edge', new Set(), now), false);
 assert.equal(expiredReceipt(now, 'new', new Set(), now), false);
});
test('cleanup preserves pending operations even after prolonged offline use', () => {
 assert.equal(expiredReceipt(1, 'pending', new Set(['pending']), now), false);
});
test('legacy receipt metadata is retained for migration rather than discarded', () => {
 assert.equal(expiredReceipt(undefined, 'legacy', new Set(), now), false);
});
test('only stale upload recovery metadata is removed', () => {
 assert.equal(expiredUpload(new Date(now - RETENTION_MS - 1).toISOString(), now), true);
 assert.equal(expiredUpload(new Date(now).toISOString(), now), false);
 assert.equal(expiredUpload(undefined, now), false);
});
