-- E2: lists, and saved places move onto the shared bathrooms table.
-- - bathrooms gets an owner (created_by), visibility (public / private) and an address, and
--   signed-in users can add and edit their own rows. Private rows are visible only to their owner.
-- - lists + list_items: each account has one default list ("My places") of references to bathrooms,
--   with the owner's private notes on each item.
-- - Today's places rows move over: a saved city restroom becomes a list item pointing to its nyc-…
--   row; a hand-added place becomes a Private bathroom (access unknown, same id) on its owner's list.
-- - places becomes read-only (kept for a while; its old ratings carry over to visits in E3).
-- Decided 2026-10-24: "What private bathroom means" and "Key-or-code access, and moving today's
-- saved places" in docs/DECISIONS.md.

-- ---------- bathrooms: owner, visibility, address ----------

alter table public.bathrooms
  add column created_by uuid references auth.users (id) on delete cascade,  -- set by bathrooms_set_owner
  add column visibility text not null default 'public' check (visibility in ('public', 'private')),
  add column address text check (char_length(address) <= 300),
  add column deleted_at timestamptz,   -- owner deleted a Private bathroom (tombstone, so the delete syncs)
  alter column source set default 'user';

alter table public.bathrooms
  add constraint bathrooms_user_rows_have_owner check (source <> 'user' or created_by is not null),
  add constraint bathrooms_private_only_user check (visibility = 'public' or source = 'user'),
  add constraint bathrooms_delete_only_private check (deleted_at is null or visibility = 'private');

comment on column public.bathrooms.created_by is 'Who added it (user rows). Deleting the account deletes their bathrooms, Public ones included.';
comment on column public.bathrooms.visibility is 'public: everyone sees it. private: only created_by sees it. Public is one-way: it can''t go back to Private (others may have it on a list).';
comment on column public.bathrooms.deleted_at is 'Set by the owner to delete a Private bathroom. Public bathrooms can''t be deleted by users.';

create index bathrooms_created_by_idx on public.bathrooms (created_by) where created_by is not null;

-- Who reads what:
-- - Public bathrooms: everyone. Seed rows as before (all statuses); user rows unless we removed or merged them.
-- - Your own rows: always, Private and deleted ones included (so edits and deletes sync).
-- Replaces "Anyone reads seed and confirmed bathrooms": confirmed user rows are still readable,
-- and so are unverified Public user rows now.
drop policy "Anyone reads seed and confirmed bathrooms" on public.bathrooms;
create policy "Anyone reads public bathrooms; owners read their own" on public.bathrooms
  for select to anon, authenticated using (
    (visibility = 'public' and (source = 'seed' or status not in ('removed', 'merged')))
    or created_by = (select auth.uid())
  );

create policy "Users add their own bathrooms" on public.bathrooms
  for insert to authenticated
  with check (source = 'user' and status = 'unverified' and created_by = (select auth.uid()));

create policy "Users update their own bathrooms" on public.bathrooms
  for update to authenticated
  using (source = 'user' and created_by = (select auth.uid()))
  with check (source = 'user' and created_by = (select auth.uid()));

-- Users write only these columns. Status, source, owner and the city fields stay ours; there is no
-- delete (Private ones are tombstoned with deleted_at). id is in the update list because the app
-- saves with an upsert, which sets every column it sends; the policy keeps it to your own rows.
grant insert (id, name, venue_type, access, visibility, address, lat, lng, hours, deleted_at) on public.bathrooms to authenticated;
grant update (id, name, venue_type, access, visibility, address, lat, lng, hours, deleted_at) on public.bathrooms to authenticated;

-- User rows belong to whoever is signed in (users can't send created_by: no column privilege);
-- seed and admin rows never have an owner, whatever session runs the nightly job.
create function public.bathrooms_set_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'user' then
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    new.created_by := null;
  end if;
  return new;
end;
$$;

create trigger bathrooms_set_owner before insert on public.bathrooms
  for each row execute function public.bathrooms_set_owner();

-- Public is one-way, and only Private bathrooms can be deleted (the check constraint above).
create function public.bathrooms_keep_public()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.visibility = 'public' and new.visibility = 'private' then
    raise exception 'A Public bathroom can''t be made Private' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger bathrooms_keep_public before update of visibility on public.bathrooms
  for each row execute function public.bathrooms_keep_public();

-- ---------- lists ----------

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'My places' check (char_length(name) between 1 and 100),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lists is 'Lists of bathrooms per user (NYC Poops). E2: one default list per account ("My places"), created at sign-up.';

create unique index lists_one_default_per_user on public.lists (user_id) where is_default;
create index lists_user_id_idx on public.lists (user_id);

create trigger lists_set_updated_at before update on public.lists
  for each row execute function public.set_updated_at();

alter table public.lists enable row level security;

create policy "Users read their own lists" on public.lists
  for select to authenticated using ((select auth.uid()) = user_id);

-- Lists are made by the sign-up trigger for now; adding, renaming and sharing lists come later (E10).
revoke all on public.lists from anon, authenticated;
grant select on public.lists to authenticated;

-- ---------- list_items ----------

-- One row per bathroom on a list. The key is (list, bathroom), so saving the same bathroom on two
-- phones lands on one row. Times are set by the app (newer edit wins, as places did); removing an
-- item sets deleted_at so the removal syncs.
create table public.list_items (
  list_id uuid not null references public.lists (id) on delete cascade,
  bathroom_id text not null references public.bathrooms (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  notes text check (char_length(notes) <= 2000),   -- the owner's private notes (codes go here)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (list_id, bathroom_id)
);

comment on table public.list_items is 'Bathrooms on a user''s list, with their private notes (NYC Poops). Removals are tombstones (deleted_at).';

create index list_items_user_id_idx on public.list_items (user_id);
create index list_items_bathroom_id_idx on public.list_items (bathroom_id);

alter table public.list_items enable row level security;

create policy "Users read their own list items" on public.list_items
  for select to authenticated using ((select auth.uid()) = user_id);

-- Only onto your own list, and only bathrooms you can see (the subquery runs with your RLS,
-- so someone else's Private bathroom can't be added even if its id is known).
create policy "Users add to their own lists" on public.list_items
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid()))
    and exists (select 1 from public.bathrooms b where b.id = bathroom_id)
  );

