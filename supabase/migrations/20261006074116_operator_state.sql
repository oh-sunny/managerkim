-- Operator-owned operational state. Every accepted revision is retained for audit.
create table if not exists public.operator_states (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.operator_state_revisions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  payload jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (owner_id, version)
);

alter table public.operator_states enable row level security;
alter table public.operator_state_revisions enable row level security;
revoke all on public.operator_states, public.operator_state_revisions from anon, authenticated;
grant select on public.operator_states, public.operator_state_revisions to authenticated;
create policy "Operators read own state" on public.operator_states
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Operators read own revisions" on public.operator_state_revisions
  for select to authenticated using ((select auth.uid()) = owner_id);

create or replace function public.save_operator_state(p_expected_version integer, p_payload jsonb)
returns public.operator_states
language plpgsql
security definer
set search_path = ''
as $$
declare saved public.operator_states;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = 'P0001';
  end if;
  if p_expected_version is null or p_expected_version < 0 or
     p_payload is null or jsonb_typeof(p_payload) <> 'object' or
     octet_length(p_payload::text) > 2000000 then
    raise exception 'invalid_operator_state' using errcode = 'P0001';
  end if;
  if p_expected_version = 0 then
    insert into public.operator_states(owner_id, payload)
      values ((select auth.uid()), p_payload)
      on conflict (owner_id) do nothing returning * into saved;
  else
    update public.operator_states
       set payload = p_payload, version = version + 1, updated_at = now()
     where owner_id = (select auth.uid()) and version = p_expected_version
     returning * into saved;
  end if;
  if saved.owner_id is null then
    raise exception 'operator_state_conflict' using errcode = 'P0001';
  end if;
  insert into public.operator_state_revisions(owner_id, version, payload)
    values (saved.owner_id, saved.version, saved.payload);
  return saved;
end;
$$;
revoke all on function public.save_operator_state(integer, jsonb) from public, anon;
grant execute on function public.save_operator_state(integer, jsonb) to authenticated;
