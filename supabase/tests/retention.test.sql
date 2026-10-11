-- Apply migrations 001 and 002, then run with supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(6);
insert into auth.users(id,email) values ('33333333-3333-4333-8333-333333333333','retention@example.test');
insert into public.books(id,user_id,format,title,original_filename,byte_size,status,page_count)
 values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','pdf','Keep me','c.pdf',100,'ready',20);
insert into public.reading_progress(book_id,user_id,revision)
 values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333',7);
insert into public.reader_sessions(id,user_id,book_id,device_id,last_seen_at) values
 ('cccccccc-0000-4000-8000-000000000001','33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc','cccccccc-0000-4000-8000-000000000010',now()-interval '31 days'),
 ('cccccccc-0000-4000-8000-000000000002','33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc','cccccccc-0000-4000-8000-000000000020',now());
insert into public.progress_operations(operation_id,user_id,book_id,session_id,sequence,payload,result,received_at)
 select gen_random_uuid(),user_id,book_id,id,1,'{}','{}',now()-interval '31 days' from public.reader_sessions where book_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
select throws_ok($$select public.prune_reader_storage()$$,'42501',null,'Clients cannot run global cleanup');
reset role;
select public.prune_reader_storage();
select is((select count(*)::integer from public.reader_sessions where id='cccccccc-0000-4000-8000-000000000001'),0,'Expired session removed');
select is((select count(*)::integer from public.reader_sessions where id='cccccccc-0000-4000-8000-000000000002'),1,'Active session retained');
select is((select count(*)::integer from public.progress_operations where book_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),0,'Expired receipts removed including cascading receipts');
select is((select revision::integer from public.reading_progress where book_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),7,'Current progress retained');
select is((select count(*)::integer from public.books where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),1,'Ready book retained');
select * from finish();
rollback;
