import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { stabilizeContinuousScroll } from '../src/lib/epub-scroll';

// Exercise the installed EPUB.js methods, including their Safari redraw hack
// and trailing scroll debounce. Only DOM geometry and the task queue are fake.
const ContinuousManager = require('epubjs/lib/managers/continuous').default;
const IframeView = require('epubjs/lib/managers/views/iframe').default;

type ChapterSpec = { top: number; height?: number; loaded?: boolean };

function fixture(t: TestContext, fullsize = true) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousRaf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const scrollEvents = new EventTarget();
  const scroller = Object.assign(scrollEvents, {
    scrollX: 0, scrollY: 0, scrollLeft: 0, scrollTop: 0,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
    getComputedStyle: (element: { style: unknown }) => element.style,
    scrollBy(x: number, y: number) {
      this.scrollX += x; this.scrollY += y;
      scrollEvents.dispatchEvent(new Event('scroll'));
    },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: scroller });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: scroller.requestAnimationFrame });
  const counters = { transforms: 0, forcedLayouts: 0, destroyed: 0, check: 0, loaded: 0 };
  const chapters: any[] = [];
  const jobs: { task: () => unknown; resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = [];
  const queue = {
    enqueue(task: () => unknown) {
      return new Promise((resolve, reject) => { jobs.push({ task, resolve, reject }); });
    },
  };
  function chapter(section: { index: number; spec: ChapterSpec }) {
    const spec = section.spec;
    const view = Object.create(IframeView.prototype);
    const frameStyle = new Proxy({ visibility: 'hidden', transform: '' }, {
      set(target, key, value) {
        if (key === 'transform') counters.transforms++;
        return Reflect.set(target, key, value);
      },
    });
    const frame = {
      style: frameStyle,
      get offsetWidth() { counters.forcedLayouts++; return 800; },
      contentDocument: { body: {}, defaultView: {} },
    };
    const element = {
      style: { visibility: 'hidden', height: `${spec.height ?? 4000}px`, width: '800px' },
      removeChild() {},
      getBoundingClientRect: () => {
        const height = parseFloat(element.style.height);
        return { top: spec.top, bottom: spec.top + height, height, width: 800, left: 0, right: 800 };
      },
    };
    Object.assign(view, {
      element, iframe: spec.loaded === false ? undefined : frame,
      section, index: section.index, displayed: spec.loaded !== false,
      highlights: {}, underlines: {}, marks: {},
      contents: spec.loaded === false ? undefined : { document: frame.contentDocument, destroy() { counters.destroyed++; } },
      position: element.getBoundingClientRect,
      display() {
        counters.loaded++;
        view.iframe = frame;
        view.contents = { document: frame.contentDocument, destroy() { counters.destroyed++; } };
        view.displayed = true;
        return Promise.resolve(view);
      },
      // Browser onLoad constructs Contents from its document. This boundary
      // double retains the synchronous assignment and promise resolution so
      // prepare-before-layout ordering can be verified without a browser DOM.
      onLoad(_event: unknown, completion: { resolve: (value: unknown) => void }) {
        view.document = frame.contentDocument;
        completion.resolve(view.document);
      },
    });
    return view;
  }
  function View(this: unknown, section: { index: number; spec: ChapterSpec }) { return chapter(section); }
  const manager = new ContinuousManager({ view: View, settings: { fullsize, axis: 'vertical', direction: 'ltr' }, request() {}, queue });
  Object.assign(manager, {
    container: scroller, q: queue,
    bounds: () => ({ top: 0, bottom: 1000, left: 0, right: 800, width: 800, height: 1000 }),
    views: { all: () => chapters, displayed: () => chapters.filter(view => view.displayed) },
    check() { counters.check++; return Promise.resolve(false); },
  });
  manager.addScrollListeners();
  t.after(() => {
    manager._scrolled?.cancel?.();
    manager.removeEventListeners();
    clearTimeout(manager.scrollTimeout);
    clearTimeout(manager.afterScrolled);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousRaf) Object.defineProperty(globalThis, 'requestAnimationFrame', previousRaf);
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  });
  function add(spec: ChapterSpec) {
    const view = manager.createView({ index: chapters.length, spec });
    chapters.push(view);
    return view;
  }
  async function drain() {
    while (jobs.length) {
      const job = jobs.shift()!;
      try { job.resolve(await job.task()); }
      catch (error) { job.reject(error); throw error; }
      await Promise.resolve();
    }
  }
  function scroll(y: number) {
    scroller.scrollY = y; scroller.scrollTop = y;
    scroller.dispatchEvent(new Event('scroll'));
  }
  return { manager, add, chapters, counters, jobs, drain, scroll, scroller };
}

