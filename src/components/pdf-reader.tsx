'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Annotation, Location, SearchResult } from '@/lib/types';
import type { ReaderHandle, Selection, TocItem } from './reader-engine';
type Props = { bytes: ArrayBuffer; initial: Location | null; annotations: Annotation[]; zoom: number; onLocation: (l: Location) => void; onReady: (l: Location, toc: TocItem[]) => void; onSelection: (s: Selection | null) => void; onError: (e: string) => void };
const PdfReader = forwardRef<ReaderHandle, Props>(function PdfReader(props, ref) {
  const doc = useRef<PDFDocumentProxy | null>(null); const canvas = useRef<HTMLCanvasElement>(null); const textHost = useRef<HTMLDivElement>(null); const scroll = useRef<HTMLDivElement>(null); const pageHost = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(props.initial?.type === 'pdf' ? props.initial.page : 1); const [loaded, setLoaded] = useState(false); const [dimensions, setDimensions] = useState({ width: 600, height: 800 });
  const latest = useRef(props); latest.current = props; const armed = useRef(false); const initialized = useRef(false); const rendering = useRef(false);
  const pending = useRef<Location | null>(props.initial); const current = useRef<Location | null>(props.initial); const pageRef = useRef(page); pageRef.current = page;
  const scrollIntent = useRef(false); const navigationPending = useRef(false);
  const selectionAction = useRef(false); const checkSelection = useRef<() => void>(() => {});
  const viewport = useRef<ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getViewport']> | null>(null);
  const [width, setWidth] = useState(700);
  function getLocation(): Location {
    const p = viewport.current; const parent = scroll.current;
    let x = 0, y = 0;
    if (p && parent && pageHost.current) {
      const offset = Math.max(0, parent.scrollTop - pageHost.current.offsetTop);
      const point = p.convertToPdfPoint(0, Math.min(p.height, offset));
      const [x0, y0, x1, y1] = p.viewBox;
      x = Math.max(0, Math.min(1, (point[0] - x0) / (x1 - x0))); y = Math.max(0, Math.min(1, (point[1] - y0) / (y1 - y0)));
    }
    return { version: 1, type: 'pdf', page: pageRef.current, x, y, progression: (pageRef.current - 1) / (doc.current?.numPages || 1) };
  }
  function navigate(n: number, anchor?: Location) {
    if (!doc.current) return;
    latest.current.onSelection(null); armed.current = true; navigationPending.current = true;
    pending.current = anchor || { version: 1, type: 'pdf', page: n, x: 0, y: 1, progression: (n - 1) / doc.current.numPages };
    setPage(Math.max(1, Math.min(doc.current.numPages, n)));
    if (n === pageRef.current) { restoreScroll(pending.current); navigationPending.current = false; pending.current = null; }
  }
  function restoreScroll(l: Location | null) {
    if (l?.type !== 'pdf' || !viewport.current || !scroll.current) return;
    const v = viewport.current, [x0,y0,x1,y1] = v.viewBox;
    const point = v.convertToViewportPoint(x0 + l.x * (x1 - x0), y0 + l.y * (y1 - y0));
    scrollIntent.current = false;
    scroll.current.scrollTop = point[1] <= 1 ? 0 : Math.max(0, (pageHost.current?.offsetTop || 0) + point[1]);
    scroll.current.scrollLeft = Math.max(0, point[0]);
    current.current = l;
    if (navigationPending.current) latest.current.onLocation(l);
  }
  useEffect(() => {
    let disposed = false; let task: ReturnType<typeof import('pdfjs-dist').getDocument> | null = null;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist'); if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = '/reader-assets/pdf.worker.min.mjs';
        task = pdfjs.getDocument({ data: props.bytes.slice(0), cMapUrl: '/reader-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/reader-assets/standard_fonts/', wasmUrl: '/reader-assets/wasm/' });
        const pdf = await task.promise; if (disposed) { await pdf.destroy(); return; } doc.current = pdf; setLoaded(true);
      } catch(e) { if (!disposed) latest.current.onError(e instanceof Error ? e.message : 'This PDF could not be opened.'); }
    })();
    const observer = new ResizeObserver(entries => setWidth(Math.max(200, entries[0].contentRect.width - 48)));
    if (scroll.current) observer.observe(scroll.current);
    return () => { disposed = true; observer.disconnect(); void task?.destroy(); doc.current = null; };
  }, [props.bytes]);
  useEffect(() => {
    if (!loaded || !doc.current) return;
    let disposed = false; let cancelRender: (() => void) | null = null; let cancelText: (() => void) | null = null;
    rendering.current = true;
    (async () => {
      try {
        const p = await doc.current!.getPage(page); if (disposed || !canvas.current || !textHost.current) return;
        const natural = p.getViewport({ scale: 1 }); const v = p.getViewport({ scale: Math.min(width / natural.width, 1.6) * props.zoom }); viewport.current = v;
        const scale = Math.min(window.devicePixelRatio || 1, 2); const c = canvas.current;
        c.width = Math.floor(v.width * scale); c.height = Math.floor(v.height * scale); c.style.width = `${v.width}px`; c.style.height = `${v.height}px`;
        setDimensions({ width: v.width, height: v.height });
        const task = p.render({ canvas: c, viewport: v, transform: [scale,0,0,scale,0,0] }); cancelRender = () => task.cancel(); await task.promise;
        if (disposed) return;
        const { TextLayer } = await import('pdfjs-dist'); textHost.current!.replaceChildren(); textHost.current!.style.setProperty('--scale-factor', String(v.scale)); textHost.current!.style.setProperty('--total-scale-factor', String(v.scale));
        const layer = new TextLayer({ textContentSource: await p.getTextContent(), container: textHost.current!, viewport: v }); cancelText = () => layer.cancel(); await layer.render();
        if (disposed) return;
        const restoring = pending.current || (current.current?.type === 'pdf' && current.current.page === page ? current.current : null);
        restoreScroll(restoring); pending.current = null;
        rendering.current = false;
        const l = restoring || getLocation(); current.current = l;
        if (!initialized.current) { initialized.current = true; latest.current.onReady(l, Array.from({ length: doc.current!.numPages }, (_,i) => ({ label: `Page ${i + 1}`, page: i + 1 }))); }
        else if (navigationPending.current) latest.current.onLocation(l);
        navigationPending.current = false;
      } catch(e) { if (!disposed && !(e instanceof Error && e.name === 'RenderingCancelledException')) latest.current.onError(e instanceof Error ? e.message : 'Could not render page'); }
    })();
    return () => { disposed = true; cancelRender?.(); cancelText?.(); };
  }, [loaded, page, width, props.zoom]);
  useImperativeHandle(ref, () => ({
    next() { navigate(Math.min(doc.current?.numPages || 1, pageRef.current + 1)); }, previous() { navigate(Math.max(1, pageRef.current - 1)); },
    async restore(l) { if (l.type !== 'pdf') return; armed.current = false; navigationPending.current = false; pending.current = l; if (l.page === pageRef.current) { restoreScroll(l); pending.current = null; } else setPage(l.page); },
    async jump(a) { if (a.type === 'pdf') { const rect = a.rects[0]; navigate(a.page, { version: 1, type: 'pdf', page: a.page, x: a.x ?? rect?.[0] ?? 0, y: a.y ?? rect?.[3] ?? 1, progression: (a.page - 1) / (doc.current?.numPages || 1) }); } },
    async goTo(t) { if (t.page) navigate(t.page); },
    async search(query) {
      const results: SearchResult[] = []; const d = doc.current; if (!d || !query.trim()) return results;
      for (let n = 1; n <= d.numPages; n++) {
        const p = await d.getPage(n); const text = await p.getTextContent(); const joined = text.items.map(i => 'str' in i ? i.str : '').join(' '); const lower = joined.toLocaleLowerCase(); const needle = query.toLocaleLowerCase(); let start = 0;
        while (start < joined.length && results.length < 100) { const index = lower.indexOf(needle, start); if (index < 0) break; results.push({ label: `Page ${n}`, excerpt: joined.slice(Math.max(0, index - 55), index + query.length + 90), location: { version: 1, type: 'pdf', page: n, x: 0, y: 1, progression: (n-1)/d.numPages } }); start = index + needle.length; }
        if (results.length >= 100) break; await new Promise(resolve => setTimeout(resolve, 0));
      }
      return results;
    }
  }));
  function selected() {
    // Moving focus into the annotation controls can collapse the native range.
    // Keep the captured passage available until that action has completed.
    if (selectionAction.current || document.querySelector('.modal .selected-quote')) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !pageHost.current || !viewport.current || !selection.rangeCount) { latest.current.onSelection(null); return; }
    const range = selection.getRangeAt(0);
    if (!pageHost.current.contains(range.commonAncestorContainer)) { latest.current.onSelection(null); return; }
    const quote = selection.toString().trim();
    if (!quote) { latest.current.onSelection(null); return; }
    const hostRect = pageHost.current.getBoundingClientRect(); const v = viewport.current, [x0,y0,x1,y1] = v.viewBox;
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0).map(r => {
      const a = v.convertToPdfPoint(r.left - hostRect.left, r.top - hostRect.top), b = v.convertToPdfPoint(r.right - hostRect.left, r.bottom - hostRect.top);
      return [(Math.min(a[0],b[0])-x0)/(x1-x0),(Math.min(a[1],b[1])-y0)/(y1-y0),(Math.max(a[0],b[0])-x0)/(x1-x0),(Math.max(a[1],b[1])-y0)/(y1-y0)].map(n => Math.max(0,Math.min(1,n)));
    });
    latest.current.onSelection(rects.length ? { quote: quote.slice(0,20000), anchor: { type: 'pdf', page: pageRef.current, rects } } : null);
  }
  checkSelection.current = selected;
  useEffect(() => {
    const inputAbort = new AbortController();
    let frame: number | undefined; let release: ReturnType<typeof setTimeout> | undefined;
    const queueCheck = () => { if (frame !== undefined) cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { frame = undefined; checkSelection.current(); }); };
    const protectedTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.selection-actions,.modal'));
    const start = (event: Event) => {
      clearTimeout(release);
      selectionAction.current = protectedTarget(event.target);
      if (selectionAction.current) return;
      // A tap on reader chrome/empty space should dismiss the old passage even
      // when the browser retains its previous text selection after the tap.
      if (!(event.target instanceof Node) || !pageHost.current?.contains(event.target)) {
        const native = window.getSelection();
        if (native?.rangeCount && pageHost.current?.contains(native.getRangeAt(0).commonAncestorContainer)) native.removeAllRanges();
        latest.current.onSelection(null);
      }
    };
    const end = () => {
      if (selectionAction.current) {
        // Let click handlers open/save the highlight dialog before checking.
        clearTimeout(release); release = setTimeout(() => { selectionAction.current = false; queueCheck(); }, 0);
      } else queueCheck();
    };
    const changed = () => { if (!selectionAction.current) queueCheck(); };
    const options = { capture: true, signal: inputAbort.signal };
    document.addEventListener('pointerdown', start, options);
    document.addEventListener('pointerup', end, options);
    document.addEventListener('pointercancel', end, options);
    document.addEventListener('touchstart', start, { ...options, passive: true });
    document.addEventListener('touchend', end, { ...options, passive: true });
    document.addEventListener('touchcancel', end, { ...options, passive: true });
    document.addEventListener('selectionchange', changed, { signal: inputAbort.signal });
    return () => { inputAbort.abort(); clearTimeout(release); if (frame !== undefined) cancelAnimationFrame(frame); selectionAction.current = false; };
  }, []);
  return <div className="pdf-scroll" ref={scroll} onWheel={() => { scrollIntent.current = true; }} onTouchMove={() => { scrollIntent.current = true; }} onPointerDown={e => { if (e.target === scroll.current) scrollIntent.current = true; }} onMouseUp={selected} onTouchEnd={selected} onScroll={() => { if (!initialized.current || rendering.current || !scrollIntent.current) return; armed.current = true; const l = getLocation(); current.current = l; latest.current.onLocation(l); }}><div className="pdf-page" ref={pageHost} style={{ width: dimensions.width, height: dimensions.height }}><canvas ref={canvas} /><div className="textLayer" ref={textHost} /><div className="pdf-highlights">{props.annotations.filter(a => a.kind === 'highlight' && a.anchor.type === 'pdf' && a.anchor.page === page).flatMap(a => a.anchor.type === 'pdf' ? a.anchor.rects.map((rect,i) => { const v = viewport.current; if (!v) return null; const [x0,y0,x1,y1] = v.viewBox; const r = v.convertToViewportRectangle([x0+rect[0]*(x1-x0),y0+rect[1]*(y1-y0),x0+rect[2]*(x1-x0),y0+rect[3]*(y1-y0)]); return <span key={`${a.id}-${i}`} style={{ left: Math.min(r[0],r[2]), top: Math.min(r[1],r[3]), width: Math.abs(r[2]-r[0]), height: Math.abs(r[3]-r[1]) }} />; }) : [])}</div></div></div>;
});
export default PdfReader;
