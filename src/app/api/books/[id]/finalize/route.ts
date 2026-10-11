import { authenticated, errorResponse } from '@/server/auth';
import { inspectBook } from '@/server/validate-book';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let claimed: { id: string; admin: ReturnType<typeof import('@/server/auth').adminClient> } | null = null;
  try {
    const { admin, user } = await authenticated(request); const { id } = await context.params;
    const { data: book, error } = await admin.from('books').select('*').eq('id', id).eq('user_id', user.id).single();
    if (error || !book) return Response.json({ error: 'Book not found' }, { status: 404 });
    if (book.status === 'ready') return Response.json({ book });
    if (book.status !== 'uploading') throw new Error('This upload is not ready to validate.');
    const { data: claim, error: claimError } = await admin.from('books').update({ status: 'validating', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'uploading').select('id').maybeSingle();
    if (claimError || !claim) throw new Error('Validation is already running.');
    claimed = { id, admin };
    const key = `${user.id}/${id}/original.${book.format}`;
    const { data: file, error: downloadError } = await admin.storage.from('books').download(key);
    if (downloadError || !file) throw new Error('File upload is incomplete. Remove it and upload again.');
    if (file.size !== Number(book.byte_size)) throw new Error('Uploaded file size does not match the reservation.');
    const info = await inspectBook(Buffer.from(await file.arrayBuffer()), book.format, book.original_filename);
    const { data: existing } = await admin.from('books').select('*').eq('user_id', user.id).eq('sha256', info.sha256).eq('status', 'ready').maybeSingle();
    if (existing) {
      const removed = await admin.storage.from('books').remove([key]); if (removed.error) throw removed.error;
      const deleted = await admin.from('books').delete().eq('id', id); if (deleted.error) throw deleted.error;
      return Response.json({ book: existing, duplicate: true });
    }
    let coverPath: string | null = null;
    if (info.cover && info.coverMime) {
      coverPath = `${user.id}/${id}/cover.${info.coverMime === 'image/jpeg' ? 'jpg' : info.coverMime.split('/')[1]}`;
      const uploaded = await admin.storage.from('covers').upload(coverPath, info.cover, { contentType: info.coverMime, upsert: true });
      if (uploaded.error) throw uploaded.error;
    }
    // Insert before readiness: a crash here is recoverable by cleanup/retry.
    const initial = await admin.from('reading_progress').upsert({ book_id: id, user_id: user.id }, { onConflict: 'book_id', ignoreDuplicates: true });
    if (initial.error) throw initial.error;
    const ready = await admin.from('books').update({ status: 'ready', title: info.title, author: info.author, sha256: info.sha256, page_count: info.pageCount, cover_path: coverPath, updated_at: new Date().toISOString(), failure_code: null }).eq('id', id).eq('status', 'validating').select('*').single();
    if (ready.error) throw ready.error;
    return Response.json({ book: ready.data });
  } catch (e) {
    if (claimed) await claimed.admin.from('books').update({ status: 'failed', failure_code: e instanceof Error ? e.message.slice(0, 500) : 'Validation failed', updated_at: new Date().toISOString() }).eq('id', claimed.id).eq('status', 'validating');
    return errorResponse(e);
  }
}
