/** Runtime EPUB.js interfaces absent from its public declarations. */
export type ScrollView = {
  element: HTMLElement;
  iframe?: HTMLIFrameElement;
  document?: Document;
  section?: { prev(): unknown };
  displayed: boolean;
  display(request: unknown): Promise<unknown>;
  destroy(): void;
  show(): void;
  hide(): void;
  emit(event: string, view?: ScrollView): void;
  onLoad(...args: unknown[]): unknown;
  reframe(width?: number, height?: number): void;
};

export type ContinuousScrollManager = {
  settings: { offset?: number; fullsize?: boolean; axis?: string };
  views?: { all(): ScrollView[] };
  request: unknown;
  scrollTop: number;
  scrollLeft: number;
  createView(...args: unknown[]): ScrollView;
  bounds(): DOMRect;
  isVisible(view: ScrollView, before: number, after: number, bounds: DOMRect): boolean;
  update(offset?: number): Promise<unknown>;
  trim(): unknown;
  check(before?: number, after?: number): Promise<unknown>;
  q: { enqueue(task: () => Promise<unknown>): Promise<unknown> };
  addScrollListeners(): void;
  counter(bounds: { widthDelta: number; heightDelta: number }): void;
  scrollBy(x: number, y: number, silent?: boolean): void;
  currentLocation(): unknown;
  scrolledLocation(): unknown;
  _scrolled?: (() => void) & { cancel?: () => void };
  emit(event: string, position: { top: number; left: number }): void;
};

const installed = new WeakMap<ContinuousScrollManager, () => void>();
const keepChapterPlaceholders = () => Promise.resolve();

/**
 * EPUB.js's stock continuous manager repeatedly forces a Safari iframe redraw,
 * waits for scrolling to stop before preloading, and queues stale iframe removals.
 * Adapt this owned manager only; keep native scrolling and CFI navigation intact.
 * Install after rendition.started and before the first display. Calling again
 * updates the preload distance after a real viewport resize.
 */
