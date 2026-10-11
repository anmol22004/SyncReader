'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowLeft, Bookmark, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Cloud, Download, Highlighter, List, LoaderCircle, Search, Settings, Trash2, X, ZoomIn, ZoomOut, HardDrive, AlertCircle } from 'lucide-react';
import type { Annotation, Book, Location, Preferences, Progress, SearchResult } from '@/lib/types';
import * as service from '@/lib/service';
import { supabase } from '@/lib/supabase';
import { clearPending, pendingFor, queuePending } from '@/lib/local';
import { readingGesture, visibleChrome } from '@/lib/reader-chrome';
import { locationLabel } from '@/lib/locations';
import { ProgressSync, type SyncState } from '@/lib/sync';
import { exportMarkdown } from '@/lib/export';
import type { ReaderHandle, Selection, TocItem } from './reader-engine';
import Modal from './modal';
import ReadingSettings from './reading-settings';
import type { BookPages } from '@/lib/epub-pages';
import { presetFor } from '@/lib/reading-preferences';
const EpubReader = dynamic(() => import('./epub-reader'), { ssr: false });
const PdfReader = dynamic(() => import('./pdf-reader'), { ssr: false });
export default function Reader({ book, preferences, changePreferences, close }: { book: Book; preferences: Preferences; changePreferences: (p: Preferences) => Promise<void>; close: () => void }) {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null); const [initial, setInitial] = useState<Location | null>(null); const [location, setLocation] = useState<Location | null>(null);
  const [notes, setNotes] = useState<Annotation[]>([]); const [toc, setToc] = useState<TocItem[]>([]); const [ready, setReady] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('synced'); const [conflict, setConflict] = useState<Progress | null>(null); const [syncError, setSyncError] = useState('');
  const [error, setError] = useState(''); const [selection, setSelection] = useState<Selection | null>(null); const [adding, setAdding] = useState(false);
  const [noteText, setNoteText] = useState(''); const [highlightOpen, setHighlightOpen] = useState(false); const [editNote, setEditNote] = useState<Annotation | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false); const [panel, setPanel] = useState<'contents' | 'notes' | 'search' | null>(null);
  const [displayedPanel, setDisplayedPanel] = useState<typeof panel>(null);
  useEffect(() => {
    if (panel) { setDisplayedPanel(panel); return; }
    const timer = setTimeout(() => setDisplayedPanel(null), 160);
    return () => clearTimeout(timer);
  }, [panel]);
  const [search, setSearch] = useState(''); const [searching, setSearching] = useState(false); const [searched, setSearched] = useState(false); const [results, setResults] = useState<SearchResult[]>([]);
  const [zoom, setZoom] = useState(1); const [leaving, setLeaving] = useState(false);
  const [mobile, setMobile] = useState(false); const [controlsHidden, setControlsHidden] = useState(false);
  const chrome = useRef(visibleChrome()); const touchY = useRef<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false); const [navigationTab, setNavigationTab] = useState<'contents' | 'bookmarks' | 'highlights'>('contents');
  const documentScroll = mobile && book.format === 'epub';
  const controlsPinned = Boolean(menuOpen || panel || settingsOpen || selection || highlightOpen || editNote || conflict || error);
  const interaction = useRef({ mobile, controlsPinned }); interaction.current = { mobile, controlsPinned };
  function showControls() { chrome.current = visibleChrome(); setControlsHidden(false); }
  function scrollGesture(delta: number) {
    if (interaction.current.controlsPinned) return;
    chrome.current = readingGesture(chrome.current, delta); setControlsHidden(chrome.current.hidden);
  }
  function toggleControls() {
    if (!interaction.current.mobile || interaction.current.controlsPinned) return;
    chrome.current = { hidden: !chrome.current.hidden, direction: 0, distance: 0 }; setControlsHidden(chrome.current.hidden);
  }
  useEffect(() => {
    const query = window.matchMedia('(max-width: 800px), (pointer: coarse)');
    const update = () => { setMobile(query.matches); showControls(); };
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!documentScroll) return;
    document.documentElement.classList.add('reading-document');
    return () => { document.documentElement.classList.remove('reading-document'); window.scrollTo(0, 0); };
  }, [documentScroll]);
  useEffect(() => { if (controlsPinned) showControls(); }, [controlsPinned]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { showControls(); return; }
      const target = event.target as Element | null;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || target?.closest('input,textarea,select,button,a,[contenteditable],[role="dialog"]')) return;
      if (['ArrowDown', 'PageDown', 'End'].includes(event.key) || event.key === ' ' && !event.shiftKey) scrollGesture(48);
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || event.key === ' ' && event.shiftKey) scrollGesture(-24);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const [previewPreferences, setPreviewPreferences] = useState<Preferences | null>(null);
  const appearance = previewPreferences || preferences; const palette = presetFor(appearance);
  const [bookPages, setBookPages] = useState<BookPages | null>(null);
  const [chapterRemaining, setChapterRemaining] = useState<number | null>(null);
  const engine = useRef<ReaderHandle>(null); const sync = useRef<ProgressSync | null>(null); const alive = useRef(true); const searchRun = useRef(0);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    (async () => {
      try {
        const [data, session, annotations, pending] = await Promise.all([service.bookBytes(book), service.openSession(book), service.annotations(book.id), pendingFor(book.user_id, book.id)]);
        if (cancelled) return;
        // A large download may take minutes; resume from the cloud state now,
        // rather than the position captured before the download started.
        const progress = await service.fetchProgress(book.id);
        if (cancelled) return;
        const ctl = new ProgressSync(book.user_id, book.id, session.sessionId, progress, {
          uuid: () => crypto.randomUUID(), send: op => service.saveProgress(book, op), persist: queuePending,
          reopen: () => service.openSession(book),
          clear: () => clearPending(book.user_id, book.id),
          changed: (state, remote, message) => { if (!cancelled) { setSyncState(state); setConflict(remote || null); setSyncError(message || ''); } }
        }, pending);
        sync.current = ctl; setInitial(ctl.location); setLocation(ctl.location); setNotes(annotations); setBytes(data);
        if (pending) setSyncState('local');
      } catch(e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open book'); }
    })();
    const retry = async () => {
      await sync.current?.flush();
      try { const remote = await service.fetchProgress(book.id); if (alive.current) await sync.current?.observeRemote(remote); } catch { /* The pending queue remains on this device. */ }
    };
    const visibility = () => { if (document.visibilityState === 'hidden') void sync.current?.flush(); else void retry(); };
    window.addEventListener('online', retry); document.addEventListener('visibilitychange', visibility);
    const key = (event: KeyboardEvent) => { if (book.format !== 'pdf') return; const t = event.target as HTMLElement; if (t.closest('input,textarea,select,[role="dialog"]') || event.ctrlKey || event.metaKey || event.altKey) return; if (event.key === 'ArrowRight') { event.preventDefault(); engine.current?.next(); } if (event.key === 'ArrowLeft') { event.preventDefault(); engine.current?.previous(); } };
    window.addEventListener('keydown', key);
    return () => { cancelled = true; alive.current = false; searchRun.current++; sync.current?.stop(); window.removeEventListener('online', retry); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('keydown', key); };
  }, [book]);
  async function leave() { setLeaving(true); await sync.current?.flush(); close(); }
  function moved(l: Location) { setLocation(l); sync.current?.move(l); }
  function engineReady(l: Location, navigation: TocItem[]) {
    setReady(true); setLocation(l); setToc(navigation);
    if (l.progression > 0) { chrome.current = { hidden: true, direction: 0, distance: 0 }; setControlsHidden(true); } if (sync.current && !sync.current.location) sync.current.location = l;
    void sync.current?.flush();
    const jump = sessionStorage.getItem(`folio-jump:${book.id}`);
    if (jump) { sessionStorage.removeItem(`folio-jump:${book.id}`); try { void engine.current?.jump(JSON.parse(jump)); } catch {} }
  }
  async function resolve(keepLocal: boolean) {
    try { const target = await sync.current?.resolve(keepLocal); if (target) { await engine.current?.restore(target); setLocation(target); } } catch(e) { setError(e instanceof Error ? e.message : 'Could not resolve progress'); }
  }
  function clearSelection() {
    setSelection(null); window.getSelection()?.removeAllRanges();
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('.reading-area iframe')) {
      try { frame.contentWindow?.getSelection()?.removeAllRanges(); } catch { /* Only reader-owned frames are accessible. */ }
    }
  }
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (highlightOpen || target?.closest('.selection-actions,[role="dialog"]')) return;
      clearSelection();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [highlightOpen]);
  async function addAnnotation(kind: 'bookmark' | 'highlight') {
    if (!location || kind === 'highlight' && !selection) return; setAdding(true);
    try {
      const anchor = kind === 'highlight' ? selection!.anchor : location.type === 'epub' ? { type: 'epub' as const, cfi: location.cfi, href: location.href } : { type: 'pdf' as const, page: location.page, x: location.x, y: location.y, rects: [] };
      const now = new Date().toISOString();
      const annotation: Annotation = { id: crypto.randomUUID(), user_id: book.user_id, book_id: book.id, kind, anchor, quote: kind === 'highlight' ? selection!.quote : null, note: kind === 'highlight' ? noteText || null : null, color: 'yellow', revision: 1, created_at: now, updated_at: now, deleted_at: null };
      const saved = await service.putAnnotation(annotation); if (!alive.current) return;
      setNotes(n => [...n, saved]); setHighlightOpen(false); setNoteText(''); clearSelection(); setNavigationTab(kind === 'bookmark' ? 'bookmarks' : 'highlights'); setPanel('notes');
    } catch(e) { setError(e instanceof Error ? e.message : 'Could not save annotation'); }
    finally { setAdding(false); }
  }
  async function deleteAnnotation(a: Annotation) {
    setAdding(true); try { await service.putAnnotation(a, a.revision, true); setNotes(n => n.filter(x => x.id !== a.id)); } catch(e) { setError(e instanceof Error ? e.message : 'Could not remove annotation'); } finally { setAdding(false); }
  }
  async function saveNote() {
    if (!editNote) return; setAdding(true);
    try { const a = await service.putAnnotation({ ...editNote, note: noteText || null }, editNote.revision); setNotes(n => n.map(x => x.id === a.id ? a : x)); setEditNote(null); setNoteText(''); } catch(e) { setError(e instanceof Error ? e.message : 'Could not save note'); } finally { setAdding(false); }
  }
  async function find(e: React.FormEvent) {
    e.preventDefault(); if (!search.trim() || !engine.current) return;
    const run = ++searchRun.current; setSearching(true); setResults([]); setSearched(false);
    try { const matches = await engine.current.search(search.trim()); if (alive.current && run === searchRun.current) { setResults(matches); setSearched(true); } } catch(e) { if (run === searchRun.current) setError(e instanceof Error ? e.message : 'Search failed'); }
    finally { if (run === searchRun.current) setSearching(false); }
  }
  async function jumpResult(result: SearchResult) {
    const l = result.location;
    await engine.current?.jump(l.type === 'epub' ? { type: 'epub', cfi: l.cfi } : { type: 'pdf', page: l.page, x: l.x, y: l.y, rects: [] });
    if (mobile) setPanel(null);
  }
  function download() { const blob = new Blob([exportMarkdown(book, notes)], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${book.title.replace(/[<>:"/\\|?*]/g, '_')}-notes.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const status = syncState === 'synced' ? supabase ? 'Synced' : 'Saved on this device' : syncState === 'saving' ? 'Saving…' : syncState === 'conflict' ? 'Choose a position' : syncState === 'local' ? 'Saved on this device · retrying' : 'Device save unavailable';
  return <div className={`reader-shell theme-${appearance.theme}${mobile ? ' mobile-reader' : ''}${documentScroll ? ' document-reader' : ''}${controlsHidden && !controlsPinned ? ' controls-hidden' : ''}`} style={{ '--paper': palette.background, '--ink': palette.color } as React.CSSProperties}><header className="reader-toolbar" inert={controlsHidden && !controlsPinned}><button className="reader-back" onClick={() => void leave()} disabled={leaving}><ArrowLeft size={19} /><span>Library</span></button><div className="reader-title"><h1>{book.title}</h1><span>{book.format === 'epub' && bookPages ? `${bookPages.remaining} pages left in chapter` : book.author || book.format.toUpperCase()}</span></div><button className={`reader-autosave ${syncState}`} title={syncError || status} aria-label={syncError || status} onClick={() => { if (syncState === 'local' || syncState === 'error') void sync.current?.flush(); }}>{syncState === 'error' || syncState === 'conflict' ? <AlertCircle size={17} /> : syncState === 'local' ? <HardDrive size={17} /> : <Cloud size={17} />}</button><div className="reader-tools"><button className={panel === 'contents' ? 'icon-button selected' : 'icon-button'} disabled={!ready} aria-label="Table of contents" title="Contents" onClick={() => { setNavigationTab('contents'); setPanel(panel === 'contents' ? null : 'contents'); }}><List size={20} /><span className="contents-label">Contents</span></button><button className={panel === 'search' ? 'icon-button selected' : 'icon-button'} disabled={!ready} aria-label="Search inside book" title="Search" onClick={() => setPanel(panel === 'search' ? null : 'search')}><Search size={19} /></button><button className="icon-button" disabled={!ready || adding} title="Bookmark this position" aria-label="Bookmark this position" onClick={() => void addAnnotation('bookmark')}><Bookmark size={19} /></button><button className={panel === 'notes' ? 'icon-button selected' : 'icon-button'} aria-label="Highlights and bookmarks" title="Notes" onClick={() => { setNavigationTab('highlights'); setPanel(panel === 'notes' ? null : 'notes'); }}><Highlighter size={19} /></button><button className="icon-button" aria-label="Reader settings" title="Settings" onClick={() => setSettingsOpen(true)}><Settings size={19} /></button></div>{book.format === 'pdf' && <div className="reader-pdf-controls"><button className="icon-button" disabled={!ready} aria-label="Previous page" onClick={() => engine.current?.previous()}><ChevronLeft size={18} /></button><button className="icon-button" disabled={!ready} aria-label="Next page" onClick={() => engine.current?.next()}><ChevronRight size={18} /></button><button className="icon-button" aria-label="Zoom out" disabled={zoom <= .5} onClick={() => setZoom(z => Math.max(.5,z-.1))}><ZoomOut size={17} /></button><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(z => Math.min(2,z+.1))}><ZoomIn size={17} /></button></div>}</header>
    {conflict && <div className="conflict-banner" role="alert"><AlertCircle size={19} /><div><strong>A different position is saved on another device.</strong><span>This device: {locationLabel(location)} · Cloud: {locationLabel(conflict.location)}. Which would you like to keep?</span></div><button className="secondary" onClick={() => void resolve(false)}>Use other position</button><button className="primary" onClick={() => void resolve(true)}>Keep this position</button></div>}
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={17} /></button></div>}
    <div className="reader-body">{displayedPanel && <aside className={`reader-panel${!panel ? " panel-closing" : ""}`} inert={!panel} aria-hidden={!panel}><div className="panel-heading"><h2>{displayedPanel === 'search' ? 'Find in this book' : 'Contents & notes'}</h2><button className="icon-button" aria-label="Close reader panel" onClick={() => setPanel(null)}><X size={18} /></button></div>{displayedPanel !== 'search' && <><p className="navigation-book-title">{book.title}</p><p className="navigation-page-count">{book.format === 'pdf' && location?.type === 'pdf' ? `Page ${location.page} of ${book.page_count || '?'}` : bookPages ? `Page ${bookPages.page} of ${bookPages.total}` : 'Counting pages...'}</p><div className="navigation-tabs" role="tablist" aria-label="Book navigation">{(['contents','bookmarks','highlights'] as const).map(tab => <button key={tab} id={`navigation-${tab}`} role="tab" aria-controls="navigation-results" aria-selected={navigationTab === tab} onClick={() => { setNavigationTab(tab); setPanel(tab === 'contents' ? 'contents' : 'notes'); }}>{tab === 'contents' ? 'Chapters' : tab === 'bookmarks' ? 'Bookmarks' : 'Highlights'}</button>)}</div></>}{displayedPanel === 'contents' && <div className="toc" id="navigation-results" role="tabpanel" aria-labelledby="navigation-contents">{!toc.length && <p className="muted">This book has no linked contents.</p>}{toc.map((item,i) => <button key={`${item.href || item.page}-${i}`} style={{ paddingLeft: 12 + (item.depth || 0) * 18 }} onClick={() => { void engine.current?.goTo(item); if (mobile) setPanel(null); }}>{item.label}<ChevronRight size={14} /></button>)}</div>}{displayedPanel === 'notes' && <div id="navigation-results" role="tabpanel" aria-labelledby={`navigation-${navigationTab}`}><button className="secondary export-button" onClick={download} disabled={!notes.length}><Download size={16} /> Export to Markdown</button>{!notes.some(a => a.kind === (navigationTab === 'bookmarks' ? 'bookmark' : 'highlight')) && <p className="muted">{navigationTab === 'bookmarks' ? 'Bookmark a position to find it here.' : 'Select a passage to save a highlight.'}</p>}{notes.filter(a => a.kind === (navigationTab === 'bookmarks' ? 'bookmark' : 'highlight')).map(a => <div className="reader-note" key={a.id}><button className="note-jump" onClick={() => { void engine.current?.jump(a.anchor); if (mobile) setPanel(null); }}><span className="eyebrow">{a.kind} · {a.anchor.type === 'pdf' ? `Page ${a.anchor.page}` : 'EPUB'}</span>{a.quote ? <blockquote>{a.quote}</blockquote> : <p>Saved reading position</p>}{a.note && <p className="note-text">{a.note}</p>}</button><div className="note-actions"><button className="text-button" onClick={() => { setEditNote(a); setNoteText(a.note || ''); }}>Edit note</button><button className="icon-button" disabled={adding} aria-label="Delete annotation" onClick={() => void deleteAnnotation(a)}><Trash2 size={15} /></button></div></div>)}</div>}{displayedPanel === 'search' && <><form className="book-search" onSubmit={find}><input autoFocus aria-label="Search text" value={search} onChange={e => setSearch(e.target.value)} placeholder="A word or a phrase…" maxLength={200} /><button className="primary" disabled={!ready || searching || !search.trim()}><Search size={16} /> Find</button></form>{searching && <p className="muted" role="status"><LoaderCircle size={15} className="spin" /> Searching the book…</p>}{searched && <p className="muted small">{results.length === 100 ? 'First 100' : results.length} results{!results.length && book.format === 'pdf' ? '. Scanned pages need OCR to be searchable.' : '.'}</p>}{results.map((r,i) => <button className="search-result" key={i} onClick={() => void jumpResult(r)}><span className="eyebrow">{r.label}</span><p>{r.excerpt}</p></button>)}</>}</aside>}
      <div className={`reading-area ${book.format}`} onWheel={e => { if (!e.ctrlKey && !e.metaKey) scrollGesture(e.deltaY); }} onTouchStart={e => { touchY.current = e.touches.length === 1 ? e.touches[0].clientY : null; }} onTouchMove={e => { if (touchY.current === null || e.touches.length !== 1) return; const y = e.touches[0].clientY; scrollGesture(touchY.current - y); touchY.current = y; }} onTouchEnd={() => { touchY.current = null; }}>
        {!bytes && <div className="reader-loading">{error ? <><BookOpen size={34} /><h2>This book could not be opened.</h2><button className="secondary" onClick={() => void leave()}>Return to library</button></> : <><LoaderCircle size={26} className="spin" /><p>Opening your next chapter…</p></>}</div>}
        {bytes && (book.format === 'epub' ? <EpubReader ref={engine} documentScroll={documentScroll} onReadingGesture={scrollGesture} onToggleControls={toggleControls} bytes={bytes} initial={initial} preferences={appearance} annotations={notes} onPages={setBookPages} onChapterRemaining={setChapterRemaining} onProgress={setLocation} onLocation={moved} onReady={engineReady} onSelection={s => { if (s || !highlightOpen) setSelection(s); }} onError={setError} /> : <PdfReader ref={engine} bytes={bytes} initial={initial} annotations={notes} zoom={zoom} onLocation={moved} onReady={engineReady} onSelection={s => { if (s || !highlightOpen) setSelection(s); }} onError={setError} />)}
        {selection && <div className="selection-actions" onPointerDown={e => e.preventDefault()}><Highlighter size={17} /><span>{selection.quote.length} characters selected</span><button className="primary" onClick={() => { setNoteText(''); setHighlightOpen(true); }}>Highlight & note</button><button className="icon-button" aria-label="Clear selection" onClick={clearSelection}><X size={16} /></button></div>}
      </div>
    </div>
    {!mobile && controlsHidden && !controlsPinned && <button className="show-reader-controls desktop-reader-reveal" aria-label="Show reader controls" title="Show controls (or scroll up)" onClick={showControls}><ChevronDown size={19} /></button>}
    {mobile && !settingsOpen && !panel && <><button className="reader-menu-toggle" aria-label={menuOpen ? 'Close reader menu' : 'Open reader menu'} aria-expanded={menuOpen} aria-controls="compact-reader-menu" onClick={() => setMenuOpen(!menuOpen)}><List size={21} /></button>{menuOpen && <><button className="reader-menu-dismiss" aria-label="Close reader menu" onClick={() => setMenuOpen(false)} /><div className="compact-reader-menu" id="compact-reader-menu" role="dialog" aria-label="Reader menu" onKeyDown={e => { if (e.key === 'Escape') setMenuOpen(false); }}><button autoFocus onClick={() => { setMenuOpen(false); setNavigationTab('contents'); setPanel('contents'); }}>Contents<List size={18} /></button><button onClick={() => { setMenuOpen(false); setPanel('search'); }}>Search book<Search size={18} /></button><button onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}>Themes & settings<span>Aa</span></button><div className="compact-menu-actions"><button disabled={!ready || adding} onClick={() => { setMenuOpen(false); void addAnnotation('bookmark'); }}><Bookmark size={18} />Bookmark</button><button onClick={() => { setMenuOpen(false); setNavigationTab('highlights'); setPanel('notes'); }}><Highlighter size={18} />Highlights</button></div></div></>}</>}
    {!panel && !settingsOpen && <div className="quiet-reading-position" title={book.format === 'epub' ? 'EPUB page numbers depend on the font and screen size.' : undefined}>{book.format === 'pdf' && location?.type === 'pdf' ? `${location.page} of ${book.page_count || '?'}` : bookPages ? `${bookPages.page} of ${bookPages.total}` : 'Counting pages...'}</div>}
    {mobile && controlsHidden && (syncState === 'local' || syncState === 'error') && <div className="reader-sync-notice" role="status"><HardDrive size={14} /><span>{syncState === 'local' ? 'Saved on this device' : 'Position could not be saved'}</span><button className="text-button" onClick={() => void sync.current?.flush()}>Retry</button></div>}
    {settingsOpen && <ReadingSettings preferences={preferences} preview={setPreviewPreferences} save={changePreferences} excerpt={selection?.quote} pdf={book.format === 'pdf'} close={() => { setSettingsOpen(false); setPreviewPreferences(null); }} />}
    {highlightOpen && selection && <Modal title="Keep this passage" close={() => { if (!adding) { setHighlightOpen(false); clearSelection(); } }}><blockquote className="selected-quote">{selection.quote}</blockquote><label>A note to yourself (optional)<textarea value={noteText} onChange={e => setNoteText(e.target.value)} maxLength={20000} rows={4} placeholder="What stood out to you?" /></label><div className="modal-actions"><button className="secondary" onClick={() => { setHighlightOpen(false); clearSelection(); }}>Cancel</button><button className="primary" disabled={adding} onClick={() => void addAnnotation('highlight')}>{adding ? 'Saving…' : 'Save highlight'}</button></div>{supabase && <small className="muted">An internet connection is required to save notes.</small>}</Modal>}
    {editNote && <Modal title="Edit your note" close={() => { if (!adding) setEditNote(null); }}><label>Note<textarea rows={5} value={noteText} maxLength={20000} onChange={e => setNoteText(e.target.value)} /></label><div className="modal-actions"><button className="primary" disabled={adding} onClick={() => void saveNote()}>Save note</button></div></Modal>}
  </div>;
}
