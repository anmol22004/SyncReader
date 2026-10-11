import { authenticated, errorResponse } from '@/server/auth';
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await authenticated(request); const { id } = await context.params;
    const { data: b, error: lookupError } = await admin.from('books').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!b) return new Response(null, { status: 204 });
    if (b.status === 'validating') return Response.json({ error: 'Validation is running. Wait for it to finish before removing this book.' }, { status: 409 });
    const marked = await admin.from('books').update({ status: 'deleting', updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id).eq('status', b.status).select('id').maybeSingle();
    if (marked.error) throw marked.error;
    if (!marked.data) return Response.json({ error: 'This book changed. Retry removing it.' }, { status: 409 });
    const removed = await admin.storage.from('books').remove([`${user.id}/${id}/original.${b.format}`]);
    if (removed.error) throw removed.error;
    // Remove all cover artifacts, including interrupted finalization.
    const covers = await admin.storage.from('covers').list(`${user.id}/${id}`);
    if (covers.error) throw covers.error;
    if (covers.data?.length) { const r = await admin.storage.from('covers').remove(covers.data.map(c => `${user.id}/${id}/${c.name}`)); if (r.error) throw r.error; }
    const deleted = await admin.from('books').delete().eq('id', id).eq('user_id', user.id); if (deleted.error) throw deleted.error;
    return new Response(null, { status: 204 });
  } catch (e) { return errorResponse(e); }
}
