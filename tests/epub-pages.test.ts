import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookPagePosition } from '../src/lib/epub-pages';
test('whole-book page adds preceding sections and includes a total', () => {
  assert.deepEqual(bookPagePosition({ 0: 3, 1: 10, 2: 8 }, 1, 4), { page: 7, total: 21, remaining: 6 });
});
test('first and last pages have valid bounds', () => {
  assert.deepEqual(bookPagePosition({ 0: 3, 1: 10 }, 0, 0), { page: 1, total: 13, remaining: 2 });
  assert.deepEqual(bookPagePosition({ 0: 3, 1: 10 }, 1, 999), { page: 13, total: 13, remaining: 0 });
});
test('reflow recalculates page numbering without changing the content anchor', () => {
  assert.equal(bookPagePosition({ 0: 3, 1: 10 }, 1, 4)?.total, 13);
  assert.equal(bookPagePosition({ 0: 6, 1: 20 }, 1, 7)?.total, 26);
  assert.equal(bookPagePosition({}, 1, 7), null);
});
