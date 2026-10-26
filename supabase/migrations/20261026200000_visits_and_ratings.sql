-- E3: visits and ratings.
-- - visits: one row per person per bathroom per New York day ("I went here"), with that visit's
--   optional ratings (Clean, Getting in, Vibes, 1–5), the chips tapped as problems, and the old log
--   fields that chips open (smell, trash cans, lighting: 1–5; stalls: a count).
-- - Everyone reads only their own visits. Others see counts through bathroom_stats(), and only for
--   bathrooms at least 3 different people have visited. It never returns anything per person.
-- - The old ratings in the read-only places table carry over as past visits by their owner.
-- Decided 2026-10-24 ("Visits and ratings") and 2026-10-26 ("Rating chips, and what needs an
-- account") in docs/DECISIONS.md.

-- ---------- visits ----------

create table public.visits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bathroom_id text not null references public.bathrooms (id) on delete cascade,
  visited_at timestamptz not null,  -- set by the phone (a visit made signed out uploads later); never in the future
  visit_day date generated always as ((visited_at at time zone 'America/New_York')::date) stored,
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
  updated_at timestamptz not null default now(),  -- set by the phone: newer edit wins, as list_items
  primary key (user_id, bathroom_id, visit_day)
);

comment on table public.visits is 'Visits ("I went here") with optional ratings (NYC Poops, E3). One per person per bathroom per New York day. Each person reads only their own; others see bathroom_stats().';
comment on column public.visits.chips is 'Chips tapped as problems (below 5 stars). code and buy become facts ("Code needed", "Purchase needed") once enough people tap them. Codes themselves only go in private notes.';
comment on column public.visits.source is 'app: logged in the app. carried_over: an old rating from places (before E3).';

create index visits_bathroom_id_idx on public.visits (bathroom_id);

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
-- bathroom_id and visited_at are in the update list because the app saves with an upsert.
revoke all on public.visits from anon, authenticated;
grant select on public.visits to authenticated;
grant insert (bathroom_id, visited_at, clean, get_in, vibes, chips, smell, trash, lighting, stall_count, updated_at) on public.visits to authenticated;
grant update (bathroom_id, visited_at, clean, get_in, vibes, chips, smell, trash, lighting, stall_count, updated_at) on public.visits to authenticated;

-- ---------- bathroom_stats(): counts only ----------

-- One row per Public bathroom that at least 3 different people have visited:
--   people, last_visit (a New York date, no time),
--   per rating: the average and how many people rated it, counting each person's latest rating
--   once (shown only when at least 3 people rated it, else null),
--   chips: how many people tapped each chip on their latest visit that rated its dimension.
-- Nothing per person comes out, and bathrooms under 3 people don't appear at all.
-- security definer: it reads every visit to count them; callers still can't read visits.
create function public.bathroom_stats()
returns table (
  bathroom_id text,
  people integer,
  last_visit date,
  clean numeric, clean_people integer,
  get_in numeric, get_in_people integer,
  vibes numeric, vibes_people integer,
  chips jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with shown as (
    select v.bathroom_id, count(distinct v.user_id)::int as people, max(v.visit_day) as last_visit
    from public.visits v
    join public.bathrooms b on b.id = v.bathroom_id
    where b.visibility = 'public' and b.status not in ('removed', 'merged') and b.deleted_at is null
    group by v.bathroom_id
    having count(distinct v.user_id) >= 3
  ),
  -- Each person's latest visit that rated each dimension.
  latest as (
    select distinct on (v.bathroom_id, v.user_id, d.dim)
      v.bathroom_id, d.dim, d.rating, v.chips
    from public.visits v
    join shown s using (bathroom_id)
    cross join lateral (values ('clean', v.clean), ('get_in', v.get_in), ('vibes', v.vibes)) as d (dim, rating)
    where d.rating is not null
    order by v.bathroom_id, v.user_id, d.dim, v.visit_day desc
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
  select s.bathroom_id, s.people, s.last_visit,
    case when r.clean_people >= 3 then round(r.clean, 1) end, coalesce(r.clean_people, 0),
    case when r.get_in_people >= 3 then round(r.get_in, 1) end, coalesce(r.get_in_people, 0),
    case when r.vibes_people >= 3 then round(r.vibes, 1) end, coalesce(r.vibes_people, 0),
    coalesce(cc.chips, '{}'::jsonb)
  from shown s
  left join ratings r using (bathroom_id)
  left join chip_counts cc using (bathroom_id);
$$;

revoke execute on function public.bathroom_stats() from public;
grant execute on function public.bathroom_stats() to anon, authenticated;

-- ---------- carry over the old ratings from places ----------

-- Each place with a log becomes a past visit by its owner, dated when the place was last saved
-- (the same time the phone's copy has, so a phone carrying over nbt.places lands on the same row).
-- cleanliness → Clean. smell, trashCleanliness and lighting → those chips' own ratings, and a
-- score of 1–2 (Bad / Very bad) also marks the chip as a problem. stallCount → stall_count.
insert into public.visits (user_id, bathroom_id, visited_at, clean, smell, trash, lighting, stall_count, chips, source, created_at, updated_at)
select
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
on conflict (user_id, bathroom_id, visit_day) do nothing;

-- Refuse to finish (rolling everything back) unless every old rating carried over intact.
do $$ begin
  assert (select count(*) from public.visits where source = 'carried_over')
    = (select count(*) from public.places p where p.deleted_at is null
       and (p.data->'log') ?| array['cleanliness', 'smell', 'trashCleanliness', 'lighting', 'stallCount']),
    'each place with a log should be one carried-over visit';
  assert (select count(*) from public.visits v
          join public.places p on p.user_id = v.user_id and coalesce(p.data->>'publicId', p.id::text) = v.bathroom_id
          where v.source = 'carried_over'
            and (v.clean is distinct from (p.data->'log'->>'cleanliness')::smallint
              or v.smell is distinct from (p.data->'log'->>'smell')::smallint
              or v.trash is distinct from (p.data->'log'->>'trashCleanliness')::smallint
              or v.lighting is distinct from (p.data->'log'->>'lighting')::smallint)) = 0,
    'carried-over visits should keep their owner and ratings';
end $$;
