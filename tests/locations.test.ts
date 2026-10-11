import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLocation, sameLocation } from '../src/lib/locations';
const pdf = { version: 1, type: 'pdf', page: 10, x: .2, y: .7, progression: .3 } as const;
test('PDF coordinates and file page bounds are validated', () => { assert.equal(validateLocation(pdf, 'pdf', 20), true); for (const invalid of [{ ...pdf, page: 21 }, { ...pdf, page: 1.5 }, { ...pdf, x: NaN }, { ...pdf, y: 1.1 }, { ...pdf, progression: Infinity }]) assert.equal(validateLocation(invalid, 'pdf', 20), false); });
test('EPUB locations are content anchors, not page numbers', () => { assert.equal(validateLocation({ version: 1, type: 'epub', cfi: 'epubcfi(/6/2!/4/2:0)', href: 'chapter.xhtml', spineIndex: 0, progression: .1 }, 'epub'), true); assert.equal(validateLocation({ ...pdf, type: 'epub' }, 'epub'), false); assert.equal(validateLocation(pdf, 'epub'), false); });
test('minor PDF rounding changes do not cause redundant saves', () => { assert.equal(sameLocation(pdf, { ...pdf, y: .7001 }), true); assert.equal(sameLocation(pdf, { ...pdf, page: 11 }), false); });

import { epubProgress } from '../src/lib/locations';
test('empty EPUB index does not override progress with a zero percentage', () => {
  assert.equal(epubProgress({ index: 40, percentage: 0 }, 80, false), .5);
});
test('EPUB progress advances within a long chapter before indexing finishes', () => {
  const early = epubProgress({ index: 0, displayed: { page: 1, total: 20 } }, 1, false);
  const later = epubProgress({ index: 0, displayed: { page: 11, total: 20 } }, 1, false);
  assert.equal(early, 0); assert.equal(later, .5);
});
test('indexed EPUB progress uses text locations rather than chapter sizes', () => {
  assert.equal(epubProgress({ index: 40, percentage: .72 }, 80, true), .72);
  assert.equal(epubProgress({ index: 40, percentage: 0 }, 80, true), 0);
});
test('EPUB fallback handles missing pages, invalid percentages and book bounds', () => {
  assert.equal(epubProgress({ index: 4, percentage: NaN }, 8, true), .5);
  assert.equal(epubProgress({ index: 99 }, 8, false), 1);
  assert.equal(epubProgress({ index: 0 }, 0, false), 0);
});
