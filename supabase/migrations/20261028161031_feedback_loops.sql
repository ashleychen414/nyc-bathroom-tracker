-- Feedback loops before sending the app out (Ashley, 2026-10-28):
-- 1. usage_events: an anonymous usage log, like location_events. One row per action (restroom page
--    opened, Directions, "I went here", forms opened / sent / cancelled), with the restroom, a
--    platform word, the app version and a random id per app open (session_id) so one visit's steps
--    can be followed. No user, phone id, coordinates or zip. Visitors only insert.
-- 2. "Something's wrong": reports gain "not here", "wrong spot" and "other", each with an optional
--    note (bathroom_edits.note). Notes never show in the public history; read them in
--    bathroom_reports (service role).
-- 3. feedback: free text from "Send feedback", anonymous, kept for later analysis. Visitors only insert.

-- ---------- 1. usage_events ----------

create table public.usage_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event text not null check (event in (
    'restroom_view', 'directions', 'went_here', 'rating_saved', 'fact_answer', 'confirm_answer',
    'edit_open', 'edit_save', 'edit_cancel',
    'report_open', 'report_send', 'report_cancel',
    'feedback_open', 'feedback_send', 'feedback_cancel')),
  place text check (place in ('page', 'map', 'list', 'sheet')),  -- where in the app it happened
  bathroom_id text check (char_length(bathroom_id) <= 64),      -- no foreign key: a deleted bathroom keeps its counts
  session_id uuid not null,                                      -- random per app open, never stored on the phone
  platform text not null check (platform in ('ios-safari', 'ios-homescreen', 'ios-other-browser', 'android', 'desktop', 'other')),
  app_version text check (app_version ~ '^[0-9A-Za-z._-]{1,40}$') -- short commit sha, 'dev' or 'rls-check'
);

comment on table public.usage_events is 'Anonymous usage log for NYC Poops (src/lib/usage-log.js): no user, phone id, coordinates or zip. session_id is random per app open. Insert-only for visitors; read with the service role via usage_events_daily / usage_by_restroom / usage_sessions.';

create index usage_events_created_at on public.usage_events (created_at);

alter table public.usage_events enable row level security;

create policy "Anyone adds usage events" on public.usage_events
  for insert to anon, authenticated with check (true);

revoke all on public.usage_events from anon, authenticated;
grant insert (event, place, bathroom_id, session_id, platform, app_version) on public.usage_events to anon, authenticated;

-- Reading it (service role / SQL editor). Days are New York days; rls-check rows are left out.
-- select * from usage_events_daily limit 50;
create view public.usage_events_daily with (security_invoker = true) as
select
  (created_at at time zone 'America/New_York')::date as day,
  event,
  count(*) as events,
  count(distinct session_id) as app_opens,
  count(distinct bathroom_id) as restrooms,
  string_agg(distinct platform, ', ') as platforms
from public.usage_events
where app_version is distinct from 'rls-check'
group by 1, 2
order by 1 desc, 3 desc;

-- Per restroom, last 30 days: how often it was looked at, navigated to and visited.
-- select * from usage_by_restroom limit 50;
create view public.usage_by_restroom with (security_invoker = true) as
select
  u.bathroom_id,
  b.name,
  count(*) filter (where event = 'restroom_view') as views,
  count(*) filter (where event = 'directions') as directions,
  count(*) filter (where event = 'went_here') as went_here,
  count(*) filter (where event in ('edit_save', 'report_send', 'fact_answer', 'confirm_answer')) as corrections,
  max(u.created_at) as last_at
from public.usage_events u
left join public.bathrooms b on b.id = u.bathroom_id
where u.bathroom_id is not null and u.created_at > now() - interval '30 days' and u.app_version is distinct from 'rls-check'
group by 1, 2
order by directions desc, views desc;

-- Per app open, last 30 days: the steps of one visit, so "Directions then I went here" can be counted.
-- select * from usage_sessions limit 50;
create view public.usage_sessions with (security_invoker = true) as
select
  session_id,
  min(created_at) as started_at,
  min(platform) as platform,
  count(*) filter (where event = 'restroom_view') as views,
  count(*) filter (where event = 'directions') as directions,
  count(*) filter (where event = 'went_here') as went_here,
  bool_or(event = 'directions') and bool_or(event = 'went_here') as directions_then_went,
  count(*) filter (where event like 'edit_%' or event like 'report_%' or event like 'feedback_%') as form_steps,
  string_agg(event, ' → ' order by created_at) as steps
from public.usage_events
where created_at > now() - interval '30 days' and app_version is distinct from 'rls-check'
group by session_id
order by started_at desc;

revoke all on public.usage_events_daily, public.usage_by_restroom, public.usage_sessions from anon, authenticated;

-- ---------- 2. "Something's wrong" ----------

