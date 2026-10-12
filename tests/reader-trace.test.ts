import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReaderTrace, readerTraceEnabled } from '../src/lib/reader-trace';
const meta = { build: 'test', builtAt: '', userAgent: 'test-browser' };
test('diagnostics require explicit opt-in', () => {
  assert.equal(readerTraceEnabled(''), false);
  assert.equal(readerTraceEnabled('?readerDebug=true'), false);
  assert.equal(readerTraceEnabled('?readerDebug=1'), true);
});
test('trace ring stays bounded, ordered and freezes until restarted', () => {
  let now = 0; const trace = new ReaderTrace(meta, 3, () => now++);
  for (let y = 0; y < 5; y++) trace.record('sample', { y });
  assert.deepEqual(trace.snapshot().entries.map(e => e.data.y), [2, 3, 4]);
  assert.equal(trace.snapshot().dropped, 3);
  trace.capture(); const captured = trace.json(); trace.record('sample', { y: 99 });
  assert.equal(trace.json(), captured);
  trace.restart(); assert.equal(trace.snapshot().entries.length, 1); assert.equal(trace.recording, true);
});
test('trace rejects free-form strings, unknown fields, nonfinite values and unknown events', () => {
  const trace = new ReaderTrace(meta);
  trace.record('sample', { y: 12, anchor: 'private-book-path', quote: 'private text', token: 'secret', width: Infinity });
  trace.record('private text');
  assert.deepEqual(trace.snapshot().entries.at(-1)?.data, { y: 12 });
  assert.equal(trace.snapshot().entries.length, 2);
});
