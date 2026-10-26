-- Tier 1: facts (smaller E5). Four facts per bathroom, each answered with a tap:
--   accessible:     full | partial | none
--   layout:         single | singles | stalls | mixed  (+ how many, for singles and stalls)
--   changing_table: yes | no
--   code:           yes | no   (a code or key is needed)
-- Decided by majority (Ashley, 2026-10-26): each person's latest answer counts once, and the
-- city's value (from source_data, worked out in the app) counts as one more. The app picks the
-- winner from bathroom_fact_counts(); a tie goes to the newest answer.
-- Anyone can answer, signed in or not, like edits (20261026193541_bathroom_edits.sql): answers are
-- logged in bathroom_edits as kind 'fact', so they show in the history, count per person and
-- share the hourly limit. They aren't undone: people change their answer, or answer "Not sure".
-- Old stall counts from visits are left as they are for now (Ashley, 2026-10-26).

-- ---------- bathroom_fact_answers ----------

create table public.bathroom_fact_answers (
  id uuid primary key default gen_random_uuid(),
  bathroom_id text not null references public.bathrooms (id) on delete cascade,
  fact text not null check (fact in ('accessible', 'layout', 'changing_table', 'code')),
  value text not null,
  count smallint check (count between 1 and 50),  -- layout: how many single bathrooms, or stalls
  user_id uuid references auth.users (id) on delete set null,
  device_id uuid not null,
  answered_at timestamptz not null default clock_timestamp(),
  check (
    (fact = 'accessible' and value in ('full', 'partial', 'none') and count is null)
    or (fact = 'layout' and value in ('single', 'singles', 'stalls', 'mixed')
        and (count is null or (value = 'singles' and count >= 2) or value = 'stalls'))
    or (fact in ('changing_table', 'code') and value in ('yes', 'no') and count is null)
  )
);

comment on table public.bathroom_fact_answers is 'Each person''s current answer to a bathroom fact (NYC Poops, Tier 1 facts). One row per person per fact, kept by answer_fact(). Read only as counts, through bathroom_fact_counts().';

create index bathroom_fact_answers_bathroom_idx on public.bathroom_fact_answers (bathroom_id, fact);
create index bathroom_fact_answers_person_idx on public.bathroom_fact_answers (bathroom_id, fact, device_id);

alter table public.bathroom_fact_answers enable row level security;
-- No policies and no privileges: answer_fact() and bathroom_fact_counts() are the only way in.
revoke all on public.bathroom_fact_answers from anon, authenticated;

-- ---------- bathroom_edits: answers show in the history ----------

alter table public.bathroom_edits
  drop constraint bathroom_edits_kind_check,
  add constraint bathroom_edits_kind_check check (kind in ('edit', 'report_closed', 'confirm_open', 'confirm_hours', 'fact')),
  drop constraint bathroom_edits_check,
  add constraint bathroom_edits_check check ((kind in ('edit', 'fact')) = (changes is not null));

comment on column public.bathroom_edits.kind is 'edit, report_closed, confirm_open, confirm_hours, or fact (an answer to a fact: changes = { fact, value, count }, value null = "Not sure"). Facts can''t be undone.';

-- ---------- answer_fact() ----------

-- p_value null = "Not sure": takes back your answer. Your new answer replaces your old one (same
-- account, or the same phone while signed out). Returns the counts for this bathroom, in the shape
-- of bathroom_fact_counts().
create function public.answer_fact(p_bathroom_id text, p_device_id uuid, p_fact text, p_value text, p_count integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bathrooms;
  me uuid := auth.uid();
  n smallint := case when p_fact = 'layout' and p_value in ('singles', 'stalls') then p_count end;
begin
  perform public.bathroom_edits_rate_check(p_device_id);
  select * into b from public.bathrooms where id = p_bathroom_id for update;
  if not found or not public.bathroom_is_shared(b) then
    raise exception 'No such bathroom' using errcode = 'P0002';
  end if;
  if p_fact is null or p_fact not in ('accessible', 'layout', 'changing_table', 'code') then
    raise exception 'Unknown fact' using errcode = 'check_violation';
  end if;

  delete from public.bathroom_fact_answers
    where bathroom_id = p_bathroom_id and fact = p_fact
      and ((me is not null and user_id = me) or (user_id is null and device_id = p_device_id));
  if p_value is not null then
    -- The table's check refuses values and counts outside the lists.
    insert into public.bathroom_fact_answers (bathroom_id, fact, value, count, user_id, device_id)
      values (p_bathroom_id, p_fact, p_value, n, me, p_device_id);
  end if;

  insert into public.bathroom_edits (bathroom_id, kind, changes, device_id)
    values (p_bathroom_id, 'fact', jsonb_build_object('fact', p_fact, 'value', p_value, 'count', n), p_device_id);

  return coalesce((select jsonb_agg(to_jsonb(c)) from public.bathroom_fact_counts() c where c.bathroom_id = p_bathroom_id), '[]'::jsonb);
end;
$$;

-- ---------- bathroom_fact_counts(): counts only ----------

-- One row per Public bathroom, fact and value that people answered: how many people, when the
-- latest of them answered (for ties), and the latest count given with it. Never who.
create function public.bathroom_fact_counts()
returns table (bathroom_id text, fact text, value text, people integer, last_at timestamptz, count smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select a.bathroom_id, a.fact, a.value, count(*)::int, max(a.answered_at),
    (array_agg(a.count order by a.answered_at desc) filter (where a.count is not null))[1]
  from public.bathroom_fact_answers a
  join public.bathrooms b on b.id = a.bathroom_id
  where public.bathroom_is_shared(b)
  group by a.bathroom_id, a.fact, a.value
$$;

revoke execute on function public.answer_fact(text, uuid, text, text, integer) from public;
revoke execute on function public.bathroom_fact_counts() from public;
grant execute on function public.answer_fact(text, uuid, text, text, integer) to anon, authenticated;
grant execute on function public.bathroom_fact_counts() to anon, authenticated;

-- ---------- undo and history: answers can't be undone ----------

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
      -- A field this edit marked as corrected goes back to following the city data.
      user_fields = array(select f from unnest(b.user_fields) f where not (f = any (keys)) or f = any (before_fields))
    where id = e.bathroom_id;
  end if;

  update public.bathroom_edits set undone_at = clock_timestamp(), undone_by = auth.uid() where id = p_edit_id;
  perform public.bathrooms_recompute_closed(e.bathroom_id);
  return public.bathroom_edit_result(p_edit_id, e.bathroom_id);
end;
$$;

create or replace function public.bathroom_history(p_bathroom_id text, p_device_id uuid default null)
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
    e.kind <> 'fact' and e.undone_at is null and (mine.v or public.is_admin()) and not public.bathroom_edit_superseded(e)
  from public.bathroom_edits e
  join public.bathrooms b on b.id = e.bathroom_id
  cross join lateral (select (e.user_id is not null and e.user_id = auth.uid())
                             or (p_device_id is not null and e.device_id = p_device_id) as v) mine
  where e.bathroom_id = p_bathroom_id and public.bathroom_is_shared(b)
  order by e.created_at desc
  limit 20
$$;

-- ---------- edits per person: answers too ----------

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
  count(*) filter (where kind = 'fact') as fact_answers
from public.bathroom_edits
group by 1, 2
order by edits desc, last_at desc;

revoke all on public.bathroom_edits_per_person from anon, authenticated;
