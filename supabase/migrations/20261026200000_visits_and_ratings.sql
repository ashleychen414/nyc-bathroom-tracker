-- E3: visits and ratings.
-- - visits: one row per "I went here" (no limit on how many), with that visit's optional ratings
--   (Clean, Getting in, Vibes, 1–5), the chips tapped as problems, and the old log fields that
--   chips open (smell, trash cans, lighting: 1–5; stalls: a count).
-- - Everyone reads only their own visits. Others see counts through bathroom_stats(), which never
--   returns anything per person. Its minimum number of people is one setting, stats_min_people()
--   (1 for now, Ashley 2026-10-26), so it can be raised later by replacing that one function.
-- - The old ratings in the read-only places table carry over as past visits by their owner.
-- Decided 2026-10-24 ("Visits and ratings") and 2026-10-26 ("Rating chips, and what needs an
-- account") in docs/DECISIONS.md.

-- ---------- visits ----------

create table public.visits (
  id uuid primary key default gen_random_uuid(),  -- made by the phone, so a visit logged signed out uploads once
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bathroom_id text not null references public.bathrooms (id) on delete cascade,
  visited_at timestamptz not null,  -- set by the phone (a visit made signed out uploads later); never in the future
  clean smallint check (clean between 1 and 5),
  get_in smallint check (get_in between 1 and 5),
  vibes smallint check (vibes between 1 and 5),
  -- Chips tapped as problems. Clean: dirty, smell, trash. Getting in: code, buy, wait, find, stalls.
  -- Vibes: lighting, music.
  chips text[] not null default '{}'
    check (chips <@ array['dirty', 'smell', 'trash', 'code', 'buy', 'wait', 'find', 'stalls', 'lighting', 'music']),
  -- The old log fields, opened from their chips.
  smell smallint check (smell between 1 and 5),
  trash smallint check (trash between 1 and 5),
  lighting smallint check (lighting between 1 and 5),
  stall_count smallint check (stall_count between 1 and 50),
  source text not null default 'app' check (source in ('app', 'carried_over')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()   -- set by the phone: newer edit wins, as list_items
);

comment on table public.visits is 'Visits ("I went here") with optional ratings (NYC Poops, E3). No limit per person or day. Each person reads only their own; others see bathroom_stats().';
comment on column public.visits.chips is 'Chips tapped as problems (below 5 stars). code and buy become facts ("Code needed", "Purchase needed") once enough people tap them (stats_min_people()). Codes themselves only go in private notes.';
comment on column public.visits.source is 'app: logged in the app. carried_over: an old rating from places (before E3).';

create index visits_bathroom_id_idx on public.visits (bathroom_id);
create index visits_user_id_idx on public.visits (user_id);

-- A visit can't be dated in the future (the phone sets the time, so a wrong clock is clamped).
create function public.visits_no_future()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.visited_at > now() then
    new.visited_at := now();
  end if;
  return new;
end;
$$;

create trigger visits_no_future before insert or update of visited_at on public.visits
  for each row execute function public.visits_no_future();

alter table public.visits enable row level security;

create policy "Users read their own visits" on public.visits
  for select to authenticated using ((select auth.uid()) = user_id);

-- Only bathrooms you can see (the subquery runs with your RLS, so someone else's Private
-- bathroom can't be visited even if its id is known).
create policy "Users add their own visits" on public.visits
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.bathrooms b where b.id = bathroom_id)
  );

create policy "Users update their own visits" on public.visits
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete for now. user_id comes from the session (no column privilege), source stays 'app'.
-- id, bathroom_id and visited_at are in the update list because the app saves with an upsert
-- (on id); the policy keeps it to your own rows.
revoke all on public.visits from anon, authenticated;
grant select on public.visits to authenticated;
grant insert (id, bathroom_id, visited_at, clean, get_in, vibes, chips, smell, trash, lighting, stall_count, updated_at) on public.visits to authenticated;
grant update (id, bathroom_id, visited_at, clean, get_in, vibes, chips, smell, trash, lighting, stall_count, updated_at) on public.visits to authenticated;

-- ---------- bathroom_stats(): counts only ----------

-- The minimum number of different people before a bathroom's visits, averages and facts show.
-- 1 for now (Ashley, 2026-10-26). To raise it, replace this function; nothing else changes.
create function public.stats_min_people()
returns integer
language sql
immutable
set search_path = ''
as $$ select 1 $$;

-- One row per Public bathroom visited by at least stats_min_people() different people:
--   people (different people, not visits), visits, last_visit (a New York date, no time),
--   per rating: the average and how many people rated it, counting each person's latest rating
--   once (null under stats_min_people()),
--   chips: how many people tapped each chip on their latest visit that rated its dimension,
--   facts: 'code' / 'buy' once at least stats_min_people() people tapped them ("Code needed",
--   "Purchase needed").
-- Nothing per person comes out.
-- security definer: it reads every visit to count them; callers still can't read visits.
create function public.bathroom_stats()
returns table (
  bathroom_id text,
  people integer,
  visits integer,
  last_visit date,
  clean numeric, clean_people integer,
  get_in numeric, get_in_people integer,
  vibes numeric, vibes_people integer,
  chips jsonb,
  facts text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with shown as (
    select v.bathroom_id, count(distinct v.user_id)::int as people, count(*)::int as visits,
      max(v.visited_at at time zone 'America/New_York')::date as last_visit
    from public.visits v
    join public.bathrooms b on b.id = v.bathroom_id
    where b.visibility = 'public' and b.status not in ('removed', 'merged') and b.deleted_at is null
    group by v.bathroom_id
    having count(distinct v.user_id) >= public.stats_min_people()
  ),
  -- Each person's latest visit that rated each dimension.
  latest as (
    select distinct on (v.bathroom_id, v.user_id, d.dim)
      v.bathroom_id, d.dim, d.rating, v.chips
    from public.visits v
    join shown s using (bathroom_id)
    cross join lateral (values ('clean', v.clean), ('get_in', v.get_in), ('vibes', v.vibes)) as d (dim, rating)
    where d.rating is not null
    order by v.bathroom_id, v.user_id, d.dim, v.visited_at desc
  ),
  ratings as (
    select bathroom_id,
      avg(rating) filter (where dim = 'clean') as clean, count(*) filter (where dim = 'clean')::int as clean_people,
      avg(rating) filter (where dim = 'get_in') as get_in, count(*) filter (where dim = 'get_in')::int as get_in_people,
      avg(rating) filter (where dim = 'vibes') as vibes, count(*) filter (where dim = 'vibes')::int as vibes_people
    from latest
    group by bathroom_id
  ),
  -- A chip counts from the visit that rated its own dimension.
  chip_counts as (
    select bathroom_id, jsonb_object_agg(chip, n) as chips
    from (
      select l.bathroom_id, c.chip, count(*)::int as n
      from latest l
      cross join lateral unnest(l.chips) as c (chip)
      where (l.dim = 'clean' and c.chip in ('dirty', 'smell', 'trash'))
         or (l.dim = 'get_in' and c.chip in ('code', 'buy', 'wait', 'find', 'stalls'))
         or (l.dim = 'vibes' and c.chip in ('lighting', 'music'))
      group by l.bathroom_id, c.chip
    ) per_chip
    group by bathroom_id
  )
  select s.bathroom_id, s.people, s.visits, s.last_visit,
    case when r.clean_people >= public.stats_min_people() then round(r.clean, 1) end, coalesce(r.clean_people, 0),
    case when r.get_in_people >= public.stats_min_people() then round(r.get_in, 1) end, coalesce(r.get_in_people, 0),
    case when r.vibes_people >= public.stats_min_people() then round(r.vibes, 1) end, coalesce(r.vibes_people, 0),
    coalesce(cc.chips, '{}'::jsonb),
    array(select f from unnest(array['code', 'buy']) as f
          where coalesce((cc.chips->>f)::int, 0) >= public.stats_min_people())
  from shown s
  left join ratings r using (bathroom_id)
  left join chip_counts cc using (bathroom_id);
$$;

revoke execute on function public.stats_min_people() from public;
grant execute on function public.stats_min_people() to anon, authenticated;
revoke execute on function public.bathroom_stats() from public;
grant execute on function public.bathroom_stats() to anon, authenticated;

-- ---------- carry over the old ratings from places ----------

-- Each place with a log becomes a past visit by its owner, dated when the place was last saved.
-- The visit keeps the place's id, so a phone carrying over its own copy (nbt.places) lands on
-- the same row instead of adding a second visit.
-- cleanliness → Clean. smell, trashCleanliness and lighting → those chips' own ratings, and a
-- score of 1–2 (Bad / Very bad) also marks the chip as a problem. stallCount → stall_count.
insert into public.visits (id, user_id, bathroom_id, visited_at, clean, smell, trash, lighting, stall_count, chips, source, created_at, updated_at)
select
  p.id,
  p.user_id,
  b.id,
  p.updated_at,
  (p.data->'log'->>'cleanliness')::smallint,
  (p.data->'log'->>'smell')::smallint,
  (p.data->'log'->>'trashCleanliness')::smallint,
  (p.data->'log'->>'lighting')::smallint,
  nullif((p.data->'log'->>'stallCount')::smallint, 0),
  array_remove(array[
    case when (p.data->'log'->>'smell')::int <= 2 then 'smell' end,
    case when (p.data->'log'->>'trashCleanliness')::int <= 2 then 'trash' end,
    case when (p.data->'log'->>'lighting')::int <= 2 then 'lighting' end
  ], null),
  'carried_over',
  p.updated_at,
  p.updated_at
from public.places p
join public.bathrooms b on b.id = coalesce(p.data->>'publicId', p.id::text)
where p.deleted_at is null
  and (p.data->'log') ?| array['cleanliness', 'smell', 'trashCleanliness', 'lighting', 'stallCount']
on conflict (id) do nothing;

-- Refuse to finish (rolling everything back) unless every old rating carried over intact.
do $$ begin
  assert (select count(*) from public.visits where source = 'carried_over')
    = (select count(*) from public.places p where p.deleted_at is null
       and (p.data->'log') ?| array['cleanliness', 'smell', 'trashCleanliness', 'lighting', 'stallCount']),
    'each place with a log should be one carried-over visit';
  assert (select count(*) from public.visits v
          join public.places p on p.id = v.id and p.user_id = v.user_id and coalesce(p.data->>'publicId', p.id::text) = v.bathroom_id
          where v.source = 'carried_over'
            and (v.clean is distinct from (p.data->'log'->>'cleanliness')::smallint
              or v.smell is distinct from (p.data->'log'->>'smell')::smallint
              or v.trash is distinct from (p.data->'log'->>'trashCleanliness')::smallint
              or v.lighting is distinct from (p.data->'log'->>'lighting')::smallint)) = 0,
    'carried-over visits should keep their owner and ratings';
end $$;