create policy "Users update their own list items" on public.list_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid()))
    and exists (select 1 from public.bathrooms b where b.id = bathroom_id)
  );

revoke all on public.list_items from anon, authenticated;
grant select on public.list_items to authenticated;
grant insert (list_id, bathroom_id, notes, created_at, updated_at, deleted_at) on public.list_items to authenticated;
grant update (list_id, bathroom_id, notes, created_at, updated_at, deleted_at) on public.list_items to authenticated;

-- ---------- default list for every account ----------

create function public.create_default_list_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lists (user_id, is_default) values (new.id, true);
  return new;
end;
$$;

revoke execute on function public.create_default_list_for_new_user() from public, anon, authenticated;

create trigger on_auth_user_created_list after insert on auth.users
  for each row execute function public.create_default_list_for_new_user();

insert into public.lists (user_id, is_default)
  select id, true from auth.users
  on conflict (user_id) where is_default do nothing;

-- ---------- one-time "Share your places?" prompt ----------

alter table public.profiles add column share_prompt_due boolean not null default false;
comment on column public.profiles.share_prompt_due is 'Show the one-time "Share your places?" prompt (owners of places moved over as Private). The app clears it.';
grant update (share_prompt_due) on public.profiles to authenticated;

-- ---------- move today's places ----------

-- Hand-added places (no publicId, or a publicId we no longer have) become Private bathrooms with
-- the same id, so links and phone copies still match. Access starts unknown. Deleted places are skipped.
insert into public.bathrooms (id, name, venue_type, access, status, source, visibility, created_by, address, lat, lng, hours, created_at)
select
  p.id::text,
  left(coalesce(nullif(trim(p.data->>'name'), ''), 'Saved place'), 200),
  'other',
  'unknown',
  'unverified',
  'user',
  'private',
  p.user_id,
  nullif(left(p.data->>'address', 300), ''),
  (p.data->>'lat')::double precision,
  (p.data->>'lng')::double precision,
  nullif(p.data->'hours', 'null'::jsonb),
  coalesce((p.data->>'createdAt')::timestamptz, p.created_at)
from public.places p
where p.deleted_at is null
  and not exists (select 1 from public.bathrooms b where b.id = p.data->>'publicId');

-- Every place becomes an item on its owner's default list, keeping its notes and times.
insert into public.list_items (list_id, bathroom_id, user_id, notes, created_at, updated_at)
select
  l.id,
  coalesce(b.id, p.id::text),
  p.user_id,
  nullif(left(trim(p.data->'log'->>'notes'), 2000), ''),
  coalesce((p.data->>'createdAt')::timestamptz, p.created_at),
  p.updated_at
from public.places p
join public.lists l on l.user_id = p.user_id and l.is_default
left join public.bathrooms b on b.id = p.data->>'publicId'
where p.deleted_at is null
on conflict (list_id, bathroom_id) do nothing;

update public.profiles pr set share_prompt_due = true
where exists (
  select 1 from public.bathrooms b where b.created_by = pr.id and b.visibility = 'private' and b.deleted_at is null
);

-- places is read-only from now on: the app reads lists instead. Kept (not dropped) for a while,
-- and E3 reads its old ratings to carry them over to visits.
revoke insert, update, delete, truncate on public.places from anon, authenticated;
comment on table public.places is 'Read-only since E2 (2026-10-24): moved to lists, list_items and bathrooms. Kept for E3 (old ratings) and as a backup; drop later.';

-- Refuse to finish (rolling everything back) unless every place moved over intact.
do $$ begin
  assert (select count(*) from public.bathrooms where source = 'user' and visibility = 'private')
    = (select count(*) from public.places p where p.deleted_at is null and not exists (select 1 from public.bathrooms b where b.id = p.data->>'publicId' and b.source = 'seed')),
    'each hand-added place should be a Private bathroom';
  assert (select count(*) from public.list_items) = (select count(*) from public.places where deleted_at is null),
    'each place should be a list item';
  assert (select count(*) from public.list_items i join public.places p on p.id::text = i.bathroom_id or p.data->>'publicId' = i.bathroom_id
          where p.user_id <> i.user_id or coalesce(i.notes, '') <> coalesce(nullif(trim(p.data->'log'->>'notes'), ''), '')) = 0,
    'list items should keep their owner and notes';
  assert (select count(*) from public.bathrooms b join public.places p on p.id::text = b.id
          where b.created_by <> p.user_id or b.hours is distinct from nullif(p.data->'hours', 'null'::jsonb)
             or b.lat <> (p.data->>'lat')::float8 or b.lng <> (p.data->>'lng')::float8) = 0,
    'Private bathrooms should keep their owner, hours and location';
  assert (select count(*) from public.profiles where share_prompt_due)
    = (select count(distinct created_by) from public.bathrooms where visibility = 'private'),
    'owners of moved places should get the share prompt';
end $$;
