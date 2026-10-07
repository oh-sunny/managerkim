-- Run only after deploying sync-sheets and creating BOTH Vault secrets:
--   sheet_sync_function_url = https://<project-ref>.supabase.co/functions/v1/sync-sheets
--   sheet_sync_service_key = the project's legacy service_role JWT (never commit its value)
-- Example: create these in Supabase Dashboard > Vault, not in this file.
-- Supabase Cron and pg_net must be enabled in Dashboard > Integrations.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name='sheet_sync_function_url')
    or not exists (select 1 from vault.decrypted_secrets where name='sheet_sync_service_key') then
    raise exception 'Create sheet_sync_function_url and sheet_sync_service_key in Vault first';
  end if;
  if exists (select 1 from cron.job where jobname='sheet-sync-hourly') then
    perform cron.unschedule('sheet-sync-hourly');
  end if;
end;
$$;

select cron.schedule(
  'sheet-sync-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='sheet_sync_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='sheet_sync_service_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name='sheet_sync_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
  $$
);
