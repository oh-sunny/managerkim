-- The scheduled worker owns source snapshots and proposals. Operators can read their own rows.
-- Operational edits and draft approvals continue to use their existing versioned tables.
create table if not exists public.sheet_sync_snapshots (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  source_hash text not null,
  last_success_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sheet_application_events (
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_event_id text not null,
  project_id text not null,
  employee_id bigint not null,
  status text not null check (status in ('applied', 'confirmed', 'cancelled')),
  occurred_at timestamptz not null,
  payload jsonb not null,
  primary key (owner_id, source_event_id)
);
create index if not exists sheet_application_events_project_time_idx
  on public.sheet_application_events(owner_id, project_id, occurred_at desc);

create table if not exists public.automation_tickets (
  owner_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  project_id text not null,
  state text not null check (state in ('pending','scheduled','deferred','dismissed','retired','done')),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);
create index if not exists automation_tickets_project_idx on public.automation_tickets(owner_id, project_id);

create table if not exists public.sheet_sync_runs (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  finished_at timestamptz not null default now(),
  status text not null check (status in ('success','error')),
  employee_count integer,
  event_count integer,
  ticket_count integer,
  error_code text
);
create index if not exists sheet_sync_runs_owner_time_idx on public.sheet_sync_runs(owner_id, finished_at desc);

alter table public.sheet_sync_snapshots enable row level security;
alter table public.sheet_application_events enable row level security;
alter table public.automation_tickets enable row level security;
alter table public.sheet_sync_runs enable row level security;
revoke all on public.sheet_sync_snapshots, public.sheet_application_events,
  public.automation_tickets, public.sheet_sync_runs from anon, authenticated;
grant select on public.sheet_sync_snapshots, public.sheet_application_events,
  public.automation_tickets, public.sheet_sync_runs to authenticated;
grant all on public.sheet_sync_snapshots, public.sheet_application_events,
  public.automation_tickets, public.sheet_sync_runs to service_role;
grant usage, select on sequence public.sheet_sync_runs_id_seq to service_role;
grant select on public.operator_states to service_role;

create policy "Read own sheet snapshot" on public.sheet_sync_snapshots
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Read own sheet events" on public.sheet_application_events
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Read own automation tickets" on public.automation_tickets
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Read own sync runs" on public.sheet_sync_runs
  for select to authenticated using ((select auth.uid()) = owner_id);

create or replace function public.commit_sheet_sync(
  p_owner_id uuid,
  p_snapshot jsonb,
  p_source_hash text,
  p_tickets jsonb,
  p_retired_keys text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_count integer;
  ticket_count integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_owner_id is null or p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or jsonb_typeof(p_snapshot->'events') <> 'array'
    or jsonb_typeof(p_snapshot->'employees') <> 'array'
    or jsonb_typeof(p_tickets) <> 'array'
    or length(p_source_hash) <> 64 then
    raise exception 'invalid_sheet_sync' using errcode = '22023';
  end if;
  -- An accepted source event is immutable. A later read may only append events.
  if exists (
    select 1
    from public.sheet_application_events prior
    left join lateral (
      select incoming.value
      from jsonb_array_elements(p_snapshot->'events') incoming(value)
      where incoming.value->>'sourceEventId' = prior.source_event_id
      limit 1
    ) current_event on true
    where prior.owner_id = p_owner_id
      and (current_event.value is null or current_event.value is distinct from prior.payload)
  ) then
    raise exception 'source_event_history_changed' using errcode = '22023';
  end if;

  insert into public.sheet_sync_snapshots(owner_id,payload,source_hash,last_success_at)
  values (p_owner_id,p_snapshot,p_source_hash,(p_snapshot->'sync'->>'lastSuccessAt')::timestamptz)
  on conflict (owner_id) do update set payload=excluded.payload,
    source_hash=excluded.source_hash,last_success_at=excluded.last_success_at,updated_at=now();

  insert into public.sheet_application_events
    (owner_id,source_event_id,project_id,employee_id,status,occurred_at,payload)
  select p_owner_id,event->>'sourceEventId',event->>'projectId',
    (event->>'employeeId')::bigint,event->>'status',
    (event->>'occurredAt')::timestamptz,event
  from jsonb_array_elements(p_snapshot->'events') event
  on conflict (owner_id,source_event_id) do nothing;
  get diagnostics event_count = row_count;

  insert into public.automation_tickets(owner_id,key,project_id,state,payload)
  select p_owner_id,ticket->>'key',ticket->>'project',ticket->>'state',ticket
  from jsonb_array_elements(p_tickets) ticket
  on conflict (owner_id,key) do update set project_id=excluded.project_id,
    state=excluded.state,payload=excluded.payload,updated_at=now()
  where public.automation_tickets.payload is distinct from excluded.payload;
  get diagnostics ticket_count = row_count;

  update public.automation_tickets set state='retired',
    payload=jsonb_set(payload,'{state}','"retired"'::jsonb),updated_at=now()
  where owner_id=p_owner_id and key=any(p_retired_keys)
    and state in ('pending','scheduled','deferred');

  insert into public.sheet_sync_runs(owner_id,status,employee_count,event_count,ticket_count)
  values (p_owner_id,'success',jsonb_array_length(p_snapshot->'employees'),event_count,ticket_count);
  return jsonb_build_object('newEvents',event_count,'changedTickets',ticket_count);
end;
$$;
revoke all on function public.commit_sheet_sync(uuid,jsonb,text,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.commit_sheet_sync(uuid,jsonb,text,jsonb,text[]) to service_role;
