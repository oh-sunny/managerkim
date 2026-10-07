-- SPEC 003: distinguish reusable project notice material from material for
-- one ticket. Rows remain insert-only for authenticated clients, so a record
-- can retain the exact resource revision used when it was simulated.
alter table public.notice_resources
  add column if not exists project_id text,
  add column if not exists ticket_id text,
  add column if not exists scope text not null default 'notice',
  add column if not exists resource_family_id uuid,
  add column if not exists previous_resource_id uuid;

update public.notice_resources
   set resource_family_id = id
 where resource_family_id is null;

create or replace function public.notice_resource_revision_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
declare prior public.notice_resources;
begin
  if new.resource_family_id is null then new.resource_family_id := new.id; end if;
  if new.previous_resource_id is null then
    if new.version <> 1 or new.resource_family_id <> new.id then
      raise exception 'invalid_resource_revision' using errcode = 'P0001';
    end if;
  else
    select * into prior from public.notice_resources where id = new.previous_resource_id;
    if prior.id is null or prior.owner_id <> new.owner_id or
       prior.resource_family_id <> new.resource_family_id or
       prior.project_id is distinct from new.project_id or prior.scope <> new.scope or
       prior.version + 1 <> new.version then
      raise exception 'invalid_resource_revision' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notice_resource_revision_defaults on public.notice_resources;
create trigger notice_resource_revision_defaults
before insert on public.notice_resources
for each row execute function public.notice_resource_revision_defaults();

alter table public.notice_resources
  alter column resource_family_id set not null,
  add constraint notice_resource_scope_check check (scope in ('project', 'notice')),
  add constraint notice_resource_project_check check (
    project_id is null or project_id ~ '^[a-zA-Z0-9-]{1,100}$'
  ),
  add constraint notice_resource_ticket_check check (
    ticket_id is null or ticket_id ~ '^[a-zA-Z0-9-]{1,100}$'
  ),
  add constraint notice_resource_project_scope_check check (
    scope <> 'project' or (project_id is not null and ticket_id is null and draft_id is null)
  ),
  add constraint notice_resource_notice_scope_check check (
    project_id is null or scope <> 'notice' or ticket_id is not null
  ),
  add constraint notice_resource_previous_fk foreign key (previous_resource_id)
    references public.notice_resources(id);

create index if not exists notice_resources_project_idx
  on public.notice_resources(owner_id, project_id, scope);
create index if not exists notice_resources_family_idx
  on public.notice_resources(owner_id, resource_family_id, version desc);