export function stabilizeContinuousScroll(
  manager: ContinuousScrollManager,
  viewportHeight: number,
  prepareDocument?: (document: Document) => void,
): () => void {
  manager.settings.offset = Math.max(500, Number.isFinite(viewportHeight) && viewportHeight > 0 ? Math.ceil(viewportHeight * 3) : 500);
  const existing = installed.get(manager);
  if (existing) return existing;

  let disposed = false;
  let lastScroll = 0;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let unloadTimer: ReturnType<typeof setTimeout> | undefined;
  let reportTimer: ReturnType<typeof setTimeout> | undefined;
  let lastReported = 0;
  let reportAfterCheck = false;
  let checking = false;
  let checkAgain = false;
  let warmAfterScroll = false;
  const loading = new WeakMap<ScrollView, Promise<unknown>>();
  const pendingReframes = new Map<ScrollView, { width?: number; height?: number }>();
  const createView = manager.createView;
  const addScrollListeners = manager.addScrollListeners;
  const check = manager.check;
  const counter = manager.counter;
  const currentLocation = manager.currentLocation;

  // Stock prepend keeps an unconditional resize -> scrollBy listener forever.
  // It also runs when that chapter is visible or reloaded from a placeholder.
  // Vertical compensation belongs to the measured reframe below, not to the
  // reported heightDelta (which can include the entire reloaded chapter).
  manager.counter = function (bounds) {
    if (this.settings.axis !== 'vertical') counter.call(this, bounds);
  };
  manager.currentLocation = function () {
    // A progress read must not reformat/re-expand every loaded iframe. Layout
    // already updates on explicit resize, flow, and appearance changes.
    return this.settings.axis === 'vertical' ? this.scrolledLocation() : currentLocation.call(this);
  };

  manager.check = function (before, after) {
    if (disposed) return Promise.resolve(false);
    const active = Date.now() - lastScroll < 600;
    const first = this.views?.all()[0]?.section;
    // New preceding chapters require native scrollBy compensation. Prepare a
    // generous prefix before reading/while idle, rather than interrupt momentum.
    // Existing preceding placeholders can still reload normally during scrolling.
    if (this.settings.axis === 'vertical' && active && first) {
      const previous = first.prev;
      first.prev = () => undefined;
      try { return check.call(this, before, after); }
      finally { first.prev = previous; }
    }
    const idleOffset = !active && this.settings.axis === 'vertical' ? (this.settings.offset || 500) * 4 : after;
    return check.call(this, before, idleOffset);
  };

  manager.createView = function (...args) {
    const view = createView.apply(this, args);
    const reframe = view.reframe;
    view.reframe = function (width, height) {
      if (disposed) return;
      if (manager.settings.axis !== 'vertical') { reframe.call(this, width, height); return; }
      const before = this.element.getBoundingClientRect();
      const above = before.bottom <= manager.bounds().top;
      const changesHeight = typeof height === 'number' && Number.isFinite(height) && Math.abs(height - before.height) > .5;
      if (above && changesHeight && Date.now() - lastScroll < 600) {
        // Keep the existing placeholder height during momentum. Moving the
        // document or calling scrollBy now would skip text/cancel the gesture.
        pendingReframes.set(this, { width, height });
        scheduleUnload();
        return;
      }
      pendingReframes.delete(this);
      reframe.call(this, width, height);
      if (above && changesHeight) {
        const delta = this.element.getBoundingClientRect().height - before.height;
        if (Number.isFinite(delta) && Math.abs(delta) > .5) manager.scrollBy(0, delta, true);
      }
    };
    const onLoad = view.onLoad;
    view.onLoad = function (...loadArgs) {
      const result = onLoad.apply(this, loadArgs);
      // onLoad resolves the iframe promise synchronously. Apply typography now,
      // before its next microtask measures/expands the chapter for the first time.
      if (this.document && !disposed) prepareDocument?.(this.document);
      return result;
    };
    view.show = function () {
      if (!this.iframe || disposed) return;
      if (this.element.style.visibility === 'visible' && this.iframe.style.visibility === 'visible') return;
      this.element.style.visibility = 'visible';
      this.iframe.style.visibility = 'visible';
      // The stock show toggles translateZ(0) and reads offsetWidth on every call.
      // Visibility alone reveals the loaded frame without rebuilding its layer.
      this.emit('shown', this);
    };
    return view;
  };

  function unloadDistantChapters() {
    if (disposed) return;
    const remaining = 600 - (Date.now() - lastScroll);
    if (remaining > 0) { unloadTimer = setTimeout(unloadDistantChapters, remaining); return; }
    for (const [view, size] of pendingReframes) {
      pendingReframes.delete(view);
      if (view.iframe && manager.views?.all().includes(view)) view.reframe(size.width, size.height);
    }
    if (warmAfterScroll) { warmAfterScroll = false; scheduleCheck(); }
    const bounds = manager.bounds();
    const distance = (manager.settings.offset || 500) * 2;
    for (const view of manager.views?.all() || []) {
      // Recheck current geometry at execution time. Unloaded placeholders need
      // no queued work, and nearby chapters remain ready for direction changes.
      if (view.displayed && !loading.has(view) && !manager.isVisible(view, distance, distance, bounds)) view.destroy();
    }
  }

  function scheduleUnload() {
    clearTimeout(unloadTimer);
    unloadTimer = setTimeout(unloadDistantChapters, 600);
  }

  manager.update = async function (this: ContinuousScrollManager, offset = this.settings.offset || 0) {
    if (disposed) return;
    const bounds = this.bounds();
    const pending: Promise<unknown>[] = [];
    for (const view of this.views?.all() || []) {
      if (!this.isVisible(view, offset, offset, bounds)) continue;
      if (view.displayed) { view.show(); continue; }
      let promise = loading.get(view);
      if (!promise) {
        promise = view.display(this.request).then(() => {
          if (!disposed && this.views?.all().includes(view)) view.show();
        }).catch(() => {
          if (!disposed && view.iframe) view.hide();
        }).finally(() => loading.delete(view));
        loading.set(view, promise);
      }
      pending.push(promise);
    }
    scheduleUnload();
    return Promise.all(pending);
  };
  // Removing a preceding placeholder requires scrollTo compensation, which
  // cancels iOS momentum. Retain its small height container after iframe unload.
  manager.trim = keepChapterPlaceholders;

  function reportPosition(final = false) {
    if (disposed || !final && Date.now() - lastReported < 250) return;
    lastReported = Date.now();
    manager.emit('scrolled', { top: manager.scrollTop, left: manager.scrollLeft });
  }

  function scheduleCheck() {
    if (disposed || checkTimer) return;
    checkTimer = setTimeout(() => {
      checkTimer = undefined;
      if (disposed) return;
      if (checking) { checkAgain = true; return; }
      checking = true;
      void manager.q.enqueue(async () => {
        if (disposed) return;
        await manager.check();
        if (disposed) return;
        const position = { top: manager.scrollTop, left: manager.scrollLeft };
        manager.emit('scroll', position);
        // CFI reporting reformats/measures loaded chapters in EPUB.js. Keep
        // this slower than preloading while still reporting the final position.
        reportPosition(reportAfterCheck);
        reportAfterCheck = false;
      }).catch(() => { /* A navigation can supersede a chapter preload. */ }).finally(() => {
        checking = false;
        if (checkAgain) { checkAgain = false; scheduleCheck(); }
      });
    }, 80);
  }

  function installScrollCallback() {
    manager._scrolled?.cancel?.();
    manager._scrolled = () => {
      if (disposed) return;
      lastScroll = Date.now();
      warmAfterScroll = true;
      scheduleUnload();
      clearTimeout(reportTimer);
      reportTimer = setTimeout(() => {
        if (checking) reportAfterCheck = true;
        else reportPosition(true);
      }, 120);
      // Coalesce checks, but never postpone them for every new scroll event.
      scheduleCheck();
    };
  }
  manager.addScrollListeners = function () {
    addScrollListeners.call(this);
    installScrollCallback();
  };
  // Also support a manager already attached to its scroll surface.
  if (manager._scrolled) installScrollCallback();

  const dispose = () => {
    disposed = true;
    clearTimeout(checkTimer);
    clearTimeout(unloadTimer);
    clearTimeout(reportTimer);
    pendingReframes.clear();
    manager._scrolled?.cancel?.();
    installed.delete(manager);
  };
  installed.set(manager, dispose);
  return dispose;
}
