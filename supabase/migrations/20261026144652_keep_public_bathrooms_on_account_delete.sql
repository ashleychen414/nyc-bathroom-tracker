-- Deleting an account keeps the Public bathrooms that person added (Ashley, 2026-10-26): they're
-- part of the shared map and may be on other people's lists. Their Private bathrooms (and with
-- them, any list items pointing at those) are still deleted. A kept Public bathroom loses its
-- owner, so nobody can edit it any more (corrections come later through E7).

-- A Public bathroom someone added may now have no owner (its creator deleted their account).
-- Private ones always have one.
alter table public.bathrooms
  drop constraint bathrooms_user_rows_have_owner,
  add constraint bathrooms_user_rows_have_owner check (source <> 'user' or created_by is not null or visibility = 'public');

alter table public.bathrooms
  drop constraint bathrooms_created_by_fkey,
  add constraint bathrooms_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

comment on column public.bathrooms.created_by is 'Who added it (user rows). Deleting the account deletes their Private bathrooms and keeps their Public ones, with no owner.';

-- Before an account goes (from the app's "Delete account" or the dashboard), delete its Private
-- bathrooms; the foreign key then clears the owner on the Public ones that remain.
create function public.delete_private_bathrooms_of_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.bathrooms where created_by = old.id and visibility = 'private';
  return old;
end;
$$;

revoke execute on function public.delete_private_bathrooms_of_deleted_user() from public, anon, authenticated;

create trigger on_auth_user_deleted_bathrooms before delete on auth.users
  for each row execute function public.delete_private_bathrooms_of_deleted_user();
