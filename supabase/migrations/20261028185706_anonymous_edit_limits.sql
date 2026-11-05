-- Tighter limits on signed-out edits, reports and fact answers, before a wider launch.
--
-- Until now the only limit was 60 per hour per device id, and the device id is whatever the
-- phone sends, so a script could make up new ids and change every bathroom. Now every write
-- that goes through bathroom_edits_rate_check() (edit_bathroom, report_bathroom, answer_fact)
-- is also counted per network address and, when signed out, across everyone:
--   * signed out: at most 30 per hour from one network address
--   * signed out: at most 300 per hour from everyone together
--   * signed in: unchanged (60 per hour per person)
-- Network addresses are never stored: only a keyed hash (HMAC with a secret kept in the
-- database), and rows are deleted after two hours.

create table public.edit_rate_hits (
  created_at timestamptz not null default now(),
  ip_hash text,              -- null when the request carried no address
  signed_in boolean not null
);
comment on table public.edit_rate_hits is 'One row per edit, report or fact answer, for rate limits only (NYC Poops). ip_hash is an HMAC of the network address, never the address. Rows older than two hours are deleted.';
create index edit_rate_hits_created_idx on public.edit_rate_hits (created_at);
create index edit_rate_hits_ip_idx on public.edit_rate_hits (ip_hash, created_at);
alter table public.edit_rate_hits enable row level security;
revoke all on public.edit_rate_hits from anon, authenticated;

-- The HMAC key: made once, here, never leaves the database.
create table public.edit_rate_secret (key bytea not null);
alter table public.edit_rate_secret enable row level security;
revoke all on public.edit_rate_secret from anon, authenticated;
insert into public.edit_rate_secret (key) values (extensions.gen_random_bytes(32));

-- The caller's network address, from the request headers PostgREST passes in (first hop).
create function public.request_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(trim(split_part(coalesce(
    current_setting('request.headers', true)::json ->> 'x-forwarded-for',
    current_setting('request.headers', true)::json ->> 'x-real-ip',
    ''), ',', 1)), '')
$$;
revoke execute on function public.request_ip() from public, anon, authenticated;

create or replace function public.bathroom_edits_rate_check(p_device_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ip text := public.request_ip();
  v_ip_hash text;
begin
  if p_device_id is null then
    raise exception 'A device id is needed' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.bathroom_edits
      where created_at > now() - interval '1 hour'
        and (device_id = p_device_id or (auth.uid() is not null and user_id = auth.uid()))) >= 60 then
    raise exception 'Too many edits in the last hour. Try again later.' using errcode = 'program_limit_exceeded';
  end if;

  delete from public.edit_rate_hits where created_at < now() - interval '2 hours';

  if v_ip is not null then
    v_ip_hash := encode(extensions.hmac(convert_to(v_ip, 'UTF8'), (select key from public.edit_rate_secret limit 1), 'sha256'), 'hex');
  end if;

  if auth.uid() is null then
    if v_ip_hash is not null and (select count(*) from public.edit_rate_hits
        where ip_hash = v_ip_hash and not signed_in
          and created_at > now() - interval '1 hour') >= 30 then
      raise exception 'Too many changes from this network in the last hour. Sign in to keep going, or try again later.'
        using errcode = 'program_limit_exceeded';
    end if;
    if (select count(*) from public.edit_rate_hits
        where not signed_in and created_at > now() - interval '1 hour') >= 300 then
      raise exception 'Lots of changes right now. Sign in to keep going, or try again in a bit.'
        using errcode = 'program_limit_exceeded';
    end if;
  end if;

  insert into public.edit_rate_hits (ip_hash, signed_in) values (v_ip_hash, auth.uid() is not null);
end;
$$;
revoke execute on function public.bathroom_edits_rate_check(uuid) from public, anon, authenticated;