test('visible chapters do not repeat EPUB.js Safari transforms or forced layout during updates', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  const view = f.add({ top: 0 });
  let shown = 0;
  view.on('shown', () => shown++);
  for (let i = 0; i < 30; i++) await f.manager.update();
  assert.equal(view.element.style.visibility, 'visible');
  assert.equal(view.iframe.style.visibility, 'visible');
  assert.equal(f.counters.transforms, 0);
  assert.equal(f.counters.forcedLayouts, 0);
  assert.equal(shown, 1, 'already visible chapters must not emit shown on every scroll');
  view.hide();
  view.show();
  assert.equal(shown, 2, 'a genuine hidden-to-visible transition still emits shown');
});

test('a visible previously prepended chapter resizing cannot scroll past the current paragraph', t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  f.manager.views.prepend = (view: unknown) => f.chapters.unshift(view);
  // Use native prepend so its permanent resized -> counter listener is present.
  const view = f.manager.prepend({ index: 0, spec: { top: -500, height: 4000 } });
  f.scroll(15000);
  view.prevBounds = { width: 800, height: 4000 };
  view.reframe(800, 6000);
  assert.equal(view.element.style.height, '6000px');
  assert.equal(f.scroller.scrollY, 15000, 'an image below the visible paragraph must not force scrollBy by its height');
});

test('above-screen height changes wait for momentum and compensate only the final measured delta', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  f.manager.views.prepend = (view: unknown) => f.chapters.unshift(view);
  const view = f.manager.prepend({ index: 0, spec: { top: -6000, height: 4000 } });
  // An unloaded/reloaded frame can report its full size as heightDelta.
  view.prevBounds = undefined;
  f.scroll(15000);
  view.reframe(800, 4700);
  assert.equal(view.element.style.height, '4000px');
  assert.equal(f.scroller.scrollY, 15000);
  t.mock.timers.tick(500);
  f.scroll(15500);
  view.reframe(800, 4800);
  t.mock.timers.tick(500);
  assert.equal(view.element.style.height, '4000px', 'later scroll events extend the idle deadline');
  t.mock.timers.tick(150);
  await f.drain();
  assert.equal(view.element.style.height, '4800px');
  assert.equal(f.scroller.scrollY, 16300, 'preserve the anchor with 800px, not the entire 4800px reloaded height');
});

test('reloading an unchanged above-screen placeholder produces no compensation jump', t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  f.manager.views.prepend = (view: unknown) => f.chapters.unshift(view);
  const view = f.manager.prepend({ index: 0, spec: { top: -6000, height: 4000 } });
  view.prevBounds = undefined;
  f.scroll(15000);
  view.reframe(800, 4000);
  assert.equal(f.scroller.scrollY, 15000, 'existing container height is the baseline after iframe reload');
});

test('idle prefix insertion preserves the visible anchor exactly once', t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  f.manager.views.prepend = (view: unknown) => f.chapters.unshift(view);
  const view = f.manager.prepend({ index: 0, spec: { top: 0, height: 0 } });
  view.reframe(800, 1200);
  assert.equal(f.scroller.scrollY, 1200, 'native prepend counter must not double-compensate the measured insertion');
});

test('progress reads do not reformat loaded chapters or trigger chapter resize compensation', t => {
  const f = fixture(t);
  let layouts = 0;
  f.manager.updateLayout = () => { layouts++; };
  const position = [{ index: 2, pages: [4] }];
  f.manager.scrolledLocation = () => position;
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  for (let i = 0; i < 20; i++) assert.equal(f.manager.currentLocation(), position);
  assert.equal(layouts, 0, 'autosave position measurement is a read, not a layout change');
});

test('cleanup discards deferred height changes so an old reader cannot move the new reader', t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  const view = f.add({ top: -6000, height: 4000 });
  f.scroll(15000);
  view.reframe(800, 6000);
  cleanup();
  t.mock.timers.tick(2000);
  assert.equal(f.scroller.scrollY, 15000);
  assert.equal(view.element.style.height, '4000px');
});

test('idle unloading retains chapter heights and skips unloaded placeholders', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  const far = f.add({ top: -30000, height: 6000 });
  const placeholder = f.add({ top: -20000, loaded: false });
  let placeholderDestroy = 0;
  placeholder.destroy = () => { placeholderDestroy++; };
  f.add({ top: 0 });
  await f.manager.update();
  assert.equal(far.displayed, true, 'unloading must wait until native scrolling is idle');
  t.mock.timers.tick(2000);
  await f.drain();
  assert.equal(f.counters.destroyed, 1);
  assert.equal(far.iframe, undefined);
  assert.equal(far.element.style.height, '6000px');
  assert.equal(placeholderDestroy, 0, 'unloaded history must not create no-op destroy jobs');
  assert.equal(f.chapters.length, 3);
});

