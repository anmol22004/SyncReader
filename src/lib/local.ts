import { expiredReceipt, expiredUpload } from './retention';
import { openDB } from 'idb';
import type { Book, Progress, Annotation, Pending } from './types';
export const LOCAL_USER = 'local-device';
let connection: ReturnType<typeof openDB> | undefined;
export const db = () => connection ??= openDB('folio-v1', 3, { blocking() { void connection?.then(d => d.close()); connection = undefined; }, terminated() { connection = undefined; }, upgrade(d, oldVersion) {
  if (oldVersion < 1) {
  d.createObjectStore('books', { keyPath: 'id' });
  d.createObjectStore('files');
  d.createObjectStore('progress', { keyPath: 'book_id' });
  d.createObjectStore('annotations', { keyPath: 'id' });
  d.createObjectStore('outbox', { keyPath: 'key' });
  }
  if (oldVersion < 2) d.createObjectStore('receipts');
  if (oldVersion < 3) d.createObjectStore('uploads');
} });
export async function localBooks(): Promise<Book[]> { return (await db()).getAll('books'); }
export async function localProgress(): Promise<Progress[]> { return (await db()).getAll('progress'); }
export async function localAnnotations(bookId: string): Promise<Annotation[]> {
  return ((await (await db()).getAll('annotations')) as Annotation[]).filter(a => a.book_id === bookId && !a.deleted_at);
}
export async function pendingFor(userId: string, bookId: string): Promise<Pending | undefined> {
  return (await db()).get('outbox', `${userId}:${bookId}`);
}
export async function queuePending(pending: Pending) { await (await db()).put('outbox', pending); }
export async function clearPending(userId: string, bookId: string) { await (await db()).delete('outbox', `${userId}:${bookId}`); }
export async function purgeCloudLocal(userId: string) {
  const d = await db(); const tx = d.transaction(['outbox','uploads'], 'readwrite');
  for (const item of await tx.objectStore('outbox').getAll() as Pending[]) if (item.userId === userId) await tx.objectStore('outbox').delete(item.key);
  const uploads = tx.objectStore('uploads');
  for (const key of await uploads.getAllKeys()) if (String(key).startsWith(`${userId}:`)) await uploads.delete(key);
  await tx.done;
  localStorage.removeItem(`folio-preferences:${userId}`);
}

// Run when opening the library. All changes share a transaction with the outbox,
// so cleanup cannot discard a receipt required by an outstanding retry.
export async function pruneLocalStorage(now = Date.now()) {
  const d = await db();
  const tx = d.transaction(['receipts', 'outbox', 'uploads', 'annotations'], 'readwrite');
  const pendingIds = new Set((await tx.objectStore('outbox').getAll() as Pending[]).map(p => p.operation.operationId));
  let cursor = await tx.objectStore('receipts').openCursor();
  while (cursor) {
    const value = cursor.value;
    if (expiredReceipt(value.receivedAt, String(cursor.key), pendingIds, now)) await cursor.delete();
    else if (typeof value.receivedAt !== 'number') await cursor.update({ ...value, receivedAt: now });
    cursor = await cursor.continue();
  }
  let upload = await tx.objectStore('uploads').openCursor();
  while (upload) {
    if (expiredUpload(upload.value.created_at, now)) await upload.delete();
    upload = await upload.continue();
  }
  // Local annotations have no remote replicas that need deletion tombstones.
  let annotation = await tx.objectStore('annotations').openCursor();
  while (annotation) {
    if (annotation.value.deleted_at) await annotation.delete();
    annotation = await annotation.continue();
  }
  await tx.done;
}

let lastCleanup = 0;
let cleanup: Promise<void> | undefined;
export function pruneLocalStorageIfDue(): Promise<void> {
  if (cleanup) return cleanup;
  if (Date.now() - lastCleanup < 3600_000) return Promise.resolve();
  cleanup = pruneLocalStorage().then(() => { lastCleanup = Date.now(); }).finally(() => { cleanup = undefined; });
  return cleanup;
}
