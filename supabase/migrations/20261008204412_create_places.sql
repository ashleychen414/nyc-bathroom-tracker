-- Each person's saved places. The app is local-first: this is the account copy it syncs to.
create table public.places (
  id uuid primary key,                       -- generated on the phone; stable across devices
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,                       -- the whole place as the app stores it (name, location, hours, log, origin...)
  updated_at timestamptz not null,           -- set by the app; newer edit wins when merging
  deleted_at timestamptz,                    -- deletes are kept as tombstones so they sync to other devices
  created_at timestamptz not null default now()
);

comment on table public.places is 'Saved places per user (NYC Poops). Deletes are tombstones (deleted_at); deleting the account removes everything.';

create index places_user_id_idx on public.places (user_id);

alter table public.places enable row level security;

create policy "Users read their own places" on public.places
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Users add their own places" on public.places
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Users update their own places" on public.places
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- No delete policy on purpose: the app deletes by setting deleted_at; "Delete my account" removes all rows.

-- "Delete my account": removes the signed-in user, and their places with them (on delete cascade).
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Called by the nightly GitHub Action so the free-plan project isn't paused for inactivity.
create function public.keep_alive()
returns integer
language sql
stable
set search_path = ''
as $$ select 1 $$;

grant execute on function public.keep_alive() to anon, authenticated;
