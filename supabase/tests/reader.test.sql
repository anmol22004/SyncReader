-- Run against a local test project with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(12);
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','a@example.test'),
 ('22222222-2222-4222-8222-222222222222','b@example.test');
insert into public.books(id,user_id,format,title,original_filename,byte_size,status,page_count) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','pdf','A','a.pdf',100,'ready',20),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','pdf','B','b.pdf',100,'ready',20);
insert into public.reading_progress(book_id,user_id) select id,user_id from public.books;
insert into public.reader_sessions(id,user_id,book_id,device_id) values
 ('aaaaaaaa-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000010'),
 ('aaaaaaaa-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000020');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select is((select count(*)::integer from public.books),1,'Only owned books are visible');
select is((select count(*)::integer from public.reading_progress),1,'Only owned progress is visible');
select throws_ok($$update public.reading_progress set revision=999$$,'42501',null,'Direct progress writes are denied');
select throws_ok($$select public.open_reader_session('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-0000-4000-8000-000000000010')$$,'P0001','Book unavailable','Cannot open another user book');
select throws_ok($$select public.update_book('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','stolen',null)$$,'P0001','Book unavailable','Cannot edit another user book');
select is(public.save_progress('aaaaaaaa-0000-4000-8000-000000000101','aaaaaaaa-0000-4000-8000-000000000001',1,0,'{"version":1,"type":"pdf","page":5,"x":0,"y":1,"progression":0.2}') ->> 'outcome','accepted','First revision write succeeds');
select is(public.save_progress('aaaaaaaa-0000-4000-8000-000000000101','aaaaaaaa-0000-4000-8000-000000000001',1,0,'{"version":1,"type":"pdf","page":5,"x":0,"y":1,"progression":0.2}') ->> 'outcome','accepted','Exact retry returns its receipt');
select is((select revision::integer from public.reading_progress),1,'Retry does not increment revision twice');
select is(public.save_progress('aaaaaaaa-0000-4000-8000-000000000102','aaaaaaaa-0000-4000-8000-000000000002',1,0,'{"version":1,"type":"pdf","page":2,"x":0,"y":1,"progression":0.1}') ->> 'outcome','conflict','Other session with old revision conflicts');
select is((select location->>'page' from public.reading_progress),'5','Conflict does not overwrite location');
select throws_ok($$select public.save_progress('aaaaaaaa-0000-4000-8000-000000000103','aaaaaaaa-0000-4000-8000-000000000001',2,1,'{"version":1,"type":"pdf","page":999,"x":0,"y":1,"progression":0.1}')$$,'P0001','Invalid location','Out of range pages are rejected');
select throws_ok($$insert into storage.objects(bucket_id,name) values('books','22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original.pdf')$$,'42501',null,'Cannot upload into another user path');
reset role;
select * from finish();
rollback;
