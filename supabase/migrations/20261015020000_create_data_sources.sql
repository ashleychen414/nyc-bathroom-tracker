-- Dataset-level facts the app shows next to the bathrooms: when the city last changed its data
-- (the UI must show this date), when public/data/bathrooms.json was last rebuilt, and holiday
-- closures by operator. One row per source; the nightly job writes it, anyone reads it.
create table public.data_sources (
  id text primary key,                 -- 'nyc-open-data'
  source_updated_at timestamptz,       -- when the source last changed (NYC Open Data rowsUpdatedAt)
  generated_at timestamptz,            -- when bathrooms.json last changed
  special_days jsonb,                  -- holiday closures by operator (data/special-days.json), or null
  updated_at timestamptz not null default now()
);

comment on table public.data_sources is 'Dataset-level info for the app (NYC Poops): city data date, build time, holiday closures. Written by the nightly job.';

create trigger data_sources_set_updated_at before update on public.data_sources
  for each row execute function public.set_updated_at();

alter table public.data_sources enable row level security;

create policy "Anyone reads data sources" on public.data_sources
  for select to anon, authenticated using (true);

-- Only the service role writes.
revoke insert, update, delete, truncate on public.data_sources from anon, authenticated;
