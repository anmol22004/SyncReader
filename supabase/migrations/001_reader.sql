-- Apply once in a fresh Supabase project. All book bytes are immutable.
create table public.books (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 format text not null check(format in ('epub','pdf')),
 title text not null check(length(title) between 1 and 500), author text,
 original_filename text not null, byte_size bigint not null check(byte_size between 1 and 52428800),
 sha256 text check(sha256 ~ '^[0-9a-f]{64}$'), cover_path text, page_count integer check(page_count > 0),
 status text not null default 'uploading' check(status in ('uploading','validating','ready','failed','deleting')),
 failure_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,user_id)
);
create unique index books_hash on public.books(user_id,sha256) where status='ready';
create index books_owner on public.books(user_id,created_at desc);
create table public.reading_progress (
 book_id uuid primary key, user_id uuid not null,
 location jsonb, progression double precision not null default 0 check(progression between 0 and 1),
 revision bigint not null default 0, last_read_at timestamptz, completed_at timestamptz,
 foreign key(book_id,user_id) references public.books(id,user_id) on delete cascade
);
create index progress_owner on public.reading_progress(user_id,last_read_at desc);
create table public.reader_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, book_id uuid not null, device_id uuid not null,
 last_sequence bigint not null default 0, last_seen_at timestamptz not null default now(),
 foreign key(book_id,user_id) references public.books(id,user_id) on delete cascade,
 unique(id,book_id,user_id)
);
create table public.progress_operations (
 operation_id uuid primary key, user_id uuid not null, book_id uuid not null, session_id uuid not null,
 sequence bigint not null check(sequence>0), payload jsonb not null, result jsonb not null,
 received_at timestamptz not null default now(),
 foreign key(session_id,book_id,user_id) references public.reader_sessions(id,book_id,user_id) on delete cascade,
 unique(session_id,sequence)
);
create index operations_received on public.progress_operations(received_at);
create table public.annotations (
 id uuid primary key, user_id uuid not null, book_id uuid not null,
 kind text not null check(kind in ('bookmark','highlight')), anchor jsonb not null,
 quote text check(length(quote)<=20000), note text check(length(note)<=20000),
 color text not null default 'yellow' check(color in ('yellow','green','blue','pink')),
 revision bigint not null default 1, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), deleted_at timestamptz,
 foreign key(book_id,user_id) references public.books(id,user_id) on delete cascade
);
create index annotation_book on public.annotations(user_id,book_id);
create table public.reader_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 preferences jsonb not null default '{"theme":"light","font":"serif","fontSize":19,"lineHeight":1.7}',
 updated_at timestamptz not null default now()
);

