-- Row-level security test for public.places, signed-in users.
-- Runs entirely inside a transaction and rolls back: it leaves no users or rows behind.
-- Run it in the Supabase SQL editor (or via the Supabase connector) after any change to
-- places or its policies. Any failed check raises an error naming the check.
begin;

insert into auth.users (id, email, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'rls-test-a@example.invalid', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'rls-test-b@example.invalid', 'authenticated', 'authenticated');

set local role authenticated;

-- User A adds a place; the owner is filled in from their sign-in.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.places (id, data, updated_at) values ('aaaaaaaa-0000-0000-0000-000000000001', '{"name":"A place"}', now());
do $$ begin
  assert (select count(*) from public.places) = 1, 'A should see exactly their own place';
  assert (select user_id from public.places limit 1) = '11111111-1111-1111-1111-111111111111', 'owner should default to the signed-in user';
end $$;

-- User A can't create a place owned by someone else.
do $$ begin
  begin
    insert into public.places (id, user_id, data, updated_at)
      values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '{}', now());
    raise exception 'A was able to insert a place owned by B';
  exception when insufficient_privilege then null; -- expected: blocked by the insert policy
  end;
end $$;

-- User B sees nothing of A's and can't change it.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
update public.places set data = '{"name":"changed by B"}' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.places) = 0, 'B should not see A''s places';
end $$;

-- Nobody can hard-delete (deletes are tombstones), not even the owner.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
delete from public.places where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  assert (select data->>'name' from public.places where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'A place',
    'A''s place should be unchanged by B and not hard-deletable';
end $$;

reset role;
select 'places RLS: all checks passed' as result;
rollback;
