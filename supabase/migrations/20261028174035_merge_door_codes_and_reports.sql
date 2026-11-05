-- Merges two migrations written in parallel: public_door_codes (20261026214654, "Code still
-- works?" = confirm_code) and feedback_loops (20261028161031, "Something's wrong" reports with a
-- note). feedback_loops replaced report_bathroom(), the kind check and bathroom_edits_per_person
-- without confirm_code; this puts confirm_code back alongside the new report kinds.

alter table public.bathroom_edits
  drop constraint bathroom_edits_kind_check,
  add constraint bathroom_edits_kind_check check (kind in (
    'edit', 'report_closed', 'report_not_here', 'report_wrong_spot', 'report_other',
    'confirm_open', 'confirm_hours', 'confirm_code', 'fact'));

comment on column public.bathroom_edits.kind is 'edit; report_closed / report_not_here / report_wrong_spot / report_other ("Something''s wrong", with an optional note); confirm_open; confirm_hours; confirm_code ("Code still works?": changes = { code }); or fact (an answer to a fact: changes = { fact, value, count }, value null = "Not sure"; can''t be undone).';

-- Both versions together: the new report kinds with a note, and confirm_code (which carries the
-- code it confirmed and updates code_confirmed_at). Only "closed" changes what the app shows.
create or replace function public.report_bathroom(p_bathroom_id text, p_device_id uuid, p_kind text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bathrooms;
  edit_id uuid;
  note text := nullif(btrim(p_note), '');
begin
  if p_kind is null or p_kind not in ('report_closed', 'report_not_here', 'report_wrong_spot', 'report_other', 'confirm_open', 'confirm_hours', 'confirm_code') then
    raise exception 'Unknown report' using errcode = 'check_violation';
  end if;
  if char_length(note) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = 'check_violation';
  end if;
  perform public.bathroom_edits_rate_check(p_device_id);
  select * into b from public.bathrooms where id = p_bathroom_id for update;
  if not found or not public.bathroom_is_shared(b) then
    raise exception 'No such bathroom' using errcode = 'P0002';
  end if;
  if p_kind = 'confirm_code' and b.code is null then
    raise exception 'There''s no code to confirm' using errcode = 'check_violation';
  end if;
  insert into public.bathroom_edits (bathroom_id, kind, changes, device_id, note)
    values (p_bathroom_id, p_kind,
      case when p_kind = 'confirm_code' then jsonb_build_object('code', b.code) end,
      p_device_id,
      case when p_kind like 'report_%' then note end)
    returning id into edit_id;
  if p_kind = 'report_closed' then
    perform public.bathrooms_recompute_closed(p_bathroom_id);
  elsif p_kind = 'confirm_code' then
    perform public.bathrooms_recompute_code(p_bathroom_id);
  end if;
  return public.bathroom_edit_result(edit_id, p_bathroom_id);
end;
$$;

revoke execute on function public.report_bathroom(text, uuid, text, text) from public;
grant execute on function public.report_bathroom(text, uuid, text, text) to anon, authenticated;

create or replace view public.bathroom_edits_per_person with (security_invoker = true) as
select
  coalesce(user_id::text, 'phone ' || left(device_id::text, 8)) as person,
  user_id is not null as signed_in,
  count(*) filter (where kind = 'edit') as edits,
  count(*) filter (where kind = 'report_closed') as reported_closed,
  count(*) filter (where kind in ('confirm_open', 'confirm_hours', 'confirm_code')) as confirmations,
  count(*) filter (where undone_at is not null) as undone,
  count(distinct bathroom_id) as bathrooms,
  min(created_at) as first_at,
  max(created_at) as last_at,
  count(*) filter (where kind = 'fact') as fact_answers,
  count(*) filter (where kind in ('report_not_here', 'report_wrong_spot', 'report_other')) as other_reports
from public.bathroom_edits
group by 1, 2
order by edits desc, last_at desc;

revoke all on public.bathroom_edits_per_person from anon, authenticated;
