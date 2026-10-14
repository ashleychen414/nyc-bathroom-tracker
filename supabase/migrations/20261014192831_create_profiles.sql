-- One profile per account: the name shown on shared things (tips, edits) and the account's role.
-- Created automatically at sign-up; deleting the account deletes the profile (on delete cascade).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 50),
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per account (NYC Poops): display name and role. Role is changed by Ashley in SQL, never by the app.';

alter table public.profiles enable row level security;

create policy "Users read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy "Users update their own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Users may change only their display name, never their role (column-level privilege).
-- Profiles are created by the sign-up trigger below, so nobody inserts or deletes them directly.
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
revoke select on public.profiles from anon;
grant update (display_name) on public.profiles to authenticated;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Give every new account a profile.
create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

revoke execute on function public.create_profile_for_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

-- Accounts that existed before this migration.
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;