test('a chapter that comes back into view before idle unloading is retained', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  const spec = { top: -30000, height: 6000 };
  const returning = f.add(spec);
  f.add({ top: 0 });
  await f.manager.update();
  spec.top = 100;
  t.mock.timers.tick(2000);
  await f.drain();
  assert.equal(returning.displayed, true);
  assert.ok(returning.iframe);
  assert.equal(f.counters.destroyed, 0, 'unload decisions must use current geometry');
});

test('native momentum postpones destruction until the final scroll has been idle', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  const far = f.add({ top: -30000 });
  f.add({ top: 0 });
  await f.manager.update();
  for (let i = 0; i < 100; i++) {
    f.scroll(i * 20); t.mock.timers.tick(16); await f.drain();
  }
  assert.equal(f.counters.destroyed, 0, 'iframes must stay attached throughout active momentum');
  t.mock.timers.tick(500);
  assert.equal(f.counters.destroyed, 0);
  t.mock.timers.tick(150);
  assert.equal(f.counters.destroyed, 1);
  assert.equal(far.iframe, undefined);
});

test('overlapping preload updates render an unloaded chapter only once', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  const view = f.add({ top: 0, loaded: false });
  let complete!: () => void;
  const loaded = new Promise<void>(resolve => { complete = resolve; });
  let loads = 0;
  view.display = () => {
    loads++;
    return loaded.then(() => {
      view.displayed = true;
      view.iframe = { style: { visibility: 'hidden' } };
    });
  };
  const first = f.manager.update();
  const second = f.manager.update();
  assert.equal(loads, 1, 'the same iframe must not be recreated by overlapping checks');
  complete();
  await Promise.all([first, second]);
  assert.equal(view.iframe.style.visibility, 'visible');
});

test('sustained native scrolling loads ahead before momentum stops, with coalesced queue work', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  f.add({ top: 0 });
  for (let i = 0; i < 30; i++) {
    f.scroll(i * 40);
    t.mock.timers.tick(16);
    assert.ok(f.jobs.length <= 2, 'scroll events must not build an unbounded preload queue');
    await f.drain();
  }
  assert.ok(f.counters.check >= 3, 'preloading must run during a continuous stream of scroll events');
  assert.ok(f.counters.check <= 12, 'preload checks should be bounded rather than run every event');
});

test('chapter preloading stays responsive while expensive location reports are throttled', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  f.add({ top: 0 });
  const reports: { top: number; left: number }[] = [];
  f.manager.on('scrolled', (position: { top: number; left: number }) => reports.push(position));
  for (let i = 0; i < 30; i++) {
    f.scroll(i * 40); t.mock.timers.tick(16); await f.drain();
  }
  assert.ok(f.counters.check >= 3);
  assert.ok(reports.length >= 1 && reports.length < f.counters.check,
    'CFI reporting must run less often than loading checks during momentum');
  const duringMotion = reports.length;
  t.mock.timers.tick(120);
  await f.drain();
  assert.ok(reports.length > duringMotion, 'the final position must still be reported after scrolling stops');
  assert.deepEqual(reports.at(-1), { top: 1160, left: 0 });
});

test('the final reading position waits for a busy chapter check and uses the latest scroll offset', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  f.add({ top: 0 });
  const reports: { top: number; left: number }[] = [];
  f.manager.on('scrolled', (position: { top: number; left: number }) => reports.push(position));
  let complete!: () => void;
  const loading = new Promise<void>(resolve => { complete = resolve; });
  f.manager.check = () => { f.counters.check++; return loading; };
  f.scroll(200); t.mock.timers.tick(80);
  const draining = f.drain();
  await Promise.resolve();
  f.scroll(600); t.mock.timers.tick(16);
  f.scroll(900); t.mock.timers.tick(150);
  assert.equal(reports.length, 0, 'a pending load must finish before the final location is measured');
  complete();
  await draining;
  assert.deepEqual(reports.at(-1), { top: 900, left: 0 });
});

test('cleanup cancels queued loading and idle unloading', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  const far = f.add({ top: -30000 });
  f.add({ top: 0 });
  const reports: unknown[] = [];
  f.manager.on('scrolled', (position: unknown) => reports.push(position));
  await f.manager.update();
  f.scroll(100);
  t.mock.timers.tick(150);
  cleanup();
  const checksBeforeCleanup = f.counters.check;
  t.mock.timers.tick(3000);
  await f.drain();
  assert.equal(f.counters.check, checksBeforeCleanup);
  assert.equal(far.displayed, true);
  assert.equal(f.counters.destroyed, 0);
  assert.equal(reports.length, 0, 'disposed readers must not emit delayed location reports');
});

