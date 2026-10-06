-- First connected slice: operator-owned drafts and private notice resources.
-- Project membership/shared operator access will need a separate migration.
create table if not exists public.notice_drafts (
  id text not null check (id ~ '^[a-zA-Z0-9-]{1,100}$'),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  payload jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.notice_resources (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  draft_id text,
  kind text not null check (kind in ('file', 'link')),
  label text not null check (length(label) between 1 and 160),
  url text,
  storage_path text,
  original_filename text,
  mime_type text,
  byte_size bigint check (byte_size >= 0),
  sha256 text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  check ((kind = 'link' and url is not null and storage_path is null) or
         (kind = 'file' and storage_path is not null and url is null)),
  foreign key (owner_id, draft_id) references public.notice_drafts(owner_id, id) on delete set null (draft_id)
);

create index if not exists notice_drafts_owner_idx on public.notice_drafts(owner_id);
create index if not exists notice_resources_owner_idx on public.notice_resources(owner_id);
create index if not exists notice_resources_draft_idx on public.notice_resources(draft_id);

alter table public.notice_drafts enable row level security;
alter table public.notice_resources enable row level security;
revoke all on public.notice_drafts, public.notice_resources from anon, authenticated;
grant select on public.notice_drafts, public.notice_resources to authenticated;
grant insert on public.notice_resources to authenticated;

drop policy if exists "Operators read own drafts" on public.notice_drafts;
drop policy if exists "Operators read own resources" on public.notice_resources;
drop policy if exists "Operators add own resources" on public.notice_resources;
create policy "Operators read own drafts" on public.notice_drafts
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Operators read own resources" on public.notice_resources
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Operators add own resources" on public.notice_resources
  for insert to authenticated with check (
    (select auth.uid()) = owner_id and
    (draft_id is null or exists (
      select 1 from public.notice_drafts d where d.id = draft_id and d.owner_id = (select auth.uid())
    )) and
    (kind <> 'file' or storage_path like (select auth.uid())::text || '/%')
  );

create or replace function public.save_notice_draft(
  p_id text,
  p_expected_version integer,
  p_payload jsonb
)
returns public.notice_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare saved public.notice_drafts;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = 'P0001';
  end if;
  if p_id !~ '^[a-zA-Z0-9-]{1,100}$' or p_expected_version < 0 or
     p_payload is null or jsonb_typeof(p_payload) <> 'object' or
     octet_length(p_payload::text) > 100000 then
    raise exception 'invalid_draft' using errcode = 'P0001';
  end if;
  if p_expected_version = 0 then
    insert into public.notice_drafts(id, owner_id, payload)
      values (p_id, (select auth.uid()), p_payload)
      on conflict (owner_id, id) do nothing returning * into saved;
  else
    update public.notice_drafts
       set payload = p_payload, version = version + 1, updated_at = now()
     where id = p_id and owner_id = (select auth.uid()) and version = p_expected_version
     returning * into saved;
  end if;
  if saved.id is null then
    raise exception 'draft_conflict' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;

revoke all on function public.save_notice_draft(text, integer, jsonb) from public, anon;
grant execute on function public.save_notice_draft(text, integer, jsonb) to authenticated;

create or replace function public.delete_notice_draft(p_id text, p_expected_version integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notice_drafts
   where id = p_id and owner_id = (select auth.uid()) and version = p_expected_version;
  if not found then
    raise exception 'draft_conflict' using errcode = 'P0001';
  end if;
  return true;
end;
$$;
revoke all on function public.delete_notice_draft(text, integer) from public, anon;
grant execute on function public.delete_notice_draft(text, integer) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notice-files', 'notice-files', false, 6000000,
        array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'text/plain','text/markdown','image/png','image/jpeg'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Operators upload own notice files" on storage.objects;
drop policy if exists "Operators read own notice files" on storage.objects;
drop policy if exists "Operators remove own notice files" on storage.objects;
create policy "Operators upload own notice files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'notice-files' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Operators read own notice files" on storage.objects
  for select to authenticated using (
    bucket_id = 'notice-files' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Operators remove own notice files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'notice-files' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
