-- Tier 1: confirm and correct any bathroom (smaller E7).
-- - bathroom_edits: one row per edit, report or confirmation, kept as history. Edits go live right
--   away (no review queue) and can be undone by whoever made them, or by an admin.
-- - Anyone can edit, signed in or not (Ashley, 2026-10-26). Each row carries the signed-in user, or
--   else a random id the phone made for itself (device_id), so edits can be counted per person
--   (bathroom_edits_per_person, service role only) and undone from the same phone.
-- - Editable: name, hours, access, and "it's open again". Hours a user enters count as source
--   hours (they can show "Open").
-- - Two different people reporting a bathroom closed set reported_closed_at; only an edit
--   ("it's open again") clears it (Ashley, 2026-10-26).
-- - The nightly sync stops overwriting fields a user corrected (user_fields).
-- Everything goes through the functions below; nobody reads or writes bathroom_edits directly.
-- Decided 2026-10-26 in docs/DECISIONS.md ("Organize the remaining epics around the data") and in
-- this PR ("Confirm and correct").

-- ---------- bathrooms: corrected fields, reported closed ----------

alter table public.bathrooms
  add column user_fields text[] not null default '{}'
    check (user_fields <@ array['name', 'hours', 'access', 'open']),
  add column reported_closed_at timestamptz;

comment on column public.bathrooms.user_fields is 'Fields a user corrected (edit_bathroom): the nightly sync leaves them alone. open = a user said a restroom the city lists as closed is open; the app then ignores the city''s status and season. hours = user hours, which also skip the Seasonal rule.';
comment on column public.bathrooms.reported_closed_at is 'Set when two different people report it closed (since the last "it''s open again" edit); the app shows it closed. Cleared only by that edit, or by undoing a report.';

-- ---------- bathroom_edits ----------

create table public.bathroom_edits (
  id uuid primary key default gen_random_uuid(),
  bathroom_id text not null references public.bathrooms (id) on delete cascade,
  -- edit: changed name / hours / access / open. report_closed: "It was closed" / "Report closed".
  -- confirm_open: "Was it open? Yes". confirm_hours: "Hours right? Yes".
  kind text not null check (kind in ('edit', 'report_closed', 'confirm_open', 'confirm_hours')),
  changes jsonb,   -- edit: the new values ({ name?, hours?, access?, open? })
  previous jsonb,  -- edit: the values before, plus _user_fields (the bathroom's user_fields before), for undo
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  device_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),  -- not now(): orders changes made in one transaction
  undone_at timestamptz,
  undone_by uuid references auth.users (id) on delete set null,  -- null when undone signed out
  check ((kind = 'edit') = (changes is not null))
);

comment on table public.bathroom_edits is 'History of edits, reports and confirmations on bathrooms (NYC Poops, Tier 1). Written only through edit_bathroom(), report_bathroom() and undo_bathroom_edit(); read through bathroom_history(). device_id is a random id per phone, never shown to anyone.';

create index bathroom_edits_bathroom_idx on public.bathroom_edits (bathroom_id, created_at);
create index bathroom_edits_device_idx on public.bathroom_edits (device_id, created_at);
create index bathroom_edits_user_idx on public.bathroom_edits (user_id, created_at) where user_id is not null;

alter table public.bathroom_edits enable row level security;
-- No policies and no privileges: the functions below (security definer) are the only way in.
revoke all on public.bathroom_edits from anon, authenticated;

-- ---------- helpers (not callable by visitors) ----------

-- The same bathrooms anyone can read (the bathrooms read policy, minus "your own").
create function public.bathroom_is_shared(b public.bathrooms)
returns boolean
language sql
immutable
set search_path = ''
as $$ select b.visibility = 'public' and b.deleted_at is null and (b.source = 'seed' or b.status not in ('removed', 'merged')) $$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

-- At most 60 edits, reports and confirmations per person per hour.
create function public.bathroom_edits_rate_check(p_device_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_device_id is null then
    raise exception 'A device id is needed' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.bathroom_edits
      where created_at > now() - interval '1 hour'
        and (device_id = p_device_id or (auth.uid() is not null and user_id = auth.uid()))) >= 60 then
    raise exception 'Too many edits in the last hour. Try again later.' using errcode = 'program_limit_exceeded';
  end if;
end;
$$;

