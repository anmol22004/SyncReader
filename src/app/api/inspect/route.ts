import { inspectBook, MAX_FILE_SIZE } from '@/server/validate-book';
import { errorResponse } from '@/server/auth';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return Response.json({ error: 'Use authenticated cloud upload.' }, { status: 403 });
    const format = request.headers.get('x-book-format');
    if (format !== 'epub' && format !== 'pdf') throw new Error('Unsupported book format');
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Missing file');
    const chunks: Uint8Array[] = []; let total = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > MAX_FILE_SIZE) { await reader.cancel(); throw new Error('Maximum file size is 50 MiB.'); } chunks.push(value); }
    const inspected = await inspectBook(Buffer.concat(chunks), format, decodeURIComponent(request.headers.get('x-book-name') || 'Book'));
    return Response.json({ ...inspected, cover: undefined, coverUrl: inspected.cover ? `data:${inspected.coverMime};base64,${inspected.cover.toString('base64')}` : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
