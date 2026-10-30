-- Public door codes (Ashley, 2026-10-27: "Door codes are public"). A bathroom's code is a public
-- note anyone can see, and anyone can add, change or clear through edit_bathroom(), like name, hours
-- and access: signed in or not, with history, undo and the 60-an-hour limit
-- (20261026193541_bathroom_edits.sql).
-- - code_confirmed_at: when this exact code was last added or confirmed ("Code still works?",
--   report_bathroom(..., 'confirm_code')), worked out from the history so undo keeps it right.
-- - The nightly sync never touches it: sync_seed_bathrooms() only sets the city's own columns.
-- - Owners can't write it directly either (their column grants don't include it); only the
--   functions below do. Codes people wrote in their private notes are never copied here.

-- ---------- bathrooms: code ----------

alter table public.bathrooms
  add column code text
    check (code is null or (char_length(code) between 1 and 40 and code = btrim(code) and code !~ '[\r\n]')),
  add column code_confirmed_at timestamptz;

comment on column public.bathrooms.code is 'Door code, public (Ashley, 2026-10-27). Set only through edit_bathroom(); the nightly sync never touches it. Up to 40 characters, one line.';
comment on column public.bathrooms.code_confirmed_at is 'When this exact code was last added or confirmed ("Code still works?"). Kept by bathrooms_recompute_code(); null when there is no code.';

-- ---------- bathroom_edits: "Code still works?" ----------

-- confirm_code carries the code it confirmed (changes = { code }), so a confirmation only counts
-- for that code, even after undos.
alter table public.bathroom_edits
  drop constraint bathroom_edits_kind_check,
  add constraint bathroom_edits_kind_check check (kind in ('edit', 'report_closed', 'confirm_open', 'confirm_hours', 'fact', 'confirm_code')),
  drop constraint bathroom_edits_check,
  add constraint bathroom_edits_check check ((kind in ('edit', 'fact', 'confirm_code')) = (changes is not null));

comment on column public.bathroom_edits.kind is 'edit, report_closed, confirm_open, confirm_hours, fact (an answer to a fact: changes = { fact, value, count }, value null = "Not sure"; can''t be undone), or confirm_code ("Code still works?": changes = { code }).';

-- Sets code_confirmed_at: the latest edit or confirmation, not undone, that gave this exact code.
create function public.bathrooms_recompute_code(p_bathroom_id text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  current_code text;
  current_value timestamptz;
  new_value timestamptz;
begin
  select code, code_confirmed_at into current_code, current_value from public.bathrooms where id = p_bathroom_id;
  if current_code is not null then
    select max(created_at) into new_value from public.bathroom_edits
      where bathroom_id = p_bathroom_id and undone_at is null and kind in ('edit', 'confirm_code')
        and changes->>'code' = current_code;
  end if;
  if new_value is distinct from current_value then
    update public.bathrooms set code_confirmed_at = new_value where id = p_bathroom_id;
  end if;
end;
$$;

revoke execute on function public.bathrooms_recompute_code(text) from public, anon, authenticated;

-- What the app needs back after a change: as before, plus the code.
create or replace function public.bathroom_edit_result(p_edit_id uuid, p_bathroom_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'editId', p_edit_id,
    'bathroom', jsonb_build_object('id', b.id, 'name', b.name, 'hours', b.hours, 'access', b.access,
      'userFields', to_jsonb(b.user_fields), 'reportedClosedAt', b.reported_closed_at,
      'code', b.code, 'codeConfirmedAt', b.code_confirmed_at))
  from public.bathrooms b where b.id = p_bathroom_id
$$;

-- ---------- edit_bathroom(): code too ----------

-- As before (20261026193541_bathroom_edits.sql), plus code: text, trimmed, up to 40 characters,
-- one line; empty or null clears it. A code isn't a city field, so it isn't added to user_fields.
create or replace function public.edit_bathroom(p_bathroom_id text, p_device_id uuid, p_changes jsonb)
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
  new_code text;
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
  if exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('name', 'hours', 'access', 'open', 'code')) then
    raise exception 'Only name, hours, access, open and code can be edited' using errcode = 'check_violation';
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
  if p_changes ? 'code' then
    if jsonb_typeof(p_changes->'code') not in ('string', 'null') then
      raise exception 'A code is text' using errcode = 'check_violation';
    end if;
    new_code := nullif(btrim(p_changes->>'code'), '');
    if new_code ~ '[\r\n]' or char_length(new_code) > 40 then
      raise exception 'A code is one line of up to 40 characters' using errcode = 'check_violation';
    end if;
    if new_code is distinct from b.code then
      changes := changes || jsonb_build_object('code', new_code);
      previous := previous || jsonb_build_object('code', b.code);
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

  -- Corrected fields stop following the city data. open only matters against the city's own
  -- status; code isn't in the city data.
  fields := array(
    select distinct f from unnest(b.user_fields || array(
      select k from jsonb_object_keys(changes) k
      where k in ('name', 'hours', 'access') or (k = 'open' and public.city_says_closed(b)))) f
    order by f);

  update public.bathrooms set
    name = case when changes ? 'name' then changes->>'name' else name end,
    hours = case when changes ? 'hours' then nullif(changes->'hours', 'null'::jsonb) else hours end,
    access = case when changes ? 'access' then changes->>'access' else access end,
    code = case when changes ? 'code' then changes->>'code' else code end,
    user_fields = fields
  where id = p_bathroom_id;

  insert into public.bathroom_edits (bathroom_id, kind, changes, previous, device_id)
    values (p_bathroom_id, 'edit', changes, previous, p_device_id)
    returning id into edit_id;
  perform public.bathrooms_recompute_closed(p_bathroom_id);
  perform public.bathrooms_recompute_code(p_bathroom_id);
  return public.bathroom_edit_result(edit_id, p_bathroom_id);