test('slow chapter checks cannot accumulate a queue of stale preload requests', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  f.add({ top: 0 });
  // Leave the initial check queued while scroll events continue arriving.
  for (let i = 0; i < 100; i++) {
    f.scroll(i * 20); t.mock.timers.tick(16);
  }
  assert.equal(f.jobs.length, 1, 'a busy manager must retain one coalesced request');
  assert.equal(f.counters.check, 0);
  await f.drain();
  t.mock.timers.tick(100);
  await f.drain();
  assert.ok(f.counters.check <= 2, 'only the latest follow-up check should run');
});

test('appearance is prepared before the resolved iframe load starts its layout continuation', async t => {
  const f = fixture(t);
  const events: string[] = [];
  const cleanup = stabilizeContinuousScroll(f.manager, 1000, document => {
    assert.ok(document.body);
    events.push('appearance');
  });
  t.after(cleanup);
  const view = f.add({ top: 0 });
  const loaded = new Promise(resolve => view.onLoad({}, { resolve }));
  await loaded.then(() => { events.push('layout'); });
  assert.deepEqual(events, ['appearance', 'layout']);
});

test('the same smooth scrolling safeguards work in a desktop scroll container', async t => {
  const f = fixture(t, false);
  const cleanup = stabilizeContinuousScroll(f.manager, 800);
  t.after(cleanup);
  const view = f.add({ top: 0 });
  await f.manager.update();
  await f.manager.update();
  assert.equal(f.counters.transforms, 0);
  assert.equal(f.counters.forcedLayouts, 0);
  assert.equal(view.iframe.style.visibility, 'visible');
  for (let i = 0; i < 15; i++) {
    f.scroll(i * 30); t.mock.timers.tick(16); await f.drain();
  }
  assert.ok(f.counters.check > 0);
});

test('native chapter checks defer new prepends during momentum, preserve append, and restore previous lookup', async t => {
  const f = fixture(t);
  // Use the installed native check, including its recursive fill decision.
  f.manager.check = ContinuousManager.prototype.check;
  f.manager._bounds = f.manager.bounds();
  f.manager.views.first = () => f.chapters[0];
  f.manager.views.last = () => f.chapters.at(-1);
  let contentHeight = 100000;
  Object.defineProperty(f.scroller, 'scrollHeight', { configurable: true, get: () => contentHeight });
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  const current = f.add({ top: 0 });
  const previous = { index: -1, spec: { top: -4000 }, prev: () => undefined };
  const next = { index: 1, spec: { top: 4000 }, next: () => undefined };
  const previousLookup = () => previous;
  current.section.prev = previousLookup;
  current.section.next = () => next;
  let prepends = 0; let appends = 0;
  f.manager.prepend = (section: unknown) => {
    prepends++;
    const view = f.manager.createView(section);
    f.chapters.unshift(view);
    return view;
  };
  f.manager.append = (section: unknown) => {
    appends++;
    contentHeight = 100000;
    const view = f.manager.createView(section);
    f.chapters.push(view);
    return view;
  };
  f.scroll(1);
  await f.manager.check();
  await f.drain();
  assert.equal(prepends, 0, 'a new prefix would force scrollBy during momentum');
  assert.equal(current.section.prev, previousLookup, 'the temporary lookup mask must be restored synchronously');
  contentHeight = 3000;
  await f.manager.check();
  await f.drain();
  assert.equal(appends, 1, 'forward chapter loading must continue during momentum');
  assert.equal(prepends, 0);
  assert.equal(current.section.prev, previousLookup);
  t.mock.timers.tick(650);
  await f.manager.check();
  await f.drain();
  assert.equal(prepends, 1, 'an idle check can prepare the missing previous chapter');
  assert.equal(current.section.prev, previousLookup);
});

test('idle prefix warming runs once after scrolling and cleanup cancels a pending warm check', async t => {
  const f = fixture(t);
  const cleanup = stabilizeContinuousScroll(f.manager, 1000);
  t.after(cleanup);
  f.add({ top: 0 });
  f.scroll(100); t.mock.timers.tick(80); await f.drain();
  assert.equal(f.counters.check, 1);
  t.mock.timers.tick(600); t.mock.timers.tick(80); await f.drain();
  assert.equal(f.counters.check, 2, 'one idle check should warm the prefix after momentum');
  t.mock.timers.tick(3000); await f.drain();
  assert.equal(f.counters.check, 2, 'warming must not become a repeated idle poll');
  f.scroll(200); t.mock.timers.tick(80); await f.drain();
  const checksBeforeCleanup = f.counters.check;
  t.mock.timers.tick(600);
  cleanup();
  t.mock.timers.tick(2000); await f.drain();
  assert.equal(f.counters.check, checksBeforeCleanup, 'the scheduled warm task must not run after disposal');
});
