'use client';
import { PreferenceControls } from './reading-settings';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Library, Bookmark, Settings, Plus, Search, Grid2X2, List, ArrowUpRight, ArrowRight, Cloud, HardDrive, LogOut, LoaderCircle, MoreHorizontal, Upload, X, Check, FileText, ChevronRight, Leaf, Moon, Sun } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { cloudConfigured, supabase } from '@/lib/supabase';
import { LOCAL_USER, purgeCloudLocal } from '@/lib/local';
import * as service from '@/lib/service';
import { locationLabel } from '@/lib/locations';
import { DEFAULT_PREFERENCES, type Annotation, type Book, type Preferences, type Progress } from '@/lib/types';
import Modal from './modal';
import Reader from './reader';
import AuthForm from './auth-form';

const bytes = (n: number) => n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
export default function Folio() {
  const [session, setSession] = useState<Session | null>(null); const [authReady, setAuthReady] = useState(!cloudConfigured);
  const [authError, setAuthError] = useState('');
  const [books, setBooks] = useState<Book[]>([]); const [progress, setProgress] = useState<Progress[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({}); const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Book | null>(null); const [view, setView] = useState('library');
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all'); const [sort, setSort] = useState('recent'); const [list, setList] = useState(false);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<{ percent: number; label: string } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false);
  const [manage, setManage] = useState<Book | null>(null); const [editTitle, setEditTitle] = useState(''); const [editAuthor, setEditAuthor] = useState(''); const [confirmDelete, setConfirmDelete] = useState(false);
  const [allAnnotations, setAllAnnotations] = useState<Annotation[]>([]);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const fileInput = useRef<HTMLInputElement>(null); const identity = useRef<string | null>(null);
  const userId = cloudConfigured ? session?.user.id : LOCAL_USER;
  useEffect(() => {
    if (!supabase) return;
    let disposed = false; let events = 0;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.get('error') || fragment.get('error_code')) { setAuthError('Please sign in with your email and password.'); window.history.replaceState({}, '', window.location.pathname + window.location.search); }
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (disposed) return; events++; setSession(s); setAuthReady(true);
      if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') setAuthError('');
    });
    supabase.auth.getSession().then(r => { if (!disposed && events === 0) { if (r.error) setAuthError('Could not restore your session. Please sign in again.'); setSession(r.data.session); setAuthReady(true); } }).catch(() => { if (!disposed && events === 0) { setAuthError('Could not restore your session. Please sign in again.'); setAuthReady(true); } });
    return () => { disposed = true; data.subscription.unsubscribe(); };
  }, []);
  const refresh = useCallback(async () => {
    const owner = identity.current;
    if (!owner) return;
    setLoading(true);
    try {
      const data = await service.library(); if (identity.current !== owner) return;
      setBooks(data.books); setProgress(data.progress);
      const coverPairs = await Promise.all(data.books.map(async b => { try { return [b.id, await service.coverUrl(b)] as const; } catch { return [b.id, null] as const; } }));
      if (identity.current === owner) setCovers(Object.fromEntries(coverPairs.filter((p): p is readonly [string, string] => Boolean(p[1]))));
    } catch (e) { if (identity.current === owner) setMessage(e instanceof Error ? e.message : 'Could not load your library'); }
    finally { if (identity.current === owner) setLoading(false); }
  }, []);
  useEffect(() => {
    const previous = identity.current; identity.current = userId || null;
    setActive(null); setBooks([]); setProgress([]); setCovers({}); setAllAnnotations([]); setPreferences(DEFAULT_PREFERENCES); setMessage('');
    if (previous && previous !== userId && previous !== LOCAL_USER) void purgeCloudLocal(previous);
    if (userId) {
      void refresh(); const owner = userId;
      service.getPreferences(owner).then(p => { if (p && identity.current === owner) setPreferences(p); }).catch(e => setMessage(e.message));
    } else setLoading(false);
  }, [userId, refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);
  useEffect(() => {
    if (view !== 'notes' || !userId) return;
    let cancelled = false;
    Promise.all(books.filter(b => b.status === 'ready').map(b => service.annotations(b.id))).then(a => { if (!cancelled) setAllAnnotations(a.flat()); }).catch(e => setMessage(e.message));
    return () => { cancelled = true; };
  }, [view, books, userId]);
  async function importFiles(files: FileList | File[]) {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      for (const file of Array.from(files)) await service.uploadBook(file, (percent, label) => setUploading({ percent, label }));
      setUploadOpen(false); await refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Upload failed'); await refresh(); }
    finally { setUploading(null); setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function sample() {
    setBusy(true); setUploading({ percent: 0, label: 'Preparing a sample book…' }); setMessage('');
    try { const r = await fetch('/api/sample'); if (!r.ok) throw new Error('Could not create sample'); const f = new File([await r.blob()], 'The Art of Slowing Down.epub', { type: 'application/epub+zip' }); await service.uploadBook(f, (percent, label) => setUploading({ percent, label })); await refresh(); setUploadOpen(false); }
    catch(e) { setMessage(e instanceof Error ? e.message : 'Could not add sample'); }
    finally { setBusy(false); setUploading(null); }
  }
  function manageBook(b: Book) { setManage(b); setEditTitle(b.title); setEditAuthor(b.author || ''); setConfirmDelete(false); }
  async function saveDetails() {
    if (!manage) return; setBusy(true);
    try { await service.updateBook(manage, editTitle.trim(), editAuthor.trim()); setManage(null); await refresh(); } catch(e) { setMessage(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  }
  async function removeBook() {
    if (!manage) return; setBusy(true);
    try { await service.deleteBook(manage); setManage(null); await refresh(); } catch(e) { setMessage(e instanceof Error ? e.message : 'Could not delete'); } finally { setBusy(false); }
  }
  async function toggleCompleted(b: Book) {
    setBusy(true); try { await service.updateBook(b, b.title, b.author || '', !progress.find(p => p.book_id === b.id)?.completed_at); setManage(null); await refresh(); } catch(e) { setMessage(e instanceof Error ? e.message : 'Could not update book'); } finally { setBusy(false); }
  }
  async function changePreferences(p: Preferences) {
    try { await service.setPreferences(userId!, p); setPreferences(p); } catch(e) { setMessage('This browser could not remember your reading settings'); throw e; }
  }
  const readyBooks = books.filter(b => b.status === 'ready');
  const continuing = progress.filter(p => p.location && !p.completed_at).sort((a,b) => (b.last_read_at || '').localeCompare(a.last_read_at || ''));
  const visible = readyBooks.filter(b => `${b.title} ${b.author || ''}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || b.format === filter || filter === 'finished' && progress.find(p => p.book_id === b.id)?.completed_at)).sort((a,b) => sort === 'title' ? a.title.localeCompare(b.title) : b.created_at.localeCompare(a.created_at));
  if (!authReady) return <div className="full-loading"><LoaderCircle className="spin" /> Opening your library…</div>;
  if (cloudConfigured && !session) return <div className="login-page"><div className="login-story"><Logo /><span className="eyebrow">A LITTLE SPACE FOR YOURSELF</span><h1>One library.<br />Everywhere you go.</h1><p>Your books, your notes, and the place you left off.<br />A quieter way to read across devices.</p><div className="login-books"><div className="decorative-book">THE ART<br />OF SLOWING<br /><i>DOWN</i></div><div className="decorative-book second">A WORLD<br />BETWEEN<br /><i>PAGES</i></div></div></div><div className="login-form"><AuthForm initialError={authError} /></div></div>;
  if (identity.current && identity.current !== userId) return <div className="full-loading"><LoaderCircle className="spin" /> Opening your library…</div>;
  if (active) return <Reader key={`${userId}:${active.id}`} book={active} preferences={preferences} changePreferences={changePreferences} close={() => { setActive(null); void refresh(); }} />;
  return <div className="app-shell">
    <aside className="sidebar"><Logo /><span className="nav-label">YOUR READING SPACE</span><nav>
      <button className={view === 'library' ? 'selected' : ''} onClick={() => setView('library')}><Library size={19} /> My library <span className="count">{readyBooks.length}</span></button>
      <button className={view === 'continue' ? 'selected' : ''} onClick={() => setView('continue')}><BookOpen size={19} /> Continue reading</button>
      <button className={view === 'notes' ? 'selected' : ''} onClick={() => setView('notes')}><Bookmark size={19} /> Notes & bookmarks</button>
    </nav><div className="sidebar-note"><Leaf size={22} /><p>A page at a time.<br /><span>Make room for a good book.</span></p></div><div className="sidebar-bottom"><button onClick={() => setSettingsOpen(true)}><Settings size={18} /> Reading preferences</button><div className="identity"><span className="avatar">{session?.user.email?.[0]?.toUpperCase() || 'Y'}</span><div><strong>{session?.user.email?.split('@')[0] || 'Your personal library'}</strong><small>{cloudConfigured ? 'Private cloud library' : 'On this device'}</small></div>{supabase && <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => { void supabase!.auth.signOut().then(r => { if (r.error) setMessage(r.error.message); }); }}><LogOut size={17} /></button>}</div></div></aside>
    <main className="library-main"><header className="topbar"><span>YOUR LIBRARY, YOUR PACE</span><div className="connection">{cloudConfigured ? <Cloud size={16} /> : <HardDrive size={16} />} {cloudConfigured ? 'Private cloud storage' : 'Device-only mode'}<span className="status-dot" /></div></header>
      <div className="main-content"><div className="page-heading"><div><span className="eyebrow">A GOOD DAY TO READ</span><h1>{view === 'notes' ? 'Between the lines.' : view === 'continue' ? 'Pick up your next chapter.' : 'Your own little library.'}</h1><p>{view === 'notes' ? 'The words you kept, all in one place.' : 'A home for your books. A place to pick up where you left off.'}</p></div><button className="primary" onClick={() => setUploadOpen(true)}><Plus size={18} /> Add a book</button></div>
      {!cloudConfigured && <div className="local-notice"><HardDrive size={17} /><span>Books stay in this browser. Connect cloud storage to read across devices.</span><a href="/setup">Setup guide <ArrowUpRight size={14} /></a></div>}
      {message && <div className="error-banner" role="alert"><span>{message}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setMessage('')}><X size={16} /></button></div>}
      {uploading && <div className="upload-progress" role="status"><LoaderCircle className="spin" size={18} /><span>{uploading.label}</span><strong>{uploading.percent}%</strong><progress value={uploading.percent} max={100} /></div>}
      {books.some(b => b.status !== 'ready') && <div className="incomplete-uploads"><h3>Uploads needing attention</h3>{books.filter(b => b.status !== 'ready').map(b => <div key={b.id}><FileText size={18} /><span>{b.original_filename}<small>{b.failure_code || b.status}</small></span>{b.status === 'uploading' && <button className="text-button" disabled={busy} onClick={async () => { setBusy(true); try { await service.cloudRequest(`/api/books/${b.id}/finalize`); await refresh(); } catch(e) { setMessage(e instanceof Error ? e.message : 'Validation failed'); await refresh(); } finally { setBusy(false); } }}>Finish upload</button>}<button className="text-button danger" onClick={() => manageBook(b)}>Remove</button></div>)}</div>}
      {loading ? <div className="section-loading"><LoaderCircle className="spin" size={22} /> Gathering your books…</div> : view === 'notes' ? <div className="notes-list">{!allAnnotations.length && <Empty icon={<Bookmark size={30} />} title="Keep the words that stay with you." description="Select text while reading to highlight it, or bookmark a page. Your notes will appear here." />}{allAnnotations.map(a => { const b = books.find(b => b.id === a.book_id); return <button className="note-card" key={a.id} onClick={() => { if (b) { sessionStorage.setItem(`folio-jump:${b.id}`, JSON.stringify(a.anchor)); setActive(b); } }}><span className="eyebrow">{b?.title} · {a.anchor.type === 'pdf' ? `PAGE ${a.anchor.page}` : 'EPUB'}</span>{a.quote ? <blockquote>{a.quote}</blockquote> : <p><Bookmark size={16} /> Bookmarked passage</p>}{a.note && <p>{a.note}</p>}<small>Open in book <ArrowUpRight size={13} /></small></button>; })}</div> : <>
        <section className="continue-section"><div className="section-heading"><h2>Continue reading</h2><span>{continuing.length ? 'Right where you left off' : 'Your next chapter is waiting'}</span></div>{continuing.length ? <div className="continue-grid">{continuing.slice(0, view === 'continue' ? undefined : 2).map(p => { const b = books.find(b => b.id === p.book_id); return b && <button className="continue-card" key={b.id} onClick={() => setActive(b)}><Cover book={b} url={covers[b.id]} compact /><div className="continue-info"><span className="format-label">{b.format.toUpperCase()} · {locationLabel(p.location)}</span><h3>{b.title}</h3><p>{b.author || 'Your personal collection'}</p><div className="progress-row"><div className="progress-track"><i style={{ width: `${p.progression * 100}%` }} /></div><span>{Math.round(p.progression * 100)}%</span></div><span className="resume-label">Continue reading <ArrowRight size={16} /></span></div></button>; })}</div> : <div className="continue-empty"><div className="empty-book-icon"><BookOpen size={28} /></div><div><h3>Every great read begins with a first page.</h3><p>Open a book and your place will be waiting here.</p></div><span className="empty-flourish">Aa</span></div>}</section>
        {view === 'library' && <section className="bookshelf"><div className="section-heading"><h2>All books <span className="small-count">{readyBooks.length}</span></h2><div className="view-toggle"><button className={!list ? 'active' : ''} aria-label="Grid view" aria-pressed={!list} onClick={() => setList(false)}><Grid2X2 size={17} /></button><button className={list ? 'active' : ''} aria-label="List view" aria-pressed={list} onClick={() => setList(true)}><List size={18} /></button></div></div><div className="shelf-controls"><div className="filters">{['all','epub','pdf','finished'].map(f => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All books' : f === 'finished' ? 'Finished' : f.toUpperCase()}</button>)}</div><div className="search-sort"><label className="search-field"><Search size={17} /><input aria-label="Search your library" placeholder="Find a book…" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="Sort books" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Recently added</option><option value="title">Title A–Z</option></select></div></div>
          {!readyBooks.length ? <div className="empty-library" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void importFiles(e.dataTransfer.files); }}><div className="empty-shelf-art"><div /><div /><div /><BookOpen size={38} strokeWidth={1.2} /></div><h2>Good stories deserve a home.</h2><p>Add your first PDF or EPUB. Your library grows with you,<br className="desktop-break" /> one book at a time.</p><button className="primary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={17} /> Upload your first book</button><button className="text-button sample-link" disabled={busy} onClick={() => void sample()}>Or explore with a sample book <ArrowRight size={14} /></button><small>PDF & EPUB · Up to 50 MB each</small></div> : !visible.length ? <Empty icon={<Search size={26} />} title="No books found." description="Try another title, author, or filter." /> : <div className={list ? 'book-list' : 'book-grid'}>{visible.map(b => { const p = progress.find(p => p.book_id === b.id); return <article className="book-card" key={b.id}><button className="book-open" onClick={() => setActive(b)} aria-label={`Read ${b.title}`}><Cover book={b} url={covers[b.id]} /><div className="book-meta"><span className="format-label">{b.format.toUpperCase()}{p?.completed_at && ' · FINISHED'}</span><h3>{b.title}</h3><p>{b.author || 'Unknown author'}</p><div className="book-bottom"><span>{p?.location ? `${Math.round(p.progression * 100)}% read` : 'Not started'}</span><ArrowUpRight size={16} /></div>{p?.location && <div className="progress-track"><i style={{ width: `${p.progression * 100}%` }} /></div>}</div></button><button className="book-menu icon-button" aria-label={`Manage ${b.title}`} onClick={() => manageBook(b)}><MoreHorizontal size={19} /></button></article>; })}<button className="add-card" onClick={() => setUploadOpen(true)}><span><Plus size={25} strokeWidth={1.4} /></span><strong>Room for another story</strong><small>Add a book to your library</small></button></div>}
        </section>}
      </>}
      <footer className="library-footer"><span><BookOpen size={14} /> A little less scrolling. A little more reading.</span><span>Made for your own shelf.</span></footer></div>
    </main>
    <input ref={fileInput} type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" multiple hidden onChange={e => { if (e.target.files) void importFiles(e.target.files); }} />
    {uploadOpen && <Modal title="A new chapter for your shelf" close={() => { if (!busy) setUploadOpen(false); }}><p className="muted">Upload once. {cloudConfigured ? 'Read on any device you sign into.' : 'Read and save your place in this browser.'}</p><button className="dropzone" disabled={busy} onClick={() => fileInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) void importFiles(e.dataTransfer.files); }}><Upload size={32} /><strong>Drop your books here</strong><span>or click to choose files</span><small>PDF or EPUB · Up to 50 MiB</small></button>{uploading && <p role="status">{uploading.label} {uploading.percent}%</p>}<button className="text-button sample-link" disabled={busy} onClick={() => void sample()}>Try a sample book <ChevronRight size={15} /></button></Modal>}
    {settingsOpen && <Modal title="Make yourself comfortable" close={() => setSettingsOpen(false)}><PreferenceControls preferences={preferences} change={p => { void changePreferences(p).catch(() => {}); }} /><p className="muted small">Font settings apply to EPUBs. PDFs keep their original layout.</p></Modal>}
    {manage && <Modal title={confirmDelete ? 'Remove this book?' : 'Book details'} close={() => { if (!busy) setManage(null); }}>{confirmDelete ? <><p>“{manage.title}” and its notes will be removed from {cloudConfigured ? 'your cloud library and all devices' : 'this browser'}. This cannot be undone.</p><div className="modal-actions"><button className="secondary" onClick={() => setConfirmDelete(false)}>Keep book</button><button className="danger-button" disabled={busy} onClick={() => void removeBook()}>{busy ? 'Removing…' : 'Remove book'}</button></div></> : <><label>Title<input value={editTitle} maxLength={500} onChange={e => setEditTitle(e.target.value)} /></label><label>Author<input value={editAuthor} maxLength={500} onChange={e => setEditAuthor(e.target.value)} /></label><p className="muted small">{manage.format.toUpperCase()} · {bytes(manage.byte_size)}{manage.page_count ? ` · ${manage.page_count} pages` : ''}</p>{manage.status === 'ready' && <button className="secondary" disabled={busy} onClick={() => void toggleCompleted(manage)}><Check size={16} /> {progress.find(p => p.book_id === manage.id)?.completed_at ? 'Mark as unfinished' : 'Mark as finished'}</button>}<div className="modal-actions"><button className="text-button danger" onClick={() => setConfirmDelete(true)}>Remove book</button>{manage.status === 'ready' && <button className="primary" disabled={busy || !editTitle.trim()} onClick={() => void saveDetails()}>Save changes</button>}</div></>}</Modal>}
  </div>;
}
export function Logo() { return <div className="logo"><span><BookOpen size={24} strokeWidth={1.6} /></span>folio<span className="logo-dot">.</span></div>; }
function Empty({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) { return <div className="simple-empty">{icon}<h3>{title}</h3><p>{description}</p></div>; }
function Cover({ book, url, compact = false }: { book: Book; url?: string; compact?: boolean }) {
  const palette = book.id.charCodeAt(0) % 5;
  return <div className={`book-cover palette-${palette} ${compact ? 'compact' : ''}`}>{url ? <img src={url} alt={`${book.title} cover`} /> : <><span className="cover-top">THE PERSONAL COLLECTION</span><div className="cover-rule" /><strong>{book.title}</strong><span className="cover-author">{book.author || 'A book for your shelf'}</span><div className="cover-mark"><Leaf size={28} strokeWidth={1} /></div></>}<span className="cover-spine" /></div>;
}
