import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportMarkdown } from '../src/lib/export';
import type { Annotation } from '../src/lib/types';
test('Markdown export includes multiline quotes and notes, omits tombstones and escapes raw HTML', () => {
  const a: Annotation = { id: '1', user_id: 'user', book_id: 'book', kind: 'highlight', anchor: { type: 'pdf', page: 4, rects: [] }, quote: 'First line\n<script>second</script>', note: 'A *thought*', color: 'yellow', revision: 1, created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z', deleted_at: null };
  const result = exportMarkdown({ title: 'My [book]', author: 'Reader' }, [a, { ...a, quote: 'Deleted quote', deleted_at: a.created_at }]);
  assert.ok(result.includes('Page 4')); assert.ok(result.includes('> First line\n> \\<script\\>')); assert.ok(result.includes('A \\*thought\\*')); assert.ok(!result.includes('Deleted quote')); assert.ok(result.includes('Created:'));
});