-- [startMinute, endMinute], end after start, ending by 4am the next day at the latest.
create function public.valid_hours_range(r jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- case, not and: SQL doesn't promise to stop at the first false, and jsonb_array_length throws on a non-array.
  select case
    when jsonb_typeof(r) is distinct from 'array' then false
    when jsonb_array_length(r) <> 2 then false
    when jsonb_typeof(r->0) <> 'number' or jsonb_typeof(r->1) <> 'number' then false
    else (r->>0)::numeric between 0 and 1439 and (r->>1)::numeric > (r->>0)::numeric
      and (r->>1)::numeric <= 1440 + 240
  end
$$;

-- The structured hours model in src/lib/hours.js (null = unknown).
create function public.valid_hours(h jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when h is null or h = 'null'::jsonb then true
    when jsonb_typeof(h) <> 'object' then false
    when h->>'kind' = 'always' then true
    when h->>'kind' = 'minimum' then public.valid_hours_range(h->'range')
    when h->>'kind' is distinct from 'weekly' then false
    when jsonb_typeof(h->'days') is distinct from 'array' then false
    when jsonb_array_length(h->'days') <> 7 then false
    -- Each day: null (unknown), or an array of ranges ([] = closed).
    when exists (select 1 from jsonb_array_elements(h->'days') d where jsonb_typeof(d) not in ('null', 'array')) then false
    else not exists (
      select 1 from jsonb_array_elements(h->'days') d
      cross join lateral jsonb_array_elements(case when jsonb_typeof(d) = 'array' then d else '[]'::jsonb end) r
      where not public.valid_hours_range(r))
  end
$$;

-- Does the city list it as closed (Not Operational, Closed for Construction, not open yet)?
create function public.city_says_closed(b public.bathrooms)
returns boolean
language sql
immutable
set search_path = ''
as $$ select b.source = 'seed' and (coalesce(b.source_data->>'status', '') <> 'Operational' or coalesce(b.source_data->>'season', '') = 'Future') $$;

-- Sets or clears reported_closed_at: closed once two different people (signed-in user, else phone)
-- reported it closed since the last "it's open again" edit, counting only reports not undone.
create function public.bathrooms_recompute_closed(p_bathroom_id text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  since timestamptz;
  people integer;
  second_report timestamptz;
  current_value timestamptz;
  new_value timestamptz;
begin
  select max(created_at) into since from public.bathroom_edits
    where bathroom_id = p_bathroom_id and kind = 'edit' and undone_at is null and changes ? 'open';
  select count(distinct coalesce(user_id::text, device_id::text)), max(created_at) into people, second_report
    from public.bathroom_edits
    where bathroom_id = p_bathroom_id and kind = 'report_closed' and undone_at is null
      and (since is null or created_at > since);
  select reported_closed_at into current_value from public.bathrooms where id = p_bathroom_id;
  new_value := case when people >= 2 then coalesce(current_value, second_report) end;
  if new_value is distinct from current_value then
    update public.bathrooms set reported_closed_at = new_value where id = p_bathroom_id;
  end if;
end;
$$;

revoke execute on function public.bathroom_is_shared(public.bathrooms) from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.bathroom_edits_rate_check(uuid) from public, anon, authenticated;
revoke execute on function public.valid_hours(jsonb) from public, anon, authenticated;
revoke execute on function public.valid_hours_range(jsonb) from public, anon, authenticated;
revoke execute on function public.city_says_closed(public.bathrooms) from public, anon, authenticated;
revoke execute on function public.bathrooms_recompute_closed(text) from public, anon, authenticated;

-- What the app needs back after a change, in its own field names (bathrooms-source.js).
create function public.bathroom_edit_result(p_edit_id uuid, p_bathroom_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'editId', p_edit_id,
    'bathroom', jsonb_build_object('id', b.id, 'name', b.name, 'hours', b.hours, 'access', b.access,
      'userFields', to_jsonb(b.user_fields), 'reportedClosedAt', b.reported_closed_at))
  from public.bathrooms b where b.id = p_bathroom_id
$$;

revoke execute on function public.bathroom_edit_result(uuid, text) from public, anon, authenticated;

-- ---------- edit_bathroom(): "Suggest an edit" and the fix form ----------

-- p_changes: any of { name: text, hours: hours model or null, access: 'public' | 'customers_only'
-- | 'key_or_code' | 'unknown', open: true }. open is only for a restroom shown closed (reported
-- closed, or closed in the city data). Values equal to what's there already are dropped; nothing
-- left to change is an error.
create function public.edit_bathroom(p_bathroom_id text, p_device_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bathrooms;
  changes jsonb := '{}';
  previous jsonb;
  fields text[];
  edit_id uuid;
begin
  perform public.bathroom_edits_rate_check(p_device_id);
  select * into b from public.bathrooms where id = p_bathroom_id for update;
  if not found or not public.bathroom_is_shared(b) then
    raise exception 'No such bathroom' using errcode = 'P0002';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Nothing to change' using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('name', 'hours', 'access', 'open')) then
    raise exception 'Only name, hours, access and open can be edited' using errcode = 'check_violation';
  end if;
  previous := jsonb_build_object('_user_fields', to_jsonb(b.user_fields));

  if p_changes ? 'name' then
    if jsonb_typeof(p_changes->'name') <> 'string' or char_length(btrim(p_changes->>'name')) not between 1 and 200 then
      raise exception 'A name needs 1 to 200 characters' using errcode = 'check_violation';
    end if;
    if btrim(p_changes->>'name') <> b.name then
      changes := changes || jsonb_build_object('name', btrim(p_changes->>'name'));
      previous := previous || jsonb_build_object('name', b.name);
    end if;
  end if;
  if p_changes ? 'hours' then
    if not public.valid_hours(p_changes->'hours') then
      raise exception 'Hours aren''t in the expected shape' using errcode = 'check_violation';
    end if;
    if nullif(p_changes->'hours', 'null'::jsonb) is distinct from b.hours then
      changes := changes || jsonb_build_object('hours', p_changes->'hours');
      previous := previous || jsonb_build_object('hours', coalesce(b.hours, 'null'::jsonb));
    end if;
  end if;
  if p_changes ? 'access' then
    if p_changes->>'access' is null or p_changes->>'access' not in ('public', 'customers_only', 'key_or_code', 'unknown') then
      raise exception 'Unknown access value' using errcode = 'check_violation';
    end if;
    if p_changes->>'access' <> b.access then
      changes := changes || jsonb_build_object('access', p_changes->>'access');
      previous := previous || jsonb_build_object('access', b.access);
    end if;
  end if;
  if p_changes ? 'open' then
    if p_changes->'open' <> 'true'::jsonb then
      raise exception 'open can only be true' using errcode = 'check_violation';
    end if;
    if b.reported_closed_at is null and not (public.city_says_closed(b) and not 'open' = any (b.user_fields)) then
      raise exception 'It isn''t marked closed' using errcode = 'check_violation';
    end if;
    changes := changes || '{"open": true}';
    previous := previous || jsonb_build_object('reported_closed_at', b.reported_closed_at);
  end if;
  if changes = '{}' then
    raise exception 'Nothing to change' using errcode = 'check_violation';
  end if;

  -- Corrected fields stop following the city data. open only matters against the city's own status.
  fields := array(
    select distinct f from unnest(b.user_fields || array(
      select k from jsonb_object_keys(changes) k where k <> 'open' or public.city_says_closed(b))) f
    order by f);

  update public.bathrooms set
    name = case when changes ? 'name' then changes->>'name' else name end,
    hours = case when changes ? 'hours' then nullif(changes->'hours', 'null'::jsonb) else hours end,
    access = case when changes ? 'access' then changes->>'access' else access end,
    user_fields = fields
  where id = p_bathroom_id;

  insert into public.bathroom_edits (bathroom_id, kind, changes, previous, device_id)
    values (p_bathroom_id, 'edit', changes, previous, p_device_id)
    returning id into edit_id;
  perform public.bathrooms_recompute_closed(p_bathroom_id);
  return public.bathroom_edit_result(edit_id, p_bathroom_id);
end;
$$;

-- ---------- report_bathroom(): closed, was open, hours right ----------

create function public.report_bathroom(p_bathroom_id text, p_device_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bathrooms;
  edit_id uuid;
begin
  if p_kind is null or p_kind not in ('report_closed', 'confirm_open', 'confirm_hours') then
    raise exception 'Unknown report' using errcode = 'check_violation';
  end if;
  perform public.bathroom_edits_rate_check(p_device_id);
  select * into b from public.bathrooms where id = p_bathroom_id for update;
  if not found or not public.bathroom_is_shared(b) then
    raise exception 'No such bathroom' using errcode = 'P0002';
  end if;
  insert into public.bathroom_edits (bathroom_id, kind, device_id)
    values (p_bathroom_id, p_kind, p_device_id)
    returning id into edit_id;
  if p_kind = 'report_closed' then
    perform public.bathrooms_recompute_closed(p_bathroom_id);
  end if;
  return public.bathroom_edit_result(edit_id, p_bathroom_id);
end;
$$;

-- ---------- undo_bathroom_edit() ----------

-- Whoever made it (same account, or same phone) or an admin. An edit can't be undone once a later
-- edit changed one of the same fields: that one has to be undone first, or edited over.
create function public.bathroom_edit_superseded(e public.bathroom_edits)
returns boolean
language sql
stable
set search_path = ''
as $$
  select e.kind = 'edit' and exists (
    select 1 from public.bathroom_edits l
    where l.bathroom_id = e.bathroom_id and l.kind = 'edit' and l.undone_at is null
      and l.created_at > e.created_at and l.changes ?| array(select jsonb_object_keys(e.changes)))
$$;

revoke execute on function public.bathroom_edit_superseded(public.bathroom_edits) from public, anon, authenticated;

create function public.undo_bathroom_edit(p_edit_id uuid, p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.bathroom_edits;
  b public.bathrooms;
  keys text[];
  before_fields text[];
begin
  select * into e from public.bathroom_edits where id = p_edit_id for update;
  if not found or e.undone_at is not null then
    raise exception 'Nothing to undo' using errcode = 'P0002';
  end if;
  if not ((e.user_id is not null and e.user_id = auth.uid())
          or (p_device_id is not null and e.device_id = p_device_id)
          or public.is_admin()) then
    raise exception 'Only the person who made this change can undo it' using errcode = 'insufficient_privilege';
  end if;
  select * into b from public.bathrooms where id = e.bathroom_id for update;

  if e.kind = 'edit' then
    if public.bathroom_edit_superseded(e) then
      raise exception 'Someone changed this since. Edit it instead.' using errcode = 'object_not_in_prerequisite_state';
    end if;
    keys := array(select jsonb_object_keys(e.changes));
    before_fields := array(select jsonb_array_elements_text(e.previous->'_user_fields'));
    -- A city field that wasn't corrected before goes back to what the city says now (the nightly
    -- sync may have updated source_data since); anything else goes back to the value before.
    update public.bathrooms set
      name = case
        when not e.changes ? 'name' then name
        when b.source = 'seed' and not 'name' = any (before_fields) then coalesce(b.source_data->>'name', e.previous->>'name')
        else e.previous->>'name' end,
      hours = case
        when not e.changes ? 'hours' then hours
        when b.source = 'seed' and not 'hours' = any (before_fields) then nullif(b.source_data->'hours', 'null'::jsonb)
        else nullif(e.previous->'hours', 'null'::jsonb) end,
      access = case when e.changes ? 'access' then e.previous->>'access' else access end,
      -- A field this edit marked as corrected goes back to following the city data.
      user_fields = array(select f from unnest(b.user_fields) f where not (f = any (keys)) or f = any (before_fields))
    where id = e.bathroom_id;
  end if;

  update public.bathroom_edits set undone_at = clock_timestamp(), undone_by = auth.uid() where id = p_edit_id;
  perform public.bathrooms_recompute_closed(e.bathroom_id);
  return public.bathroom_edit_result(p_edit_id, e.bathroom_id);
end;
$$;

-- ---------- bathroom_history(): what changed, never who ----------

-- The latest 20 edits and reports on a bathroom. mine = made by you (this account or this phone);
-- can_undo = you may undo it now.
create function public.bathroom_history(p_bathroom_id text, p_device_id uuid default null)
returns table (
  id uuid,
  kind text,
  changes jsonb,
  previous jsonb,
  created_at timestamptz,
  undone boolean,
  mine boolean,
  can_undo boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.kind, e.changes, e.previous - '_user_fields', e.created_at, e.undone_at is not null,
    mine.v,
    e.undone_at is null and (mine.v or public.is_admin()) and not public.bathroom_edit_superseded(e)
  from public.bathroom_edits e
  join public.bathrooms b on b.id = e.bathroom_id
  cross join lateral (select (e.user_id is not null and e.user_id = auth.uid())
                             or (p_device_id is not null and e.device_id = p_device_id) as v) mine
  where e.bathroom_id = p_bathroom_id and public.bathroom_is_shared(b)
  order by e.created_at desc
  limit 20
$$;

revoke execute on function public.edit_bathroom(text, uuid, jsonb) from public;
revoke execute on function public.report_bathroom(text, uuid, text) from public;
revoke execute on function public.undo_bathroom_edit(uuid, uuid) from public;
revoke execute on function public.bathroom_history(text, uuid) from public;
grant execute on function public.edit_bathroom(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.report_bathroom(text, uuid, text) to anon, authenticated;
grant execute on function public.undo_bathroom_edit(uuid, uuid) to anon, authenticated;
grant execute on function public.bathroom_history(text, uuid) to anon, authenticated;

-- ---------- edits per person (service role / SQL editor only) ----------

-- select * from bathroom_edits_per_person;
-- person: the account id, or "phone " + the start of the phone's random id when signed out.
create view public.bathroom_edits_per_person with (security_invoker = true) as
select
  coalesce(user_id::text, 'phone ' || left(device_id::text, 8)) as person,
  user_id is not null as signed_in,
  count(*) filter (where kind = 'edit') as edits,
  count(*) filter (where kind = 'report_closed') as reported_closed,
  count(*) filter (where kind in ('confirm_open', 'confirm_hours')) as confirmations,
  count(*) filter (where undone_at is not null) as undone,
  count(distinct bathroom_id) as bathrooms,
  min(created_at) as first_at,
  max(created_at) as last_at
from public.bathroom_edits
group by 1, 2
order by edits desc, last_at desc;

revoke all on public.bathroom_edits_per_person from anon, authenticated;

-- ---------- nightly sync: leave corrected fields alone ----------

-- As before (20261014192910_create_bathrooms.sql), except name and hours keep a user's correction
-- (user_fields). access was already never touched on existing rows.
create or replace function public.sync_seed_bathrooms(rows jsonb, mark_missing boolean default true)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  incoming integer;
  loaded integer;
  n_inserted integer;
  n_updated integer;
  n_missing integer := 0;
begin
  drop table if exists pg_temp.seed_rows;
  create temp table seed_rows on commit drop as
    select distinct on (r->>'id') r->>'id' as id, jsonb_strip_nulls(r) as r
    from jsonb_array_elements(rows) as r
    order by r->>'id', (r->>'status' = 'Operational'), jsonb_strip_nulls(r)::text;
  select count(*) into incoming from pg_temp.seed_rows;
  if incoming = 0 then
    raise exception 'No rows given';
  end if;
  select count(*) into loaded from public.bathrooms where source = 'seed' and source_removed_at is null;
  if mark_missing and incoming < loaded * 0.9 then
    raise exception 'Refusing to sync % rows when % are loaded (more than 10%% would be marked missing)', incoming, loaded;
  end if;

  with upserted as (
    insert into public.bathrooms as b (id, name, venue_type, access, source, borough, lat, lng, hours, hours_reviewed, source_data)
    select
      s.id,
      r->>'name',
      case r->>'type'
        when 'Park' then 'park'
        when 'Library' then 'library'
        when 'Transit' then 'transit'
        when 'Public Plaza' then 'plaza'
        when 'Privately Owned Public Space' then 'pops'
        else 'other'
      end,
      'public', -- city-listed public restrooms (POPS are public by law)
      'seed',
      r->>'borough',
      (r->>'lat')::double precision,
      (r->>'lng')::double precision,
      nullif(r->'hours', 'null'::jsonb),
      coalesce((r->>'hoursReviewed')::boolean, false),
      r
    from pg_temp.seed_rows as s
    on conflict (id) do update set
      name = case when 'name' = any (b.user_fields) then b.name else excluded.name end,
      venue_type = excluded.venue_type,
      borough = excluded.borough,
      lat = excluded.lat,
      lng = excluded.lng,
      hours = case when 'hours' = any (b.user_fields) then b.hours else excluded.hours end,
      hours_reviewed = case when 'hours' = any (b.user_fields) then b.hours_reviewed else excluded.hours_reviewed end,
      source_data = excluded.source_data,
      source_removed_at = null
    where b.source = 'seed'
      and (b.source_data is distinct from excluded.source_data or b.source_removed_at is not null)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into n_inserted, n_updated from upserted;

  if mark_missing then
    update public.bathrooms
      set source_removed_at = now()
      where source = 'seed'
        and source_removed_at is null
        and id not in (select id from pg_temp.seed_rows);
    get diagnostics n_missing = row_count;
  end if;

  return jsonb_build_object('received', jsonb_array_length(rows), 'unique', incoming, 'inserted', n_inserted, 'updated', n_updated, 'marked_missing', n_missing);
end;
$$;
