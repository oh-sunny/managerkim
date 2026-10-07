-- Required by supabase/cron-hourly.sql to schedule the Edge Function HTTP call.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
