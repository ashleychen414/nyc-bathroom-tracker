-- Row-level security tests for public.places, public.profiles, public.bathrooms, public.lists,
-- public.list_items, public.visits (and bathroom_stats()), public.data_sources and public.location_events.
-- Runs entirely inside a transaction and rolls back: it leaves no users or rows behind.
-- Run it in the Supabase SQL editor (or via the Supabase connector) after any change to
-- a table or its policies. Any failed check raises an error naming the check.
-- Anonymous-visitor checks against the live API are in scripts/check-rls.mjs (npm run test:rls).
begin;

insert into auth.users (id, email, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'rls-test-a@example.invalid', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'rls-test-b@example.invalid', 'authenticated', 'authenticated');

-- ---------- places (read-only since E2) ----------

-- A place from before E2 (as the database owner).
insert into public.places (id, user_id, data, updated_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '{"name":"A place"}', now());

set local role authenticated;

-- User A still reads their own places, and can no longer add or change them.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$ begin
  assert (select count(*) from public.places) = 1, 'A should see exactly their own place';
  begin
    insert into public.places (id, data, updated_at) values ('aaaaaaaa-0000-0000-0000-000000000002', '{}', now());
    raise exception 'A was able to add a place (places is read-only)';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.places set data = '{"name":"changed"}' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'A was able to change a place (places is read-only)';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.places where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'A was able to delete a place';
  exception when insufficient_privilege then null;
  end;
end $$;

-- User B sees nothing of A's.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$ begin
  assert (select count(*) from public.places) = 0, 'B should not see A''s places';
end $$;

reset role;

-- ---------- profiles ----------

-- Every account gets a profile at sign-up (trigger on auth.users), as a member.
do $$ begin
  assert (select count(*) from public.profiles where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222') and role = 'member') = 2,
    'new accounts should get a member profile';
  assert (select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)) = 0,
    'every existing account should have a profile';
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- A sees only their own profile and can set their display name.
update public.profiles set display_name = 'Tester A' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'changed by A' where id = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert (select count(*) from public.profiles) = 1, 'A should see only their own profile';
  assert (select display_name from public.profiles) = 'Tester A', 'A should be able to set their display name';
end $$;