do $$ declare t text; begin
 foreach t in array array['books','reading_progress','reader_sessions','progress_operations','annotations','reader_preferences'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy owner_read on public.%I for select to authenticated using (user_id=(select auth.uid()))',t);
 end loop;
end $$;

create function public.begin_book_upload(p_format text,p_filename text,p_size bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); b public.books; begin
 if u is null then raise exception 'Authentication required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,0));
 if p_format not in ('epub','pdf') or p_size not between 1 and 52428800 or length(p_filename) not between 1 and 500 then raise exception 'Invalid file'; end if;
 if (select coalesce(sum(byte_size),0) from public.books where user_id=u) + p_size > 536870912 then raise exception 'Your 512 MiB library limit has been reached. Delete a book or failed upload first.'; end if;
 if (select count(*) from public.books where user_id=u and status in ('uploading','validating'))>=3 then raise exception 'Finish or remove an existing upload first'; end if;
 insert into public.books(user_id,format,title,original_filename,byte_size) values(u,p_format,left(p_filename,500),p_filename,p_size) returning * into b;
 return to_jsonb(b);
end $$;

create function public.open_reader_session(p_book_id uuid,p_device_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.reader_sessions; p public.reading_progress; begin
 if not exists(select 1 from public.books where id=p_book_id and user_id=auth.uid() and status='ready') then raise exception 'Book unavailable'; end if;
 insert into public.reader_sessions(user_id,book_id,device_id) values(auth.uid(),p_book_id,p_device_id) returning * into s;
 select * into p from public.reading_progress where book_id=p_book_id;
 return jsonb_build_object('sessionId',s.id,'progress',to_jsonb(p));
end $$;

create function public.validate_reader_location(l jsonb,f text,pages integer)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if l is null or jsonb_typeof(l)<>'object' or l->>'type' is distinct from f or l->>'version' is distinct from '1' or jsonb_typeof(l->'version') is distinct from 'number' then return false; end if;
 if jsonb_typeof(l->'progression') is distinct from 'number' or (l->>'progression')::numeric not between 0 and 1 then return false; end if;
 if f='epub' then
  return jsonb_typeof(l->'cfi')='string' and length(l->>'cfi') between 10 and 4095 and l->>'cfi' like 'epubcfi(%)'
   and jsonb_typeof(l->'href')='string' and length(l->>'href')<2048
   and jsonb_typeof(l->'spineIndex')='number' and (l->>'spineIndex')::numeric>=0 and (l->>'spineIndex')::numeric=trunc((l->>'spineIndex')::numeric);
 end if;
 return jsonb_typeof(l->'page')='number' and (l->>'page')::numeric between 1 and pages
  and (l->>'page')::numeric=trunc((l->>'page')::numeric)
  and jsonb_typeof(l->'x')='number' and (l->>'x')::numeric between 0 and 1
  and jsonb_typeof(l->'y')='number' and (l->>'y')::numeric between 0 and 1;
exception when others then return false;
end $$;

create function public.save_progress(p_operation_id uuid,p_session_id uuid,p_sequence bigint,p_expected_revision bigint,p_location jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.reader_sessions; b public.books; p public.reading_progress; old public.progress_operations;
 result jsonb; payload jsonb; outcome text; begin
 select * into s from public.reader_sessions where id=p_session_id and user_id=auth.uid() for update;
 if not found then raise exception 'Session unavailable'; end if;
 payload:=jsonb_build_object('session',p_session_id,'sequence',p_sequence,'revision',p_expected_revision,'location',p_location);
 select * into old from public.progress_operations where operation_id=p_operation_id;
 if found then
  if old.user_id<>auth.uid() or old.payload<>payload then raise exception 'Operation ID reused'; end if;
  return old.result;
 end if;
 if s.last_seen_at < now()-interval '30 days' then raise exception 'Session expired; reopen the book'; end if;
 if p_sequence<1 or p_expected_revision<0 then raise exception 'Invalid sequence'; end if;
 if exists(select 1 from public.progress_operations where session_id=s.id and sequence=p_sequence) then raise exception 'Sequence reused'; end if;
 select * into b from public.books where id=s.book_id and user_id=auth.uid() and status='ready' for share;
 if not found then raise exception 'Book unavailable'; end if;
 if not coalesce(public.validate_reader_location(p_location,b.format,b.page_count),false) then raise exception 'Invalid location'; end if;
 select * into p from public.reading_progress where book_id=b.id for update;
 if not found then raise exception 'Progress unavailable'; end if;
 if p_sequence<=s.last_sequence then outcome:='stale';
 elsif p_expected_revision<>p.revision then outcome:='conflict';
 else
  update public.reading_progress set location=p_location,progression=(p_location->>'progression')::double precision,
   revision=revision+1,last_read_at=now() where book_id=b.id returning * into p;
  outcome:='accepted';
 end if;
 result:=jsonb_build_object('outcome',outcome,'progress',to_jsonb(p));
 update public.reader_sessions set last_sequence=greatest(last_sequence,p_sequence),last_seen_at=now() where id=s.id;
 insert into public.progress_operations(operation_id,user_id,book_id,session_id,sequence,payload,result)
 values(p_operation_id,auth.uid(),b.id,s.id,p_sequence,payload,result);
 return result;
end $$;

create function public.validate_annotation_anchor(a jsonb,f text,pages integer)
returns boolean language plpgsql immutable set search_path='' as $$
declare r jsonb; coordinate jsonb; begin
 if a is null or jsonb_typeof(a)<>'object' or a->>'type' is distinct from f or length(a::text)>20000 then return false; end if;
 if f='epub' then return jsonb_typeof(a->'cfi')='string' and length(a->>'cfi') between 10 and 4095 and a->>'cfi' like 'epubcfi(%)'; end if;
 if jsonb_typeof(a->'page') is distinct from 'number' or (a->>'page')::numeric not between 1 and pages or (a->>'page')::numeric<>trunc((a->>'page')::numeric) then return false; end if;
 if jsonb_typeof(a->'rects') is distinct from 'array' or jsonb_array_length(a->'rects')>500 then return false; end if;
 if a ? 'x' and (jsonb_typeof(a->'x') is distinct from 'number' or (a->>'x')::numeric not between 0 and 1) then return false; end if;
 if a ? 'y' and (jsonb_typeof(a->'y') is distinct from 'number' or (a->>'y')::numeric not between 0 and 1) then return false; end if;
 for r in select value from jsonb_array_elements(a->'rects') loop
  if jsonb_typeof(r)<>'array' or jsonb_array_length(r)<>4 then return false; end if;
  for coordinate in select value from jsonb_array_elements(r) loop
   if jsonb_typeof(coordinate)<>'number' or coordinate::text::numeric not between 0 and 1 then return false; end if;
  end loop;
  if (r->>0)::numeric>(r->>2)::numeric or (r->>1)::numeric>(r->>3)::numeric then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create function public.put_annotation(p_id uuid,p_book_id uuid,p_kind text,p_anchor jsonb,p_quote text,p_note text,p_expected_revision bigint default 0,p_deleted boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.books; a public.annotations; begin
 select * into b from public.books where id=p_book_id and user_id=auth.uid() and status='ready' for share;
 if not found then raise exception 'Book unavailable'; end if;
 if p_kind not in ('bookmark','highlight') or not coalesce(public.validate_annotation_anchor(p_anchor,b.format,b.page_count),false) then raise exception 'Invalid annotation'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 select * into a from public.annotations where id=p_id for update;
 if found then
  if a.user_id<>auth.uid() or a.book_id<>p_book_id then raise exception 'Annotation unavailable'; end if;
  if p_expected_revision=0 and a.kind=p_kind and a.anchor=p_anchor and a.quote is not distinct from p_quote and a.note is not distinct from p_note and not p_deleted then return to_jsonb(a); end if;
  if a.revision<>p_expected_revision then raise exception 'Annotation changed on another device. Reload and try again.'; end if;
  update public.annotations set anchor=p_anchor,quote=p_quote,note=p_note,revision=revision+1,updated_at=now(),deleted_at=case when p_deleted then now() else null end where id=p_id returning * into a;
 else
  if p_expected_revision<>0 or p_deleted then raise exception 'Annotation unavailable'; end if;
  insert into public.annotations(id,user_id,book_id,kind,anchor,quote,note) values(p_id,auth.uid(),p_book_id,p_kind,p_anchor,p_quote,p_note) returning * into a;
 end if;
 return to_jsonb(a);
end $$;

create function public.set_preferences(p_preferences jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not coalesce((jsonb_typeof(p_preferences)='object' and jsonb_typeof(p_preferences->'fontSize')='number' and jsonb_typeof(p_preferences->'lineHeight')='number'
 and p_preferences->>'theme' in ('light','dark','sepia') and p_preferences->>'font' in ('serif','sans-serif')
 and (p_preferences->>'fontSize')::numeric between 12 and 36 and (p_preferences->>'lineHeight')::numeric between 1.2 and 2.2),false) then raise exception 'Invalid preferences'; end if;
 insert into public.reader_preferences(user_id,preferences) values(auth.uid(),p_preferences)
 on conflict(user_id) do update set preferences=excluded.preferences,updated_at=now();
end $$;
create function public.update_book(p_book_id uuid,p_title text,p_author text,p_completed boolean default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if length(p_title) not between 1 and 500 or length(p_author)>500 then raise exception 'Invalid metadata'; end if;
 update public.books set title=p_title,author=p_author,updated_at=now() where id=p_book_id and user_id=auth.uid() and status='ready';
 if not found then raise exception 'Book unavailable'; end if;
 if p_completed is not null then update public.reading_progress set completed_at=case when p_completed then now() else null end where book_id=p_book_id; end if;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname in ('begin_book_upload','open_reader_session','save_progress','put_annotation','set_preferences','update_book','validate_reader_location','validate_annotation_anchor') loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  if f.signature::text not like '%validate_reader_location%' and f.signature::text not like '%validate_annotation_anchor%' then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('books','books',false,52428800,array['application/pdf','application/epub+zip','application/octet-stream']),
 ('covers','covers',false,2097152,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy original_insert on storage.objects for insert to authenticated with check(
 bucket_id='books' and exists(select 1 from public.books b where b.user_id=(select auth.uid()) and b.status='uploading'
 and storage.objects.name=b.user_id::text||'/'||b.id::text||'/original.'||b.format));
create policy original_read on storage.objects for select to authenticated using(
 bucket_id='books' and exists(select 1 from public.books b where b.user_id=(select auth.uid()) and b.status='ready'
 and storage.objects.name=b.user_id::text||'/'||b.id::text||'/original.'||b.format));
create policy cover_read on storage.objects for select to authenticated using(
 bucket_id='covers' and exists(select 1 from public.books b where b.user_id=(select auth.uid()) and b.status='ready' and storage.objects.name=b.cover_path));
