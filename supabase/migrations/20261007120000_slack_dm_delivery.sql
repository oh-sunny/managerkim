-- One immutable approval can be claimed for one delivery attempt. Outcomes are
-- append-only; a missing outcome after a crash means unknown, never safe to retry.
create table public.send_approvals (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  payload jsonb not null,
  ticket_id text generated always as (payload->>'ticketId') stored,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object' and length(payload->>'ticketId') between 1 and 100)
);
create table public.send_attempts (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  approval_id uuid not null unique references public.send_approvals(id),
  ticket_id text not null,
  source_checked_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (owner_id,ticket_id)
);
create table public.send_results (
  attempt_id uuid not null references public.send_attempts(id),
  owner_id uuid not null references auth.users(id) on delete cascade,
  employee_id integer not null,
  status text not null check (status in ('success','failed','unknown')),
  stage text not null,
  reason text,
  slack_user_id text,
  channel_id text,
  slack_ts text,
  recorded_at timestamptz not null default now(),
  primary key (attempt_id, employee_id)
);
create index send_approvals_owner_idx on public.send_approvals(owner_id);
create index send_attempts_owner_idx on public.send_attempts(owner_id);
create index send_results_owner_idx on public.send_results(owner_id);
alter table public.send_approvals enable row level security;
alter table public.send_attempts enable row level security;
alter table public.send_results enable row level security;
revoke all on public.send_approvals, public.send_attempts, public.send_results from anon, authenticated;
grant select on public.send_approvals to authenticated;
grant select on public.send_attempts, public.send_results to authenticated;
create policy "Owners read approvals" on public.send_approvals for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners read attempts" on public.send_attempts for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners read results" on public.send_results for select to authenticated using ((select auth.uid()) = owner_id);

create function public.claim_send_attempt(p_owner_id uuid, p_id uuid, p_approval_id uuid, p_source_checked_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare approval_owner uuid; approval_ticket text;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select owner_id,ticket_id into approval_owner,approval_ticket from public.send_approvals
   where id = p_approval_id and owner_id = p_owner_id;
  if approval_owner is null then raise exception 'approval_not_found'; end if;
  if p_source_checked_at is null then raise exception 'source_check_required'; end if;
  insert into public.send_attempts(id,owner_id,approval_id,ticket_id,source_checked_at)
    values (p_id,approval_owner,p_approval_id,approval_ticket,p_source_checked_at) on conflict do nothing;
  return found;
end;
$$;
revoke all on function public.claim_send_attempt(uuid,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_send_attempt(uuid,uuid,uuid,timestamptz) to service_role;

create function public.record_send_result(
  p_owner_id uuid,p_attempt_id uuid,p_employee_id integer,p_status text,p_stage text,p_reason text,
  p_slack_user_id text,p_channel_id text,p_slack_ts text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare target_approval uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('success','failed','unknown') or
     length(p_stage) > 30 or length(coalesce(p_reason,'')) > 100 or
     length(coalesce(p_slack_user_id,'')) > 100 or length(coalesce(p_channel_id,'')) > 100 or
     length(coalesce(p_slack_ts,'')) > 100 then raise exception 'invalid_result'; end if;
  select approval_id into target_approval from public.send_attempts
   where id = p_attempt_id and owner_id = p_owner_id;
  if target_approval is null then raise exception 'attempt_not_found'; end if;
  if not exists (select 1 from public.send_approvals a,
      jsonb_array_elements(a.payload->'recipients') r
      where a.id = target_approval and a.owner_id = p_owner_id
        and (r->>'employeeId')::integer = p_employee_id) then
    raise exception 'recipient_not_approved';
  end if;
  insert into public.send_results(attempt_id,owner_id,employee_id,status,stage,reason,slack_user_id,channel_id,slack_ts)
    values (p_attempt_id,p_owner_id,p_employee_id,p_status,p_stage,p_reason,p_slack_user_id,p_channel_id,p_slack_ts)
    on conflict do nothing;
  return found;
end;
$$;
revoke all on function public.record_send_result(uuid,uuid,integer,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_send_result(uuid,uuid,integer,text,text,text,text,text,text) to service_role;

create function public.reject_send_mutation() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'send_audit_is_append_only';
end;
$$;
create trigger immutable_send_approvals before update or delete on public.send_approvals
  for each row execute function public.reject_send_mutation();
create trigger immutable_send_attempts before update or delete on public.send_attempts
  for each row execute function public.reject_send_mutation();
create trigger immutable_send_results before update or delete on public.send_results
  for each row execute function public.reject_send_mutation();
revoke all on function public.reject_send_mutation() from public, anon, authenticated;
