import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stabilizeDocumentScroll } from '../src/lib/epub-scroll';

// EPUB.js keeps a chapter's height when update unloads its iframe. Its later
// trim removes that placeholder and compensates with a document scroll jump.
function readerManager() {
  const chapters = [
    { height: 6000, visible: false, iframe: true },
    { height: 4000, visible: true, iframe: true },
    { height: 3000, visible: false, iframe: true },
  ];
  const scrollCalls: number[] = [];
  const manager = {
    settings: { offset: 500 },
    chapters,
    scrollCalls,
    update() { for (const chapter of chapters) if (!chapter.visible) chapter.iframe = false; },
    async trim() {
      scrollCalls.push(7000 - chapters[0].height);
      chapters.splice(0, 1);
    },
  };
  return manager;
}

test('document scrolling retains chapter heights and does not force a scroll during trim', async () => {
  const manager = readerManager();
  stabilizeDocumentScroll(manager, 1000);
  await manager.trim();
  assert.deepEqual(manager.scrollCalls, []);
  assert.deepEqual(manager.chapters.map(chapter => chapter.height), [6000, 4000, 3000]);
});

test('keeping placeholders still lets the existing update release offscreen iframes', async () => {
  const manager = readerManager();
  const update = manager.update;
  stabilizeDocumentScroll(manager, 1000);
  assert.equal(manager.update, update);
  manager.update();
  await manager.trim();
  assert.deepEqual(manager.chapters.map(chapter => chapter.iframe), [false, true, false]);
  assert.equal(manager.chapters.length, 3);
});

test('chapters preload two screens ahead and the distance follows viewport resize', () => {
  const manager = readerManager();
  stabilizeDocumentScroll(manager, 1024);
  assert.equal(manager.settings.offset, 2048);
  stabilizeDocumentScroll(manager, 768);
  assert.equal(manager.settings.offset, 1536);
  stabilizeDocumentScroll(manager, NaN);
  assert.equal(manager.settings.offset, 500);
});
