import 'server-only';
import { createClient } from '@supabase/supabase-js';
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Cloud server is not configured. Set SUPABASE_SERVICE_ROLE_KEY.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function authenticated(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) throw new Error('Authentication required');
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error('Authentication required');
  return { admin, user: data.user };
}
export function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return Response.json({ error: message }, { status: message === 'Authentication required' ? 401 : status, headers: { 'Cache-Control': 'no-store' } });
}