-- A can't make themselves an admin, add a profile, or delete one.
do $$ begin
  begin
    update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'A was able to change their own role';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.profiles (id) values ('33333333-3333-3333-3333-333333333333');
    raise exception 'A was able to insert a profile';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profiles where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'A was able to delete a profile';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  assert (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222') is null,
    'A should not be able to change B''s profile';
end $$;

-- ---------- bathrooms ----------

set local request.jwt.claims = '{"role":"service_role"}'; -- as the nightly job: no signed-in user
-- Test rows (as the database owner): a seed row, a confirmed and an unverified Public user row,
-- a removed Public user row, and a Private row owned by A.
insert into public.bathrooms (id, name, source, status, visibility, created_by, lat, lng) values
  ('rls-test-seed', 'RLS test seed', 'seed', 'unverified', 'public', null, 40.7, -73.9),
  ('rls-test-confirmed', 'RLS test confirmed', 'user', 'confirmed', 'public', '22222222-2222-2222-2222-222222222222', 40.7, -73.9),
  ('rls-test-unverified', 'RLS test unverified', 'user', 'unverified', 'public', '22222222-2222-2222-2222-222222222222', 40.7, -73.9),
  ('rls-test-removed', 'RLS test removed', 'user', 'removed', 'public', '22222222-2222-2222-2222-222222222222', 40.7, -73.9),
  ('rls-test-private-a', 'RLS test private', 'user', 'unverified', 'private', '11111111-1111-1111-1111-111111111111', 40.7, -73.9);

-- The table refuses Private rows without an owner, and Private seed rows. (A Public one can lose its
-- owner when they delete their account: see the end.)
do $$ begin
  begin
    insert into public.bathrooms (id, name, source, visibility, created_by, lat, lng) values ('rls-test-no-owner', 'x', 'user', 'private', null, 40.7, -73.9);
    raise exception 'a Private user row without an owner was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.bathrooms (id, name, source, visibility, lat, lng) values ('rls-test-private-seed', 'x', 'seed', 'private', 40.7, -73.9);
    raise exception 'a Private seed row was accepted';
  exception when check_violation then null;
  end;
end $$;

-- Anonymous visitors read Public bathrooms (seed, and user rows we haven't removed), never Private ones.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  assert (select string_agg(id, ',' order by id) from public.bathrooms where id like 'rls-test-%') = 'rls-test-confirmed,rls-test-seed,rls-test-unverified',
    'anon should see seed and Public user rows, not removed or Private ones';
end $$;

-- A sees the Public rows plus their own Private one; B doesn't see A's Private one.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$ begin
  assert (select count(*) from public.bathrooms where id like 'rls-test-%') = 4, 'A should see 3 Public rows and their Private one';
  assert exists (select 1 from public.bathrooms where id = 'rls-test-private-a'), 'A should see their own Private bathroom';
end $$;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$ begin
  assert not exists (select 1 from public.bathrooms where id = 'rls-test-private-a'), 'B should not see A''s Private bathroom';
  assert exists (select 1 from public.bathrooms where id = 'rls-test-removed'), 'B should still see the row they own, even when removed';
end $$;

-- A adds bathrooms: owner, source and status are filled in and can't be chosen.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.bathrooms (id, name, access, visibility, lat, lng) values
  ('rls-test-new-private', 'A private', 'unknown', 'private', 40.7, -73.9),
  ('rls-test-new-public', 'A public cafe', 'customers_only', 'public', 40.7, -73.9);
do $$ begin
  assert (select created_by || '/' || source || '/' || status from public.bathrooms where id = 'rls-test-new-private')
    = '11111111-1111-1111-1111-111111111111/user/unverified', 'a new bathroom should be A''s, user, unverified';
  begin
    insert into public.bathrooms (id, name, lat, lng, status) values ('rls-test-x', 'x', 40.7, -73.9, 'confirmed');
    raise exception 'A was able to set status';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.bathrooms (id, name, lat, lng, source) values ('rls-test-x', 'x', 40.7, -73.9, 'seed');
    raise exception 'A was able to add a seed row';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.bathrooms (id, name, lat, lng, created_by) values ('rls-test-x', 'x', 40.7, -73.9, '22222222-2222-2222-2222-222222222222');
    raise exception 'A was able to add a bathroom owned by B';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A edits their own rows, can make Private → Public but not back, and deletes only Private ones.
update public.bathrooms set name = 'A private renamed', deleted_at = now() where id = 'rls-test-new-private';
do $$ begin
  assert (select name from public.bathrooms where id = 'rls-test-new-private') = 'A private renamed', 'A should edit their own bathroom';
  assert (select deleted_at is not null from public.bathrooms where id = 'rls-test-new-private'), 'A should delete their own Private bathroom';
  begin
    update public.bathrooms set visibility = 'private' where id = 'rls-test-new-public';
    raise exception 'A was able to make a Public bathroom Private';
  exception when check_violation then null;
  end;
  begin
    update public.bathrooms set deleted_at = now() where id = 'rls-test-new-public';
    raise exception 'A was able to delete a Public bathroom';
  exception when check_violation then null;
  end;
  begin
    update public.bathrooms set status = 'confirmed' where id = 'rls-test-new-public';
    raise exception 'A was able to change status';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.bathrooms set visibility = 'public' where id = 'rls-test-private-a';

-- A can't change anyone else's rows (seed or B's): the update matches nothing. Nobody deletes or runs the sync.
update public.bathrooms set name = 'changed by A' where id in ('rls-test-seed', 'rls-test-confirmed');
do $$ begin
  begin
    insert into public.bathrooms (id, name, lat, lng) values ('rls-test-seed', 'taken over', 40.7, -73.9)
      on conflict (id) do update set name = excluded.name;
    raise exception 'A was able to upsert over a seed row';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.bathrooms where id = 'rls-test-new-public';
    raise exception 'a signed-in user was able to delete a bathroom';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sync_seed_bathrooms('[]'::jsonb, false);
    raise exception 'a signed-in user was able to run the bathrooms sync';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  assert (select count(*) from public.bathrooms where id in ('rls-test-seed', 'rls-test-confirmed') and name like 'changed%') = 0,
    'A should not be able to change seed rows or B''s rows';
  assert (select name from public.bathrooms where id = 'rls-test-seed') = 'RLS test seed', 'the upsert should not have changed the seed row';
  assert (select visibility from public.bathrooms where id = 'rls-test-private-a') = 'public', 'A should be able to make their Private bathroom Public';
end $$;

-- ---------- lists and list_items ----------

-- Every account gets one default list at sign-up.
do $$ begin
  assert (select count(*) from public.lists where user_id = '11111111-1111-1111-1111-111111111111' and is_default) = 1,
    'a new account should get one default list';
  assert (select count(*) from auth.users u where not exists (select 1 from public.lists l where l.user_id = u.id and l.is_default)) = 0,
    'every account should have a default list';
end $$;
insert into public.bathrooms (id, name, source, visibility, created_by, lat, lng)
  values ('rls-test-private-b', 'B private', 'user', 'private', '22222222-2222-2222-2222-222222222222', 40.7, -73.9);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
declare
  mine uuid := (select id from public.lists where is_default);
begin
  assert (select count(*) from public.lists) = 1, 'A should see only their own list';
  -- A saves a seed row and their own bathroom, with notes; the owner is filled in.
  insert into public.list_items (list_id, bathroom_id, notes) values (mine, 'rls-test-seed', 'code 1234'), (mine, 'rls-test-new-public', null);
  assert (select count(*) from public.list_items where user_id = '11111111-1111-1111-1111-111111111111') = 2, 'A should see their 2 list items';
  -- Removing is a tombstone; the same bathroom twice on one list lands on one row.
  update public.list_items set deleted_at = now() where bathroom_id = 'rls-test-new-public';
  insert into public.list_items (list_id, bathroom_id, notes) values (mine, 'rls-test-seed', 'newer')
    on conflict (list_id, bathroom_id) do update set notes = excluded.notes;
  assert (select notes from public.list_items where bathroom_id = 'rls-test-seed') = 'newer', 'upsert should update the existing item';
  begin
    insert into public.list_items (list_id, bathroom_id) values (mine, 'rls-test-private-b');
    raise exception 'A was able to save B''s Private bathroom';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.list_items where bathroom_id = 'rls-test-seed';
    raise exception 'A was able to hard-delete a list item';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.lists (user_id, name) values ('11111111-1111-1111-1111-111111111111', 'Another');
    raise exception 'A was able to add a list';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B can't see A's list or items, add to A's list, or change A's items.
reset role;
select set_config('rls_test.a_list', (select id::text from public.lists where user_id = '11111111-1111-1111-1111-111111111111' and is_default), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$
declare
  a_list uuid := current_setting('rls_test.a_list')::uuid;
begin
  assert (select count(*) from public.lists) = 1, 'B should see only their own list';
  assert (select count(*) from public.list_items) = 0, 'B should not see A''s list items';
  begin
    insert into public.list_items (list_id, bathroom_id) values (a_list, 'rls-test-seed');
    raise exception 'B was able to add to A''s list';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.list_items (list_id, bathroom_id, user_id) values (a_list, 'rls-test-confirmed', '11111111-1111-1111-1111-111111111111');
    raise exception 'B was able to add an item as A';
  exception when insufficient_privilege then null;
  end;
  update public.list_items set notes = 'changed by B' where list_id = a_list;
end $$;

reset role;
do $$ begin
  assert (select notes from public.list_items where bathroom_id = 'rls-test-seed' and user_id = '11111111-1111-1111-1111-111111111111') = 'newer',
    'B should not be able to change A''s list items';
end $$;

-- The share prompt flag: users can clear their own, not set anyone else's.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.profiles set share_prompt_due = true where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set share_prompt_due = false where id = '11111111-1111-1111-1111-111111111111';
reset role;
do $$ begin
  assert (select share_prompt_due from public.profiles where id = '22222222-2222-2222-2222-222222222222') = false,
    'A should not be able to change B''s share prompt';
end $$;

-- ---------- visits and bathroom_stats() ----------

insert into auth.users (id, email, aud, role) values
  ('33333333-3333-3333-3333-333333333333', 'rls-test-v@example.invalid', 'authenticated', 'authenticated');

-- A logs visits: the owner is filled in, no limit per day, never in the future.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.visits (id, bathroom_id, visited_at, clean, updated_at)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'rls-test-seed', now() - interval '3 days', 1, now() - interval '3 days');
insert into public.visits (id, bathroom_id, visited_at, clean, get_in, vibes, chips, smell, updated_at)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'rls-test-seed', now() + interval '2 days', 4, 2, 5, '{code,smell}', 2, now());
insert into public.visits (id, bathroom_id, visited_at) values ('bbbbbbbb-0000-0000-0000-000000000003', 'rls-test-seed', now() - interval '1 minute');
-- A visits their own Private bathroom too: it never shows in the stats.
insert into public.bathrooms (id, name, visibility, lat, lng) values ('rls-test-visit-private', 'A private stop', 'private', 40.7, -73.9);
insert into public.visits (bathroom_id, visited_at, clean) values ('rls-test-visit-private', now(), 5);
do $$ begin
  assert (select count(*) from public.visits where bathroom_id = 'rls-test-seed') = 3, 'A should see their 3 visits here, two of them today';
  assert (select user_id from public.visits where clean = 4) = '11111111-1111-1111-1111-111111111111', 'a visit should be A''s';
  assert (select visited_at <= now() and source = 'app' from public.visits where clean = 4), 'a future visit should be dated now, from the app';
  -- The app saves with an upsert on id: the same id updates the visit.
  insert into public.visits (id, bathroom_id, visited_at, clean, updated_at)
    values ('bbbbbbbb-0000-0000-0000-000000000003', 'rls-test-seed', now() - interval '1 minute', 3, now())
    on conflict (id) do update set clean = excluded.clean, updated_at = excluded.updated_at;
  assert (select count(*) from public.visits) = 4, 'the upsert should update the visit, not add one';
  begin
    insert into public.visits (bathroom_id, visited_at, chips) values ('rls-test-confirmed', now(), '{not-a-chip}');
    raise exception 'a chip outside the list was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.visits (bathroom_id, visited_at, clean) values ('rls-test-confirmed', now(), 6);
    raise exception 'a rating of 6 was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.visits (bathroom_id, visited_at) values ('rls-test-private-b', now());
    raise exception 'A was able to visit B''s Private bathroom';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.visits set bathroom_id = 'rls-test-private-b' where id = 'bbbbbbbb-0000-0000-0000-000000000003';
    raise exception 'A was able to move a visit onto B''s Private bathroom';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.visits (user_id, bathroom_id, visited_at) values ('22222222-2222-2222-2222-222222222222', 'rls-test-confirmed', now());
    raise exception 'A was able to log a visit as B';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.visits (bathroom_id, visited_at, source) values ('rls-test-confirmed', now(), 'carried_over');
    raise exception 'A was able to set source';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.visits where bathroom_id = 'rls-test-seed';
    raise exception 'A was able to delete a visit';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B sees none of A's visits, can't change them, and can't take one over by its id.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
update public.visits set clean = 1 where bathroom_id = 'rls-test-seed';
insert into public.visits (bathroom_id, visited_at, clean, get_in, chips, updated_at)
  values ('rls-test-seed', now(), 2, 3, '{code,code,dirty}', now());  -- a repeated chip counts once
do $$ begin
  assert (select count(*) from public.visits) = 1, 'B should see only their own visit';
  begin
    insert into public.visits (id, bathroom_id, visited_at, clean) values ('bbbbbbbb-0000-0000-0000-000000000002', 'rls-test-seed', now(), 1)
      on conflict (id) do update set clean = excluded.clean;
    raise exception 'B was able to upsert over A''s visit';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select clean from public.visits where id = 'bbbbbbbb-0000-0000-0000-000000000002') = 4,
    'B should not be able to change A''s visit';
end $$;

-- A third person, and everyone sees the counts, and only counts. People are different people,
-- not visits; each person's latest rating counts once.
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
insert into public.visits (bathroom_id, visited_at, clean, get_in, updated_at) values ('rls-test-seed', now(), 3, 5, now());
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  s record;
begin
  begin
    perform 1 from public.visits;
    raise exception 'anon was able to read visits';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.visits (user_id, bathroom_id, visited_at) values ('11111111-1111-1111-1111-111111111111', 'rls-test-seed', now() - interval '9 days');
    raise exception 'anon was able to log a visit';
  exception when insufficient_privilege then null;
  end;
  select * into s from public.bathroom_stats() where bathroom_id = 'rls-test-seed';
  assert s.people = 3 and s.visits = 5, 'stats should count 3 people and 5 visits, got ' || s.people || '/' || s.visits;
  assert s.last_visit = (now() at time zone 'America/New_York')::date, 'last visit should be today';
  assert s.clean = 3.0 and s.clean_people = 3, 'Clean should average each person''s latest rating (4, 2, 3), got ' || s.clean;
  assert s.get_in = 3.3 and s.get_in_people = 3, 'Getting in should average 2, 3, 5, got ' || s.get_in;
  assert s.vibes = 5.0 and s.vibes_people = 1, 'Vibes rated by 1 person should show (minimum is 1 for now)';
  assert s.chips = '{"code": 2, "dirty": 1, "smell": 1}'::jsonb, 'chips should count people per chip, got ' || s.chips::text;
  assert s.facts = '{code}', 'code tapped by 2 people should be a fact, got ' || s.facts::text;
  assert not exists (select 1 from public.bathroom_stats() where bathroom_id = 'rls-test-visit-private'), 'stats should never show a Private bathroom';
end $$;
reset role;


-- The sync: adds new rows, keeps our status, picks the less-open copy of a duplicated id,
-- updates only changed rows, and refuses a list that would mark most rows missing.
set local request.jwt.claims = '{"role":"service_role"}';
delete from public.bathrooms where id like 'rls-test-%';
do $$
declare
  r jsonb;
begin
  r := public.sync_seed_bathrooms('[
    {"id":"rls-test-a","name":"Test A","type":"Library","borough":"Brooklyn","status":"Operational","hours":null,"hoursReviewed":false,"lat":40.69,"lng":-73.99},
    {"id":"rls-test-b","name":"Test B","type":"Park","borough":"Queens","status":"Operational","hours":{"kind":"24h"},"hoursReviewed":true,"lat":40.75,"lng":-73.85},
    {"id":"rls-test-b","name":"Test B","type":"Park","borough":"Queens","status":"Not Operational","hours":null,"hoursReviewed":false,"lat":40.75,"lng":-73.85}
  ]'::jsonb, false);
  assert (r->>'inserted')::int = 2 and (r->>'unique')::int = 2, 'sync should add 2 rows from 3 with a duplicated id: ' || r;
  assert (select venue_type || '/' || access || '/' || status || '/' || source || '/' || visibility || '/' || coalesce(created_by::text, 'no owner') from public.bathrooms where id = 'rls-test-a')
    = 'library/public/unverified/seed/public/no owner', 'seed rows should be library/public/unverified/seed, Public, with no owner';
  assert (select source_data->>'status' from public.bathrooms where id = 'rls-test-b') = 'Not Operational',
    'for a duplicated id the less-open copy should win';

  update public.bathrooms set status = 'confirmed' where id = 'rls-test-a';
  r := public.sync_seed_bathrooms('[
    {"id":"rls-test-a","name":"Test A renamed","type":"Library","borough":"Brooklyn","status":"Operational","hours":null,"hoursReviewed":false,"lat":40.69,"lng":-73.99},
    {"id":"rls-test-b","name":"Test B","type":"Park","borough":"Queens","status":"Not Operational","hours":null,"hoursReviewed":false,"lat":40.75,"lng":-73.85}
  ]'::jsonb, false);
  assert (r->>'updated')::int = 1 and (r->>'inserted')::int = 0, 'sync should update only the changed row: ' || r;
  assert (select name || '/' || status from public.bathrooms where id = 'rls-test-a') = 'Test A renamed/confirmed',
    'sync should update city facts but keep our status';

  if (select count(*) from public.bathrooms where source = 'seed') > 20 then
    begin
      perform public.sync_seed_bathrooms('[{"id":"rls-test-a","name":"Test A","lat":40.69,"lng":-73.99}]'::jsonb, true);
      raise exception 'sync accepted a list that would mark most rows missing';
    exception when raise_exception then
      if sqlerrm not like 'Refusing to sync%' then raise; end if;
    end;
  end if;
end $$;

-- ---------- data_sources ----------

insert into public.data_sources (id, source_updated_at) values ('rls-test', now())
  on conflict (id) do nothing;

-- Anyone reads the dataset info; nobody but the service role writes it.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  assert exists (select 1 from public.data_sources where id = 'rls-test'), 'anon should read data_sources';
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$ begin
  assert exists (select 1 from public.data_sources where id = 'rls-test'), 'signed-in users should read data_sources';
  begin
    insert into public.data_sources (id) values ('rls-test-new');
    raise exception 'a signed-in user was able to add dataset info';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.data_sources set generated_at = now() where id = 'rls-test';
    raise exception 'a signed-in user was able to change dataset info';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.data_sources where id = 'rls-test';
    raise exception 'a signed-in user was able to delete dataset info';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;


-- ---------- location_events ----------

-- Anonymous and signed-in visitors can add a row, and nothing else: no reading (table or
-- views), changing, deleting, or setting the server-side columns.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
insert into public.location_events (trigger, permission_before, result, platform, app_version)
  values ('startup', 'prompt', 'granted', 'ios-safari', 'rls-test');
do $$ begin
  begin
    perform 1 from public.location_events;
    raise exception 'anon was able to read location_events';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.location_events (trigger, permission_before, result, platform, app_version)
  values ('button', 'denied', 'denied', 'desktop', 'rls-test');
do $$ begin
  begin
    perform 1 from public.location_events;
    raise exception 'a signed-in user was able to read location_events';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.location_events_daily;
    raise exception 'a signed-in user was able to read location_events_daily';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.location_events_weekly;
    raise exception 'a signed-in user was able to read location_events_weekly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.location_events set result = 'granted' where app_version = 'rls-test';
    raise exception 'a signed-in user was able to change location_events';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.location_events where app_version = 'rls-test';
    raise exception 'a signed-in user was able to delete location_events';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.location_events (created_at, trigger, permission_before, result, platform)
      values (now() - interval '30 days', 'button', 'prompt', 'granted', 'desktop');
    raise exception 'a signed-in user was able to set created_at';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.location_events (trigger, permission_before, result, platform)
      values ('button', 'prompt', 'granted', 'Mozilla/5.0 (iPhone)');
    raise exception 'location_events accepted a platform outside the list';
  exception when check_violation then null;
  end;
end $$;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform 1 from public.location_events_daily;
    raise exception 'anon was able to read location_events_daily';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.location_events set result = 'granted' where app_version = 'rls-test';
    raise exception 'anon was able to change location_events';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.location_events where app_version = 'rls-test';
    raise exception 'anon was able to delete location_events';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  assert (select count(*) from public.location_events where app_version = 'rls-test') = 2,
    'both visitor rows should have landed, unchanged';
  assert (select count(*) from public.location_events where app_version = 'rls-test' and result = 'denied') = 1,
    'visitors should not have been able to change a row';
  -- The test rows share a day and platform with real visits, so compare with what the view should count.
  assert (select coalesce(sum(attempts), 0) from public.location_events_daily where app_versions like '%rls-test%')
    = (select count(*) from public.location_events
       where app_version is distinct from 'rls-check'
         and (created_at at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date
         and platform in ('ios-safari', 'desktop')),
    'the daily view should count the rows';
end $$;

-- ---------- deleting an account ----------

-- Its Private bathrooms and list go; its Public bathrooms stay on the map, with no owner.
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into auth.users (id, email, aud, role) values
  ('44444444-4444-4444-4444-444444444444', 'rls-test-c@example.invalid', 'authenticated', 'authenticated');
insert into public.bathrooms (id, name, source, visibility, created_by, lat, lng) values
  ('rls-test-c-public', 'C public', 'user', 'public', '44444444-4444-4444-4444-444444444444', 40.7, -73.9),
  ('rls-test-c-private', 'C private', 'user', 'private', '44444444-4444-4444-4444-444444444444', 40.7, -73.9);
insert into public.list_items (list_id, bathroom_id, user_id)
  select id, 'rls-test-c-private', user_id from public.lists where user_id = '44444444-4444-4444-4444-444444444444';
delete from auth.users where id = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert not exists (select 1 from public.bathrooms where id = 'rls-test-c-private'), 'a deleted account''s Private bathrooms should go';
  assert (select coalesce(created_by::text, 'no owner') || '/' || visibility from public.bathrooms where id = 'rls-test-c-public') = 'no owner/public',
    'a deleted account''s Public bathrooms should stay, with no owner';
  assert not exists (select 1 from public.lists where user_id = '44444444-4444-4444-4444-444444444444'), 'a deleted account''s list should go';
  begin
    insert into public.bathrooms (id, name, source, visibility, created_by, lat, lng) values ('rls-test-c-x', 'x', 'user', 'private', null, 40.7, -73.9);
    raise exception 'a Private bathroom without an owner was accepted';
  exception when check_violation then null;
  end;
end $$;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  assert exists (select 1 from public.bathrooms where id = 'rls-test-c-public'), 'anon should still see the kept Public bathroom';
end $$;
reset role;

select 'places, profiles, bathrooms, lists, list_items, visits, data_sources, location_events RLS: all checks passed' as result;
rollback;
