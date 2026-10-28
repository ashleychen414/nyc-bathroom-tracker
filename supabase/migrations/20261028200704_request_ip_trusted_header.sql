-- Fix for 20261028185706: read the address a client can't fake.
-- A client can put its own X-Forwarded-For in front, so its first entry is whatever the caller
-- says (checked live: a sent "1.2.3.4" came through as the first entry). Cloudflare sets
-- cf-connecting-ip itself and refuses requests that send one; the last X-Forwarded-For entry is
-- added by the proxy. Use those.
create or replace function public.request_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(trim(coalesce(
    h ->> 'cf-connecting-ip',
    (string_to_array(h ->> 'x-forwarded-for', ','))[array_length(string_to_array(h ->> 'x-forwarded-for', ','), 1)],
    '')), '')
  from (select current_setting('request.headers', true)::json as h) x
$$;
revoke execute on function public.request_ip() from public, anon, authenticated;
