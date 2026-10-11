'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Book as EpubBook, Rendition } from 'epubjs';
import type { Anchor, Annotation, Location, Preferences, SearchResult } from '@/lib/types';
import { epubProgress } from '@/lib/locations';
import type { ReaderHandle, Selection, TocItem } from './reader-engine';
type EpubLocation = { start: { cfi: string; href: string; index: number; percentage?: number; displayed?: { page: number; total: number } } };
// EPUB.js supports a resize anchor at runtime, but omits it from its declarations.
type AnchoredRendition = Rendition & { resize(width: number, height: number, cfi?: string): void };
type RuntimeSection = { load: (loader: EpubBook['load']) => Promise<unknown> | Document; find: (q: string) => { cfi: string; excerpt: string }[]; href: string; index: number };
type Props = { bytes: ArrayBuffer; initial: Location | null; preferences: Preferences; annotations: Annotation[]; onLocation: (l: Location) => void; onProgress: (l: Location) => void; onReady: (l: Location, toc: TocItem[]) => void; onSelection: (s: Selection | null) => void; onError: (e: string) => void };
const EpubReader = forwardRef<ReaderHandle, Props>(function EpubReader(props, ref) {
  const host = useRef<HTMLDivElement>(null); const book = useRef<EpubBook | null>(null); const rendition = useRef<Rendition | null>(null);
  const latest = useRef(props); latest.current = props;
  const armed = useRef(false); const current = useRef<Location | null>(null); const suppressed = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const typography = useRef('');
  function location(raw: EpubLocation): Location {
    const length = (book.current?.spine as unknown as { length: number })?.length || 1;
    return { version: 1, type: 'epub', cfi: raw.start.cfi, href: raw.start.href, spineIndex: raw.start.index, progression: epubProgress(raw.start, length, (book.current?.locations.length() || 0) > 1) };
  }
  function applyPreferences() {
    const r = rendition.current; if (!r) return;
    const p = latest.current.preferences;
    const colors = p.theme === 'dark' ? { color: '#dddcd4', background: '#202723' } : p.theme === 'sepia' ? { color: '#493c29', background: '#f3ead8' } : { color: '#30372f', background: '#fffef9' };
    r.themes.default({ body: { ...colors, 'font-family': `${p.font} !important`, 'line-height': `${p.lineHeight} !important`, padding: '16px clamp(16px, 4vw, 40px) !important', margin: '0 auto !important', 'max-width': '860px !important', 'box-sizing': 'border-box !important', 'overflow-wrap': 'anywhere', 'overflow-anchor': 'none' }, 'a': { color: '#65876c' }, 'img,svg,video': { 'max-width': '100% !important', height: 'auto !important' }, 'pre': { 'white-space': 'pre-wrap !important' }, 'table': { 'max-width': '100% !important' }, 'h1,h2,h3': { 'line-height': '1.3 !important' } });
    r.themes.fontSize(`${p.fontSize}px`);
  }
  useEffect(() => {
    const resume = current.current || props.initial;
    armed.current = false; setLoaded(false);
    const inputAbort = new AbortController();
    let disposed = false; let resize: ResizeObserver | null = null; let resizeTimer: ReturnType<typeof setTimeout> | undefined; let settleTimer: ReturnType<typeof setTimeout> | undefined; let ownedBook: EpubBook | null = null; let indexBook: EpubBook | null = null;
    (async () => {
      try {
        const { default: ePub } = await import('epubjs'); if (disposed || !host.current) return;
        const b = ePub(props.bytes.slice(0)); book.current = b; ownedBook = b;
        await b.ready; if (disposed) { b.destroy(); return; }
        const bounds = host.current.getBoundingClientRect();
        let width = Math.round(bounds.width); let height = Math.round(bounds.height);
        const r = b.renderTo(host.current, { width, height, manager: 'continuous', flow: 'scrolled-continuous', spread: 'none', snap: false, resizeOnOrientationChange: false, allowScriptedContent: false }); rendition.current = r;
        r.hooks.content.register((contents: { document: Document }) => {
          const arm = () => { armed.current = true; };
          contents.document.addEventListener('wheel', arm, { passive: true });
          contents.document.addEventListener('touchstart', arm, { passive: true });
          contents.document.addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' '].includes(event.key)) arm(); });
          contents.document.addEventListener('click', event => {
            const element = event.target as Element | null; const link = element?.closest('a'); const href = link?.getAttribute('href');
            if (href && /^https?:/i.test(href)) { event.preventDefault(); event.stopPropagation(); window.open(href, '_blank', 'noopener,noreferrer'); }
          }, true);

        });
        r.on('relocated', (raw: EpubLocation) => {
          if (disposed || suppressed.current) return;
          const l = location(raw); current.current = l;
          if (armed.current && !suppressed.current) latest.current.onLocation(l);
        });
        r.on('selected', async (cfi: string) => {
          try { const range = await b.getRange(cfi); const quote = range.toString().trim(); if (quote && !disposed) latest.current.onSelection({ anchor: { type: 'epub', cfi }, quote: quote.slice(0, 20000) }); } catch { /* Selection can disappear during navigation. */ }
        });
        applyPreferences();
        typography.current = JSON.stringify([latest.current.preferences.font, latest.current.preferences.fontSize, latest.current.preferences.lineHeight]);
        try { await r.display(resume?.type === 'epub' ? resume.cfi : undefined); }
        catch (e) {
          if (resume?.type !== 'epub' || !resume.href) throw e;
          await r.display(resume.href);
          latest.current.onError('The exact position could not be restored. Opened the saved chapter instead.');
        }
        if (disposed) return;
        await r.reportLocation();
        const raw = (await r.currentLocation()) as unknown as EpubLocation;
        current.current = location(raw);
        const navigation = await b.loaded.navigation; if (disposed) return;
        const toc: TocItem[] = [];
        type NavItem = { label: string; href: string; subitems?: NavItem[] };
        const flatten = (items: NavItem[], depth = 0) => { for (const i of items) { toc.push({ label: i.label.trim(), href: i.href, depth }); if (i.subitems) flatten(i.subitems, depth + 1); } };
        flatten(navigation.toc);
        if (!toc.length) b.spine.each((section: RuntimeSection) => { toc.push({ label: `Chapter ${section.index + 1}`, href: section.href, depth: 0 }); });
        latest.current.onReady(current.current, toc);
        setLoaded(true);
        const armScroll = () => { armed.current = true; };
        host.current?.addEventListener('wheel', armScroll, { passive: true, signal: inputAbort.signal });
        host.current?.addEventListener('touchstart', armScroll, { passive: true, signal: inputAbort.signal });
        host.current?.addEventListener('pointerdown', armScroll, { signal: inputAbort.signal });
        // Index a separate book: Locations.generate unloads sections, so it must
        // never run on the instance that owns the visible chapters.
        void (async () => {
          const indexing = ePub(props.bytes.slice(0)); indexBook = indexing;
          try {
            await indexing.ready;
            if (disposed) return;
            await indexing.locations.generate(1200);
            if (disposed) return;
            b.locations.load(indexing.locations.save());
            // Recalculate the visible percentage without navigating or reflowing.
            await r.reportLocation();
            if (disposed) return;
            const raw = r.currentLocation() as unknown as EpubLocation;
            if (!suppressed.current && raw?.start) {
              const l = location(raw); current.current = l;
              latest.current.onProgress(l);
            }
          } catch { /* Chapter-based progress remains available if indexing fails. */ }
          finally { if (indexBook === indexing) { indexBook = null; indexing.destroy(); } }
        })();
        // One resize owner: EPUB.js already restores the supplied CFI after resizing.
        // Size changes must not trigger a second, competing display call.
        const updateSize = () => {
            if (disposed || !host.current) return;
            const bounds = host.current.getBoundingClientRect();
            const nextWidth = Math.round(bounds.width); const nextHeight = Math.round(bounds.height);
            if (nextWidth <= 0 || nextHeight <= 0 || (nextWidth === width && nextHeight === height)) return;
            if (suppressed.current) { resizeTimer = setTimeout(updateSize, 150); return; }
            width = nextWidth; height = nextHeight;
            const cfi = current.current?.type === 'epub' ? current.current.cfi : undefined;
            suppressed.current = true;
            (r as AnchoredRendition).resize(width, height, cfi);
            clearTimeout(settleTimer);
            settleTimer = setTimeout(() => { if (!disposed) suppressed.current = false; }, 600);
        };
        resize = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(updateSize, 180); });
        resize.observe(host.current!);
      } catch(e) { if (!disposed) latest.current.onError(e instanceof Error ? e.message : 'This EPUB could not be opened.'); }
    })();
    return () => { disposed = true; inputAbort.abort(); resize?.disconnect(); clearTimeout(resizeTimer); clearTimeout(settleTimer); indexBook?.destroy(); indexBook = null; ownedBook?.destroy(); if (book.current === ownedBook) { rendition.current = null; book.current = null; suppressed.current = false; } };
  }, [props.bytes]);
  useEffect(() => {
    if (!loaded) return;
    const key = JSON.stringify([props.preferences.font, props.preferences.fontSize, props.preferences.lineHeight]);
    if (key === typography.current) return;
    const r = rendition.current; if (!r) return;
    const cfi = current.current?.type === 'epub' ? current.current.cfi : undefined;
    // Coalesce slider changes and preserve the anchor through text reflow.
    suppressed.current = true;
    let disposed = false;
    const timer = setTimeout(() => {
      if (disposed) return;
      applyPreferences(); typography.current = key;
      void r.display(cfi).then(() => { if (!disposed) suppressed.current = false; }).catch(() => { if (!disposed) suppressed.current = false; });
    }, 180);
    return () => { disposed = true; clearTimeout(timer); suppressed.current = false; };
  }, [loaded, props.preferences.font, props.preferences.fontSize, props.preferences.lineHeight]);
  useEffect(() => { if (loaded) applyPreferences(); }, [loaded, props.preferences.theme]);
  useEffect(() => {
    const r = rendition.current; if (!r) return;
    const added: string[] = [];
    for (const a of props.annotations) if (a.kind === 'highlight' && a.anchor.type === 'epub') {
      try { r.annotations.highlight(a.anchor.cfi, {}, undefined, 'folio-highlight', { fill: '#d4b75d', 'fill-opacity': '0.35', 'mix-blend-mode': 'multiply' }); added.push(a.anchor.cfi); } catch { /* Keep the saved quote if an anchor cannot render. */ }
    }
    return () => { for (const cfi of added) { try { r.annotations.remove(cfi, 'highlight'); } catch {} } };
  }, [props.annotations, loaded]);
  useImperativeHandle(ref, () => ({
    next() {},
    previous() {},
    async restore(l) { if (l.type !== 'epub' || !rendition.current) return; suppressed.current = true; try { await rendition.current.display(l.cfi); current.current = l; } finally { suppressed.current = false; } },
    async jump(a: Anchor) { if (a.type === 'epub') { armed.current = true; await rendition.current?.display(a.cfi); } },
    async goTo(t) { if (t.href) { armed.current = true; await rendition.current?.display(t.href); } },
    async search(query) {
      const b = book.current; if (!b || !query.trim()) return [];
      const sections: RuntimeSection[] = [];
      b.spine.each((s: RuntimeSection) => sections.push(s));
      const results: SearchResult[] = [];
      for (const section of sections) {
        await section.load(b.load.bind(b));
        const matches = section.find(query);
        for (const match of matches) results.push({ label: `Chapter ${section.index + 1}`, excerpt: match.excerpt, location: { version: 1, type: 'epub', cfi: match.cfi, href: section.href, spineIndex: section.index, progression: section.index / sections.length } });
        // Keep loaded sections: unloading would race with the continuous reader.
        if (results.length >= 100) break;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return results.slice(0, 100);
    }
  }));
  return <div className="epub-host" ref={host} />;
});
export default EpubReader;