alter table public.bathroom_edits
  add column note text check (char_length(note) <= 500),
  drop constraint bathroom_edits_kind_check,
  add constraint bathroom_edits_kind_check check (kind in (
    'edit', 'report_closed', 'report_not_here', 'report_wrong_spot', 'report_other', 'confirm_open', 'confirm_hours', 'fact'));

comment on column public.bathroom_edits.note is 'Optional short note with a "Something''s wrong" report. Never shown in bathroom_history(); read it in bathroom_reports.';

-- Same as before (20261026193541_bathroom_edits.sql), plus the new report kinds and a note. Only
-- "closed" changes what the app shows (two people → Reported closed); the others are for review.
drop function public.report_bathroom(text, uuid, text);
create function public.report_bathroom(p_bathroom_id text, p_device_id uuid, p_kind text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bathrooms;
  edit_id uuid;
  note text := nullif(btrim(p_note), '');
begin
  if p_kind is null or p_kind not in ('report_closed', 'report_not_here', 'report_wrong_spot', 'report_other', 'confirm_open', 'confirm_hours') then
    raise exception 'Unknown report' using errcode = 'check_violation';
  end if;
  if char_length(note) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = 'check_violation';
  end if;
  perform public.bathroom_edits_rate_check(p_device_id);
  select * into b from public.bathrooms where id = p_bathroom_id for update;
  if not found or not public.bathroom_is_shared(b) then
    raise exception 'No such bathroom' using errcode = 'P0002';
  end if;
  insert into public.bathroom_edits (bathroom_id, kind, device_id, note)
    values (p_bathroom_id, p_kind, p_device_id, case when p_kind like 'report_%' then note end)
    returning id into edit_id;
  if p_kind = 'report_closed' then
    perform public.bathrooms_recompute_closed(p_bathroom_id);
  end if;
  return public.bathroom_edit_result(edit_id, p_bathroom_id);
end;
$$;

revoke execute on function public.report_bathroom(text, uuid, text, text) from public;
grant execute on function public.report_bathroom(text, uuid, text, text) to anon, authenticated;

-- Reports to review (service role / SQL editor), newest first, with their notes.
-- select * from bathroom_reports limit 50;
create view public.bathroom_reports with (security_invoker = true) as
select
  e.created_at,
  replace(e.kind, 'report_', '') as report,
  e.bathroom_id,
  b.name,
  b.lat,
  b.lng,
  e.note,
  e.undone_at is not null as undone,
  coalesce(e.user_id::text, 'phone ' || left(e.device_id::text, 8)) as person
from public.bathroom_edits e
join public.bathrooms b on b.id = e.bathroom_id
where e.kind like 'report_%'
order by e.created_at desc;

revoke all on public.bathroom_reports from anon, authenticated;

-- Edits per person: the other reports too (new column at the end).
create or replace view public.bathroom_edits_per_person with (security_invoker = true) as
select
  coalesce(user_id::text, 'phone ' || left(device_id::text, 8)) as person,
  user_id is not null as signed_in,
  count(*) filter (where kind = 'edit') as edits,
  count(*) filter (where kind = 'report_closed') as reported_closed,
  count(*) filter (where kind in ('confirm_open', 'confirm_hours')) as confirmations,
  count(*) filter (where undone_at is not null) as undone,
  count(distinct bathroom_id) as bathrooms,
  min(created_at) as first_at,
  max(created_at) as last_at,
  count(*) filter (where kind = 'fact') as fact_answers,
  count(*) filter (where kind in ('report_not_here', 'report_wrong_spot', 'report_other')) as other_reports
from public.bathroom_edits
group by 1, 2
order by edits desc, last_at desc;

revoke all on public.bathroom_edits_per_person from anon, authenticated;

-- ---------- 3. feedback ----------

create table public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  bathroom_id text check (char_length(bathroom_id) <= 64),  -- the restroom page it was sent from, if any
  platform text not null check (platform in ('ios-safari', 'ios-homescreen', 'ios-other-browser', 'android', 'desktop', 'other')),
  app_version text check (app_version ~ '^[0-9A-Za-z._-]{1,40}$')
);

comment on table public.feedback is 'Free-text feedback from "Send feedback" (NYC Poops), anonymous: no user or phone id. Insert-only for visitors; read with the service role: select * from feedback_recent.';

create index feedback_created_at on public.feedback (created_at);

alter table public.feedback enable row level security;

create policy "Anyone sends feedback" on public.feedback
  for insert to anon, authenticated with check (true);

revoke all on public.feedback from anon, authenticated;
grant insert (message, bathroom_id, platform, app_version) on public.feedback to anon, authenticated;

-- select * from feedback_recent limit 50;
create view public.feedback_recent with (security_invoker = true) as
select f.created_at, f.message, f.bathroom_id, b.name, f.platform, f.app_version
from public.feedback f
left join public.bathrooms b on b.id = f.bathroom_id
where f.app_version is distinct from 'rls-check'
order by f.created_at desc;

revoke all on public.feedback_recent from anon, authenticated;
