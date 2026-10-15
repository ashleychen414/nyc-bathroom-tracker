-- The shared bathrooms database: one row per real bathroom, readable by everyone.
-- Seeded from NYC Open Data (source = 'seed'), keeping the app's existing nyc-… ids so saved
-- places still match. Only the service role writes for now (the nightly job); user
-- corrections and additions come later through their own tables (E7).
create table public.bathrooms (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  name text not null check (char_length(name) between 1 and 200),
  venue_type text not null default 'other'
    check (venue_type in ('park', 'library', 'transit', 'plaza', 'pops', 'cafe', 'restaurant', 'store', 'hotel', 'museum', 'other')),
  access text not null default 'unknown'
    check (access in ('public', 'customers_only', 'key_or_code', 'unknown')),
  status text not null default 'unverified'
    check (status in ('unverified', 'confirmed', 'needs_details', 'closed', 'removed', 'merged')),
  source text not null check (source in ('seed', 'user', 'admin')),
  borough text check (borough in ('Brooklyn', 'Manhattan', 'Queens', 'Bronx', 'Staten Island')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  hours jsonb,                        -- structured hours (src/lib/hours.js model); null = unknown
  hours_reviewed boolean not null default false, -- hours come from data/hours-overrides.json
  source_data jsonb,                  -- seed rows: the record as public/data/bathrooms.json last had it
  source_removed_at timestamptz,      -- seed rows: when it dropped out of the city data (null = still there)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bathrooms is 'Shared bathrooms (NYC Poops). Seed rows come from NYC Open Data via the nightly job; status is ours (verification), the city''s own Operational/Closed status is in source_data.';
comment on column public.bathrooms.status is 'Our record status: unverified (seed default), confirmed, needs_details, closed, removed, merged. Never changed by the nightly job.';
comment on column public.bathrooms.source_removed_at is 'Set by the nightly job when a seed row is no longer in the city data (renamed or moved rows get a new id). The row is kept so saved places still resolve.';

create trigger bathrooms_set_updated_at before update on public.bathrooms
  for each row execute function public.set_updated_at();

alter table public.bathrooms enable row level security;

create policy "Anyone reads seed and confirmed bathrooms" on public.bathrooms
  for select to anon, authenticated using (source = 'seed' or status = 'confirmed');

-- No write policies, and no write privileges either: only the service role writes for now.
revoke insert, update, delete, truncate on public.bathrooms from anon, authenticated;

-- Nightly sync from public/data/bathrooms.json (rows in that file's shape, hours overrides applied).
-- Inserts new rows, updates a row only when its city record changed (so later corrections to
-- unchanged rows survive), never touches status or access of existing rows, and marks seed rows
-- missing from the data. Refuses a list much smaller than what's loaded, in case the data is truncated.
-- The city lists a few restrooms twice under the same id; the less-open copy wins (accuracy first).
create function public.sync_seed_bathrooms(rows jsonb, mark_missing boolean default true)
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
      name = excluded.name,
      venue_type = excluded.venue_type,
      borough = excluded.borough,
      lat = excluded.lat,
      lng = excluded.lng,
      hours = excluded.hours,
      hours_reviewed = excluded.hours_reviewed,
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

revoke execute on function public.sync_seed_bathrooms(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.sync_seed_bathrooms(jsonb, boolean) to service_role;
