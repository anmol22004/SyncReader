import type { Rendition } from 'epubjs';
import { anchorFingerprint, type ReaderTrace } from './reader-trace';

type View = { element: HTMLElement; iframe?: HTMLIFrameElement; section: { index: number }; displayed: boolean };
type Manager = { views?: { all(): View[] }; container?: HTMLElement; settings: { fullsize?: boolean } };

/** Attach only for ?readerDebug=1. Observe existing calls; never navigate or reflow. */
export function attachEpubDiagnostics(rendition: Rendition, trace: ReaderTrace) {
  const manager = (rendition as unknown as { manager: Manager }).manager;
  const restores: (() => void)[] = [];
  const abort = new AbortController();
  const signal = abort.signal;
  let disposed = false;
  let lastSample = -Infinity;

  function wrap(target: object, key: string, before: (args: unknown[]) => void, after?: (result: unknown) => void, retain = true) {
    const original = Reflect.get(target, key);
    if (typeof original !== 'function') return;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      if (!disposed && trace.recording) { try { before(args); } catch { /* Diagnostics must not break reading. */ } }
      const result = Reflect.apply(original, this, args);
      if (!disposed) { try { after?.(result); } catch { /* Preserve the original return value. */ } }
      return result;
    };
    Reflect.set(target, key, wrapped);
    if (retain) restores.push(() => { if (Reflect.get(target, key) === wrapped) Reflect.set(target, key, original); });
  }

  function sample(event = 'sample', force = false) {
    if (disposed || !trace.recording || !force && performance.now() - lastSample < 100) return;
    lastSample = performance.now();
    const views = manager.views?.all() || [];
    const top = manager.settings.fullsize ? 0 : manager.container?.getBoundingClientRect().top || 0;
    const first = views.find(view => view.element.getBoundingClientRect().bottom > top);
    const rect = first?.element.getBoundingClientRect();
    const viewport = window.visualViewport;
    trace.record(event, {
      windowY: window.scrollY, containerY: manager.container?.scrollTop, innerHeight: window.innerHeight,
      width: window.innerWidth, visualHeight: viewport?.height, visualTop: viewport?.offsetTop, scale: viewport?.scale,
      firstChapter: first?.section.index, firstTop: rect?.top, firstHeight: rect?.height,
      views: views.length, frames: views.filter(view => view.iframe).length,
    });
  }
  const coordinates = (args: unknown[]) => {
    const options = args[0] as ScrollToOptions | undefined;
    return typeof options === 'object' && options !== null ? { x: options.left, y: options.top } : { x: args[0], y: args[1] };
  };
  wrap(rendition, 'display', args => trace.record('display', { anchor: anchorFingerprint(args[0]) }));
  wrap(rendition, 'resize', args => trace.record('resize', { width: args[0], height: args[1], anchor: anchorFingerprint(args[2]) }));
  wrap(manager, 'clear', () => trace.record('clear'));
  for (const [method, key] of ['scrollTo', 'scrollBy'].entries()) {
    wrap(manager, key, args => trace.record('manager-scroll', { ...coordinates(args), method, silent: args[2] }));
    wrap(window, key, args => trace.record('window-scroll', { ...coordinates(args), method }));
  }
  wrap(manager, 'createView', () => {}, result => {
    const view = result as View;
    trace.record('view-create', { chapter: view.section.index });
    // Don't retain every unloaded iframe just to restore its wrappers at close.
    wrap(view, 'display', () => { if (!view.displayed) trace.record('view-load', { chapter: view.section.index }); }, undefined, false);
    wrap(view, 'destroy', () => { if (view.displayed) trace.record('view-destroy', { chapter: view.section.index }); }, undefined, false);
    wrap(view, 'reframe', args => {
      const rect = view.element.getBoundingClientRect();
      trace.record('view-resize', { chapter: view.section.index, width: args[0], height: args[1], beforeHeight: rect.height, top: rect.top, bottom: rect.bottom });
    }, () => {
      if (!trace.recording) return;
      const rect = view.element.getBoundingClientRect();
      trace.record('view-resized', { chapter: view.section.index, height: rect.height, top: rect.top });
    }, false);
  });

  const relocated = (raw: { start?: { index: number; cfi: string; percentage?: number } }) => {
    trace.record('relocated', { chapter: raw.start?.index, anchor: anchorFingerprint(raw.start?.cfi), progress: raw.start?.percentage });
  };
  rendition.on('relocated', relocated);
  restores.push(() => rendition.off('relocated', relocated));
  const content = ({ document: doc, sectionIndex }: { document: Document; sectionIndex: number }) => {
    let lastY: number | null = null;
    let lastMove = 0;
    // These listeners live on the iframe document and are collected with it.
    doc.addEventListener('touchstart', event => {
      lastY = event.touches[0]?.clientY ?? null;
      trace.record('touch-start', { chapter: sectionIndex, y: lastY, touches: event.touches.length });
    }, { passive: true });
    doc.addEventListener('touchmove', event => {
      const y = event.touches[0]?.clientY ?? null;
      if (performance.now() - lastMove >= 100) {
        trace.record('touch-move', { chapter: sectionIndex, y, dy: lastY !== null && y !== null ? lastY - y : 0, touches: event.touches.length });
        lastMove = performance.now(); lastY = y;
      }
    }, { passive: true });
    doc.addEventListener('touchend', () => { trace.record('touch-end', { chapter: sectionIndex }); lastY = null; }, { passive: true });
    doc.defaultView?.addEventListener('scroll', () => {
      trace.record('frame-scroll', { chapter: sectionIndex, frameY: doc.defaultView?.scrollY, documentHeight: doc.documentElement.scrollHeight });
    }, { passive: true });
    doc.addEventListener('selectionchange', () => {
      const selection = doc.getSelection();
      trace.record('selection', { chapter: sectionIndex, ranges: selection?.rangeCount, collapsed: selection?.isCollapsed });
    });
  };
  rendition.hooks.content.register(content);
  restores.push(() => rendition.hooks.content.deregister(content));
  window.addEventListener('scroll', () => sample(), { capture: true, passive: true, signal });
  window.addEventListener('resize', () => sample('viewport', true), { passive: true, signal });
  window.visualViewport?.addEventListener('resize', () => sample('viewport', true), { passive: true, signal });
  window.visualViewport?.addEventListener('scroll', () => sample('viewport'), { passive: true, signal });
  window.addEventListener('error', event => trace.record('error', { line: event.lineno, column: event.colno }), { signal });
  window.addEventListener('unhandledrejection', () => trace.record('error'), { signal });
  document.addEventListener('visibilitychange', () => trace.record('visibility', { visible: document.visibilityState === 'visible' }), { signal });
  trace.record('start', { documentScroll: manager.settings.fullsize });
  return () => { trace.record('close'); disposed = true; abort.abort(); restores.reverse().forEach(restore => restore()); trace.capture(); };
}
