-- Apply after 001. Safe to reapply. Latest reading positions are never deleted.
create index if not exists sessions_last_seen on public.reader_sessions(last_seen_at);
create index if not exists operations_session on public.progress_operations(session_id);
create or replace function public.prune_reader_storage()
returns jsonb language plpgsql security definer set search_path='' as $$
declare sessions_removed integer; receipts_removed integer;
begin
 -- Match save_progress's 30-day expiry. Row locks serialize with active saves;
 -- skip locked rows to avoid interrupting an in-flight save.
 with expired as (
  select id from public.reader_sessions
  where last_seen_at < now()-interval '30 days'
  order by last_seen_at limit 5000 for update skip locked
 ) delete from public.reader_sessions where id in (select id from expired);
 get diagnostics sessions_removed = row_count;
 -- Session deletion cascades to its receipts. Bound the remaining work per run.
 with expired as (
  select operation_id from public.progress_operations
  where received_at < now()-interval '30 days'
  order by received_at limit 10000 for update skip locked
 ) delete from public.progress_operations where operation_id in (select operation_id from expired);
 get diagnostics receipts_removed = row_count;
 return jsonb_build_object('sessions',sessions_removed,'receipts',receipts_removed);
end $$;
revoke all on function public.prune_reader_storage() from public, anon, authenticated;
grant execute on function public.prune_reader_storage() to service_role;
