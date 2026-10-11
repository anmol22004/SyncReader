import { supabase } from './supabase';
import { db, LOCAL_USER, localBooks, localProgress, localAnnotations, clearPending, pruneLocalStorageIfDue } from './local';
import type { Annotation, Book, Operation, Preferences, Progress, SaveResult } from './types';

function check<T>(result: { data: T; error: { message: string } | null }): T { if (result.error) throw new Error(result.error.message); return result.data; }
export async function cloudRequest(path: string, method = 'POST') {
  const session = await supabase!.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('Please sign in again.');
  const r = await fetch(path, { method, headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 204) return null;
  const body = await r.json(); if (!r.ok) throw new Error(body.error || 'Request failed'); return body;
}
export async function library(): Promise<{ books: Book[]; progress: Progress[] }> {
  await pruneLocalStorageIfDue();
  if (!supabase) return { books: await localBooks(), progress: await localProgress() };
  const [b, p] = await Promise.all([supabase.from('books').select('*').order('created_at', { ascending: false }), supabase.from('reading_progress').select('*')]);
  return { books: check(b) || [], progress: check(p) || [] };
}
export async function coverUrl(book: Book): Promise<string | null> {
  if (!book.cover_path) return null;
  if (!supabase) return book.cover_path;
  const signed = check<{ signedUrl: string } | null>(await supabase.storage.from('covers').createSignedUrl(book.cover_path, 900));
  return signed?.signedUrl || null;
}
export async function uploadBook(file: File, onProgress: (n: number, label: string) => void): Promise<Book> {
  const format = file.name.split('.').pop()?.toLowerCase();
  if (format !== 'pdf' && format !== 'epub') throw new Error('Choose a PDF or EPUB file.');
  if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('The maximum book size is 50 MiB.');
  if (!supabase) {
    onProgress(15, 'Checking your book…');
    const r = await fetch('/api/inspect', { method: 'POST', headers: { 'x-book-format': format, 'x-book-name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file });
    const info = await r.json(); if (!r.ok) throw new Error(info.error);
    const existing = (await localBooks()).find(b => b.sha256 === info.sha256); if (existing) return existing;
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const book: Book = { id, user_id: LOCAL_USER, title: info.title, author: info.author, format, original_filename: file.name, byte_size: file.size, sha256: info.sha256, cover_path: info.coverUrl, page_count: info.pageCount, status: 'ready', created_at: now };
    const d = await db(); const tx = d.transaction(['books','files','progress'], 'readwrite');
    await tx.objectStore('books').put(book); await tx.objectStore('files').put(file, id);
    await tx.objectStore('progress').put({ book_id: id, user_id: LOCAL_USER, location: null, revision: 0, progression: 0, last_read_at: null, completed_at: null }); await tx.done;
    onProgress(100, 'Added to this device'); return book;
  }
  const owner = (await supabase.auth.getUser()).data.user?.id; if (!owner) throw new Error('Please sign in again.');
  const uploadKey = `${owner}:${file.name}:${file.size}:${file.lastModified}`;
  const d = await db(); const previous: Book | undefined = await d.get('uploads', uploadKey);
  let book: Book | null = null;
  if (previous) {
    const reservation = await supabase.from('books').select('*').eq('id', previous.id).eq('status', 'uploading').maybeSingle();
    if (reservation.error) throw new Error(reservation.error.message); book = reservation.data;
  }
  if (!book) book = check(await supabase.rpc('begin_book_upload', { p_format: format, p_filename: file.name.slice(0, 500), p_size: file.size }));
  const reserved = book!; await d.put('uploads', reserved, uploadKey);
  const { Upload } = await import('tus-js-client');
  const client = supabase;
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  // Hosted Supabase uses the direct storage hostname; local/custom deployments keep their origin.
  const origin = url.hostname.endsWith('.supabase.co') ? `${url.protocol}//${url.hostname.replace('.supabase.co', '.storage.supabase.co')}` : url.origin;
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: `${origin}/storage/v1/upload/resumable`, chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000], uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      fingerprint: async () => `folio:${reserved.user_id}:${reserved.id}:${file.size}:${file.lastModified}`,
      metadata: { bucketName: 'books', objectName: `${reserved.user_id}/${reserved.id}/original.${format}`, contentType: format === 'pdf' ? 'application/pdf' : 'application/epub+zip', cacheControl: '3600' },
      async onBeforeRequest(req) {
        const token = (await client.auth.getSession()).data.session?.access_token;
        if (!token) throw new Error('Please sign in again.');
        req.setHeader('authorization', `Bearer ${token}`);
      },
      onProgress: (sent, total) => onProgress(Math.round(sent / total * 85), 'Uploading to your private library…'),
      onError: reject, onSuccess: () => resolve()
    });
    upload.findPreviousUploads().then(previous => { if (previous[0]) upload.resumeFromPreviousUpload(previous[0]); upload.start(); }).catch(reject);
  });
  onProgress(90, 'Validating and extracting metadata…');
  const result = await cloudRequest(`/api/books/${reserved.id}/finalize`);
  await d.delete('uploads', uploadKey);
  onProgress(100, result.duplicate ? 'Already in your library' : 'Ready to read'); return result.book;
}
export async function bookBytes(book: Book): Promise<ArrayBuffer> {
  if (!supabase) { const file: Blob | undefined = await (await db()).get('files', book.id); if (!file) throw new Error('This local file is missing. Upload it again.'); return file.arrayBuffer(); }
  const blob = check<Blob | null>(await supabase.storage.from('books').download(`${book.user_id}/${book.id}/original.${book.format}`));
  if (!blob) throw new Error('This book file is unavailable.');
  return blob.arrayBuffer();
}
export async function openSession(book: Book) {
  if (supabase) {
    let device = localStorage.getItem('folio-device'); if (!device) { device = crypto.randomUUID(); localStorage.setItem('folio-device', device); }
    return check(await supabase.rpc('open_reader_session', { p_book_id: book.id, p_device_id: device })) as { sessionId: string; progress: Progress };
  }
  return { sessionId: crypto.randomUUID(), progress: await (await db()).get('progress', book.id) as Progress };
}
export async function fetchProgress(bookId: string): Promise<Progress> {
  if (!supabase) return (await db()).get('progress', bookId);
  const progress = check<Progress | null>(await supabase.from('reading_progress').select('*').eq('book_id', bookId).single());
  if (!progress) throw new Error('Reading progress is unavailable.');
  return progress;
}
export async function saveProgress(book: Book, op: Operation): Promise<SaveResult> {
  if (supabase) return check(await supabase.rpc('save_progress', { p_operation_id: op.operationId, p_session_id: op.sessionId, p_sequence: op.sequence, p_expected_revision: op.expectedRevision, p_location: op.location }));
  await pruneLocalStorageIfDue();
  const d = await db(); const tx = d.transaction(['progress', 'receipts'], 'readwrite');
  const receipt = await tx.objectStore('receipts').get(op.operationId);
  if (receipt) { await tx.done; return receipt; }
  let p: Progress = await tx.objectStore('progress').get(book.id);
  const outcome = p.revision === op.expectedRevision ? 'accepted' : 'conflict';
  if (outcome === 'accepted') { p = { ...p, location: op.location, progression: op.location.progression, revision: p.revision + 1, last_read_at: new Date().toISOString() }; await tx.objectStore('progress').put(p); }
  const result: SaveResult = { outcome, progress: p }; await tx.objectStore('receipts').put({ ...result, receivedAt: Date.now() }, op.operationId); await tx.done; return result;
}
export async function annotations(bookId: string): Promise<Annotation[]> {
  if (!supabase) return localAnnotations(bookId);
  return check(await supabase.from('annotations').select('*').eq('book_id', bookId).is('deleted_at', null).order('created_at')) || [];
}
export async function putAnnotation(a: Annotation, expectedRevision = 0, deleted = false): Promise<Annotation> {
  if (supabase) return check(await supabase.rpc('put_annotation', { p_id: a.id, p_book_id: a.book_id, p_kind: a.kind, p_anchor: a.anchor, p_quote: a.quote, p_note: a.note, p_expected_revision: expectedRevision, p_deleted: deleted }));
  const d = await db(); const tx = d.transaction('annotations', 'readwrite'); const old: Annotation | undefined = await tx.store.get(a.id);
  if (old && old.revision !== expectedRevision) { await tx.done; throw new Error('Annotation changed. Reload and try again.'); }
  const updated = { ...a, revision: expectedRevision + 1, updated_at: new Date().toISOString(), deleted_at: deleted ? new Date().toISOString() : null };
  if (deleted) await tx.store.delete(a.id); else await tx.store.put(updated); await tx.done; return updated;
}
export async function updateBook(book: Book, title: string, author: string, completed?: boolean) {
  if (supabase) { check(await supabase.rpc('update_book', { p_book_id: book.id, p_title: title, p_author: author || null, p_completed: completed ?? null })); return; }
  const d = await db(); await d.put('books', { ...book, title, author: author || null });
  if (completed !== undefined) { const p = await d.get('progress', book.id); await d.put('progress', { ...p, completed_at: completed ? new Date().toISOString() : null }); }
}
export async function deleteBook(book: Book) {
  if (supabase) {
    await cloudRequest(`/api/books/${book.id}`, 'DELETE'); await clearPending(book.user_id, book.id);
    const d = await db(); const tx = d.transaction('uploads', 'readwrite');
    for (const key of await tx.store.getAllKeys()) { const b: Book = await tx.store.get(key); if (b.id === book.id) await tx.store.delete(key); }
    await tx.done; return;
  }
  const d = await db(); const tx = d.transaction(['books','files','progress','annotations','outbox','receipts'], 'readwrite');
  await tx.objectStore('books').delete(book.id); await tx.objectStore('files').delete(book.id); await tx.objectStore('progress').delete(book.id);
  for (const a of await tx.objectStore('annotations').getAll() as Annotation[]) if (a.book_id === book.id) await tx.objectStore('annotations').delete(a.id);
  for (const key of await tx.objectStore('receipts').getAllKeys()) { const receipt: SaveResult = await tx.objectStore('receipts').get(key); if (receipt.progress.book_id === book.id) await tx.objectStore('receipts').delete(key); }
  await tx.objectStore('outbox').delete(`${book.user_id}:${book.id}`); await tx.done;
}
export async function getPreferences(userId: string): Promise<Preferences | null> {
  if (supabase) { const r = await supabase.from('reader_preferences').select('preferences').eq('user_id', userId).maybeSingle(); if (r.error) throw new Error(r.error.message); return r.data?.preferences || null; }
  try { return JSON.parse(localStorage.getItem(`folio-preferences:${userId}`) || 'null'); } catch { return null; }
}
export async function setPreferences(userId: string, preferences: Preferences) {
  if (supabase) check(await supabase.rpc('set_preferences', { p_preferences: preferences }));
  localStorage.setItem(`folio-preferences:${userId}`, JSON.stringify(preferences));
}
