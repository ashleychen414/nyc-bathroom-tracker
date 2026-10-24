-- Anonymous outcomes of "allow location" attempts (src/lib/location-log.js), so we can see per
-- platform whether location works and spot a deploy that breaks it. Database counts only, no
-- third-party analytics (decided 2026-10-14).
-- Holds only the columns below: no coordinates, accuracy, user id, zip or user agent string.
-- Anyone (signed in or not) can add a row; nobody but the service role can read, change or delete.
create table public.location_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  trigger text not null check (trigger in ('startup', 'button', 'welcome')),
  permission_before text not null check (permission_before in ('granted', 'prompt', 'denied', 'unknown')),
  result text not null check (result in ('granted', 'denied', 'timeout', 'unavailable', 'unsupported')),
  platform text not null check (platform in ('ios-safari', 'ios-homescreen', 'ios-other-browser', 'android', 'desktop', 'other')),
  app_version text check (app_version ~ '^[0-9A-Za-z._-]{1,40}$') -- short commit sha, or 'dev'
);

comment on table public.location_events is 'Anonymous location outcomes for NYC Poops (no coordinates, no user). Insert-only for visitors; read with the service role via location_events_daily / location_events_weekly.';

create index location_events_created_at on public.location_events (created_at);

alter table public.location_events enable row level security;

create policy "Anyone adds location events" on public.location_events
  for insert to anon, authenticated with check (true);

-- Visitors may only insert, and only these columns: id and created_at are set by the server.
revoke all on public.location_events from anon, authenticated;
grant insert (trigger, permission_before, result, platform, app_version) on public.location_events to anon, authenticated;

-- ---------- Reading it (service role / SQL editor only) ----------
-- Days are New York days. success_pct = granted / attempts. already_blocked = the site's
-- permission was already 'denied' before the attempt (at startup that's logged without asking).
-- Rows from the deploy check (app_version 'rls-check', scripts/check-rls.mjs) are left out.

create view public.location_events_daily with (security_invoker = true) as
select
  (created_at at time zone 'America/New_York')::date as day,
  platform,
  count(*) as attempts,
  round(100.0 * count(*) filter (where result = 'granted') / count(*), 1) as success_pct,
  count(*) filter (where result = 'granted') as granted,
  count(*) filter (where result = 'denied') as denied,
  count(*) filter (where result = 'timeout') as timeout,
  count(*) filter (where result = 'unavailable') as unavailable,
  count(*) filter (where result = 'unsupported') as unsupported,
  count(*) filter (where permission_before = 'denied') as already_blocked,
  string_agg(distinct app_version, ', ') as app_versions
from public.location_events
where app_version is distinct from 'rls-check'
group by 1, 2
order by 1 desc, 2;

-- Last 7 days against the 7 before them, per platform and for all platforms together.
-- success_change_pts is last week's success_pct minus the week before's.
create view public.location_events_weekly with (security_invoker = true) as
with recent as (
  select platform, result, permission_before,
    case when created_at >= now() - interval '7 days' then 'last 7 days' else 'previous 7 days' end as period
  from public.location_events
  where created_at >= now() - interval '14 days' and app_version is distinct from 'rls-check'
), counted as (
  select
    coalesce(platform, 'all') as platform,
    period,
    count(*) as attempts,
    round(100.0 * count(*) filter (where result = 'granted') / count(*), 1) as success_pct,
    count(*) filter (where result = 'granted') as granted,
    count(*) filter (where result = 'denied') as denied,
    count(*) filter (where result = 'timeout') as timeout,
    count(*) filter (where result = 'unavailable') as unavailable,
    count(*) filter (where result = 'unsupported') as unsupported,
    count(*) filter (where permission_before = 'denied') as already_blocked
  from recent
  group by grouping sets ((platform, period), (period))
)
select
  platform, period, attempts, success_pct,
  success_pct - lag(success_pct) over (partition by platform order by period desc) as success_change_pts,
  granted, denied, timeout, unavailable, unsupported, already_blocked
from counted
order by platform = 'all' desc, platform, period desc;

revoke all on public.location_events_daily, public.location_events_weekly from anon, authenticated;
