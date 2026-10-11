import { adminClient, errorResponse } from '@/server/auth';
export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response(null, { status: 401 });
  try {
    const admin = adminClient(); const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: rows, error } = await admin.from('books').select('*').or('status.eq.deleting,status.eq.uploading,status.eq.validating,status.eq.failed').lt('updated_at', cutoff).limit(100);
    if (error) throw error;
    let count = 0; let failed = 0;
    for (const b of rows || []) {
      const marked = await admin.from('books').update({ status: 'deleting' }).eq('id', b.id).eq('status', b.status).eq('updated_at', b.updated_at).select('id').maybeSingle();
      if (marked.error) { failed++; continue; }
      if (!marked.data) continue;
      const removed = await admin.storage.from('books').remove([`${b.user_id}/${b.id}/original.${b.format}`]); if (removed.error) { failed++; continue; }
      const covers = await admin.storage.from('covers').list(`${b.user_id}/${b.id}`); if (covers.error) { failed++; continue; }
      if (covers.data?.length) { const r = await admin.storage.from('covers').remove(covers.data.map(c => `${b.user_id}/${b.id}/${c.name}`)); if (r.error) { failed++; continue; } }
      const d = await admin.from('books').delete().eq('id', b.id).eq('status', 'deleting'); if (d.error) failed++; else count++;
    }
    const pruned = await admin.rpc('prune_reader_storage');
    if (pruned.error) throw pruned.error;
    return Response.json({ removed: count, failed, sync: pruned.data, ...(failed ? { error: 'Some files could not be cleaned up. Retry maintenance.' } : {}) }, { status: failed ? 503 : 200 });
  } catch(e) { return errorResponse(e); }
}
