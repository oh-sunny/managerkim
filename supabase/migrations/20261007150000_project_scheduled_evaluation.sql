-- Evaluate every saved project, including projects without a Sheet connection.
-- A failed Sheet read may commit time-only proposals but cannot replace the last
-- verified source snapshot or derive application counts and recipients from it.
alter table public.sheet_sync_runs
  add column if not exists source_checked_at timestamptz,
  add column if not exists evaluated_count integer,
  add column if not exists blocked_count integer;

create or replace function public.commit_scheduled_evaluation(
  p_owner_id uuid,
  p_expected_version integer,
  p_snapshot jsonb,
  p_source_hash text,
  p_tickets jsonb,
  p_retired_keys text[],
  p_source_status text,
  p_error_code text,
  p_evaluated_count integer,
  p_blocked_count integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_state public.operator_states;
  new_event_count integer := 0;
  changed_ticket_count integer := 0;
  retired_ticket_count integer := 0;
  checked_at timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_owner_id is null or p_expected_version is null or
    p_tickets is null or jsonb_typeof(p_tickets) <> 'array' or
    p_retired_keys is null or p_source_status is null or
    p_source_status not in ('success','error','not-connected') or
    p_evaluated_count is null or p_evaluated_count < 0 or
    p_blocked_count is null or p_blocked_count < 0 or
    length(coalesce(p_error_code,'')) > 160 then
    raise exception 'invalid_scheduled_evaluation' using errcode = '22023';
  end if;
  select * into current_state from public.operator_states
    where owner_id = p_owner_id for update;
  if current_state.owner_id is null or current_state.version <> p_expected_version then
    raise exception 'operator_state_conflict' using errcode = '40001';
  end if;
  if p_source_status = 'success' then
    if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' or
      jsonb_typeof(p_snapshot->'events') <> 'array' or
      jsonb_typeof(p_snapshot->'employees') <> 'array' or
      p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$' or
      coalesce(p_snapshot->'sync'->>'status','') <> 'success' then
      raise exception 'invalid_sheet_snapshot' using errcode = '22023';
    end if;
    checked_at := (p_snapshot->'sync'->>'lastSuccessAt')::timestamptz;
    if checked_at is null or checked_at > now() + interval '5 minutes' then
      raise exception 'invalid_source_time' using errcode = '22023';
    end if;
    if exists (select 1 from public.sheet_sync_snapshots prior
      where prior.owner_id = p_owner_id and prior.last_success_at > checked_at) then
      raise exception 'stale_sheet_snapshot' using errcode = '40001';
    end if;
    -- Accepted Sheet events are immutable. A later source read may only append.
    if exists (
      select 1 from public.sheet_application_events prior
      left join lateral (
        select incoming.value from jsonb_array_elements(p_snapshot->'events') incoming(value)
        where incoming.value->>'sourceEventId' = prior.source_event_id limit 1
      ) current_event on true
      where prior.owner_id = p_owner_id and
        (current_event.value is null or current_event.value is distinct from prior.payload)
    ) then
      raise exception 'source_event_history_changed' using errcode = '22023';
    end if;
    insert into public.sheet_sync_snapshots(owner_id,payload,source_hash,last_success_at)
    values (p_owner_id,p_snapshot,p_source_hash,checked_at)
    on conflict (owner_id) do update set payload=excluded.payload,
      source_hash=excluded.source_hash,last_success_at=excluded.last_success_at,
      updated_at=now()
    where public.sheet_sync_snapshots.last_success_at <= excluded.last_success_at;

    insert into public.sheet_application_events
      (owner_id,source_event_id,project_id,employee_id,status,occurred_at,payload)
    select p_owner_id,event->>'sourceEventId',event->>'projectId',
      (event->>'employeeId')::bigint,event->>'status',
      (event->>'occurredAt')::timestamptz,event
    from jsonb_array_elements(p_snapshot->'events') event
    on conflict (owner_id,source_event_id) do nothing;
    get diagnostics new_event_count = row_count;
  elsif p_snapshot is not null or p_source_hash is not null then
    raise exception 'unverified_snapshot_must_be_null' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_tickets) ticket
    where jsonb_typeof(ticket) <> 'object' or
      coalesce(ticket->>'key','') = '' or coalesce(ticket->>'project','') = '' or
      coalesce(ticket->>'state','') not in ('pending','scheduled','deferred') or
      not exists (select 1 from jsonb_array_elements(current_state.payload->'projects') project
        where project->>'id' = ticket->>'project')
  ) or exists (
    select 1 from jsonb_array_elements(p_tickets) ticket
    group by ticket->>'key' having count(*) > 1
  ) then
    raise exception 'invalid_scheduled_tickets' using errcode = '22023';
  end if;
  insert into public.automation_tickets(owner_id,key,project_id,state,payload)
  select p_owner_id,ticket->>'key',ticket->>'project',ticket->>'state',ticket
  from jsonb_array_elements(p_tickets) ticket
  on conflict (owner_id,key) do update set project_id=excluded.project_id,
    state=excluded.state,payload=excluded.payload,updated_at=now()
  where public.automation_tickets.state in ('pending','scheduled','deferred') and
    public.automation_tickets.payload is distinct from excluded.payload;
  get diagnostics changed_ticket_count = row_count;

  update public.automation_tickets set state='retired',
    payload=jsonb_set(payload,'{state}','"retired"'::jsonb),updated_at=now()
  where owner_id=p_owner_id and key=any(p_retired_keys) and
    state in ('pending','scheduled','deferred');
  get diagnostics retired_ticket_count = row_count;

  insert into public.sheet_sync_runs(owner_id,status,employee_count,event_count,
    ticket_count,error_code,source_checked_at,evaluated_count,blocked_count)
  values (p_owner_id,
    case when p_source_status = 'error' or p_error_code is not null then 'error' else 'success' end,
    case when p_snapshot is null then null else jsonb_array_length(p_snapshot->'employees') end,
    new_event_count,changed_ticket_count,p_error_code,checked_at,
    p_evaluated_count,p_blocked_count);
  return jsonb_build_object('newEvents',new_event_count,
    'changedTickets',changed_ticket_count,'retiredTickets',retired_ticket_count);
end;
$$;
revoke all on function public.commit_scheduled_evaluation(uuid,integer,jsonb,text,jsonb,text[],text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commit_scheduled_evaluation(uuid,integer,jsonb,text,jsonb,text[],text,text,integer,integer)
  to service_role;
