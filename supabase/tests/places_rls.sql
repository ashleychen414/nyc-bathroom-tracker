-- Row-level security tests for public.places, public.profiles, public.bathrooms, public.data_sources
-- and public.location_events.
-- Runs entirely inside a transaction and rolls back: it leaves no users or rows behind.
-- Run it in the Supabase SQL editor (or via the Supabase connector) after any change to
-- a table or its policies. Any failed check raises an error naming the check.
-- Anonymous-visitor checks against the live API are in scripts/check-rls.mjs (npm run test:rls).
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

-- Test rows (as the database owner): one seed row, one confirmed user row, one unverified user row.
insert into public.bathrooms (id, name, source, status, lat, lng) values
  ('rls-test-seed', 'RLS test seed', 'seed', 'unverified', 40.7, -73.9),
  ('rls-test-confirmed', 'RLS test confirmed', 'user', 'confirmed', 40.7, -73.9),
  ('rls-test-unverified', 'RLS test unverified', 'user', 'unverified', 40.7, -73.9);

-- Anonymous visitors and signed-in users read seed and confirmed bathrooms only.
set local role anon;
do $$ begin
  assert (select count(*) from public.bathrooms where id like 'rls-test-%') = 2, 'anon should see seed and confirmed rows only';
  assert not exists (select 1 from public.bathrooms where id = 'rls-test-unverified'), 'anon should not see unverified user rows';
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$ begin
  assert (select count(*) from public.bathrooms where id like 'rls-test-%') = 2, 'signed-in users should see seed and confirmed rows only';
end $$;

-- Nobody but the service role writes: no insert, update, delete, or calling the sync function.
do $$ begin
  begin
    insert into public.bathrooms (id, name, source, lat, lng) values ('rls-test-new', 'x', 'user', 40.7, -73.9);
    raise exception 'a signed-in user was able to add a bathroom';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.bathrooms set name = 'changed' where id = 'rls-test-seed';
    raise exception 'a signed-in user was able to change a bathroom';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.bathrooms where id = 'rls-test-seed';
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

-- The sync: adds new rows, keeps our status, picks the less-open copy of a duplicated id,
-- updates only changed rows, and refuses a list that would mark most rows missing.
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
  assert (select venue_type || '/' || access || '/' || status || '/' || source from public.bathrooms where id = 'rls-test-a') = 'library/public/unverified/seed',
    'seed rows should be library/public/unverified/seed';
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
  assert (select coalesce(sum(attempts), 0) from public.location_events_daily where app_versions like '%rls-test%') = 2,
    'the daily view should count the rows';
end $$;

select 'places, profiles, bathrooms, data_sources, location_events RLS: all checks passed' as result;
rollback;