end;
$$;

-- ---------- report_bathroom(): "Code still works?" too ----------

create or replace function public.report_bathroom(p_bathroom_id text, p_device_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bathrooms;
  edit_id uuid;
begin
  if p_kind is null or p_kind not in ('report_closed', 'confirm_open', 'confirm_hours', 'confirm_code') then
    raise exception 'Unknown report' using errcode = 'check_violation';
  end if;
  perform public.bathroom_edits_rate_check(p_device_id);
  select * into b from public.bathrooms where id = p_bathroom_id for update;
  if not found or not public.bathroom_is_shared(b) then
    raise exception 'No such bathroom' using errcode = 'P0002';
  end if;
  if p_kind = 'confirm_code' and b.code is null then
    raise exception 'There''s no code to confirm' using errcode = 'check_violation';
  end if;
  insert into public.bathroom_edits (bathroom_id, kind, changes, device_id)
    values (p_bathroom_id, p_kind, case when p_kind = 'confirm_code' then jsonb_build_object('code', b.code) end, p_device_id)
    returning id into edit_id;
  if p_kind = 'report_closed' then
    perform public.bathrooms_recompute_closed(p_bathroom_id);
  elsif p_kind = 'confirm_code' then
    perform public.bathrooms_recompute_code(p_bathroom_id);
  end if;
  return public.bathroom_edit_result(edit_id, p_bathroom_id);
end;
$$;

-- ---------- undo_bathroom_edit(): code too ----------

-- As in 20261026195435_bathroom_facts.sql, plus: undoing a code edit restores the code before,
-- and undoing anything recomputes when the code was last confirmed.
create or replace function public.undo_bathroom_edit(p_edit_id uuid, p_device_id uuid)
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
  if e.kind = 'fact' then
    raise exception 'Answers can''t be undone. Change your answer instead.' using errcode = 'check_violation';
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
      code = case when e.changes ? 'code' then e.previous->>'code' else code end,
      -- A field this edit marked as corrected goes back to following the city data.
      user_fields = array(select f from unnest(b.user_fields) f where not (f = any (keys)) or f = any (before_fields))
    where id = e.bathroom_id;
  end if;

  update public.bathroom_edits set undone_at = clock_timestamp(), undone_by = auth.uid() where id = p_edit_id;
  perform public.bathrooms_recompute_closed(e.bathroom_id);
  perform public.bathrooms_recompute_code(e.bathroom_id);
  return public.bathroom_edit_result(p_edit_id, e.bathroom_id);
end;
$$;

-- ---------- edits per person: code confirmations count as confirmations ----------

create or replace view public.bathroom_edits_per_person with (security_invoker = true) as
select
  coalesce(user_id::text, 'phone ' || left(device_id::text, 8)) as person,
  user_id is not null as signed_in,
  count(*) filter (where kind = 'edit') as edits,
  count(*) filter (where kind = 'report_closed') as reported_closed,
  count(*) filter (where kind in ('confirm_open', 'confirm_hours', 'confirm_code')) as confirmations,
  count(*) filter (where undone_at is not null) as undone,
  count(distinct bathroom_id) as bathrooms,
  min(created_at) as first_at,
  max(created_at) as last_at,
  count(*) filter (where kind = 'fact') as fact_answers
from public.bathroom_edits
group by 1, 2
order by edits desc, last_at desc;

revoke all on public.bathroom_edits_per_person from anon, authenticated;
