import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionObserver, readEpubSelection, type SelectionContents } from '../src/lib/epub-selection';

function fixture() {
  let active = true;
  let calls = 0;
  const doc = { getSelection: () => ({ isCollapsed: !active, rangeCount: active ? 1 : 0, getRangeAt: () => range }) } as unknown as Document;
  const node = { ownerDocument: doc } as Node;
  const range = { collapsed: false, startContainer: node, endContainer: node, startOffset: 0, endOffset: 4, toString: () => ' Book ' } as Range;
  const contents: SelectionContents = { document: doc, cfiFromRange: () => { calls++; return 'epubcfi(/6/2!/4/1:0)'; } };
  return { contents, range, active: (value: boolean) => { active = value; }, calls: () => calls };
}

test('parent sampling detects selection without iframe events and deduplicates unchanged ranges', () => {
  const f = fixture(); const changes: unknown[] = [];
  const observe = createSelectionObserver(value => changes.push(value));
  observe([f.contents]); observe([f.contents]);
  assert.equal(changes.length, 1); assert.equal(f.calls(), 1);
  assert.deepEqual(changes[0], { anchor: { type: 'epub', cfi: 'epubcfi(/6/2!/4/1:0)' }, quote: 'Book' });
});

test('empty neighbouring chapter does not dismiss selection; collapse and unloading do', () => {
  const selected = fixture(); const neighbour = fixture(); neighbour.active(false);
  const changes: unknown[] = []; const observe = createSelectionObserver(value => changes.push(value));
  observe([neighbour.contents, selected.contents]); observe([selected.contents, neighbour.contents]);
  assert.equal(changes.length, 1);
  selected.active(false); observe([neighbour.contents, selected.contents]); observe([]);
  assert.deepEqual(changes.slice(1), [null]);
  selected.active(true); observe([selected.contents]); observe([]);
  assert.equal(changes.at(-1), null);
});

test('changed selection boundaries refresh the action and empty selections are rejected', () => {
  const f = fixture(); const changes: unknown[] = []; const observe = createSelectionObserver(value => changes.push(value));
  observe([f.contents]); Object.assign(f.range, { endOffset: 8 }); observe([f.contents]);
  assert.equal(changes.length, 2);
  Object.assign(f.range, { toString: () => '  ' }); assert.equal(readEpubSelection(f.contents), null);
});

test('element boundary offsets are normalized on a clone without moving native handles', () => {
  const f = fixture();
  const element = { nodeType: 1, ownerDocument: f.contents.document };
  const text = { nodeType: 3, textContent: 'Book', length: 4, ownerDocument: f.contents.document };
  const clone = { setStart: (node: unknown, offset: number) => { assert.equal(node, text); assert.equal(offset, 0); }, setEnd: (node: unknown, offset: number) => { assert.equal(node, text); assert.equal(offset, 4); } };
  Object.assign(f.range, { startContainer: element, endContainer: element, commonAncestorContainer: element, intersectsNode: () => true, cloneRange: () => clone });
  Object.assign(f.contents.document, { createTreeWalker: () => { let first = true; return { nextNode: () => { if (!first) return null; first = false; return text; } }; } });
  f.contents.cfiFromRange = range => { assert.equal(range, clone); return 'normalized'; };
  assert.equal(readEpubSelection(f.contents)?.anchor.cfi, 'normalized');
  assert.equal(f.range.startContainer, element);
});
