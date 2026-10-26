-- 26 Oct 2026: "Disputa das famílias". Each claim can say which side of the
-- family the giver is on, so the page can show a team score and a leaderboard.
-- Backward compatible: the old page calls claim_gift with 3 arguments and still works.

alter table public.claims
  add column if not exists side text check (side is null or side in ('bruna', 'calvin'));

grant select (side) on public.claims to anon, authenticated;

drop function if exists public.claim_gift(text, text, text);

create or replace function public.claim_gift(
  p_gift_id text,
  p_name    text,
  p_message text default null,
  p_side    text default null
)
returns table (claim_id uuid, undo_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty integer;
  v_taken integer;
  v_id uuid;
  v_token uuid;
  v_side text;
begin
  select qty into v_qty from public.gifts where id = p_gift_id for update;
  if v_qty is null then
    raise exception 'unknown gift' using errcode = 'P0002';
  end if;

  select count(*) into v_taken from public.claims where gift_id = p_gift_id;
  if v_taken >= v_qty then
    raise exception 'already taken' using errcode = 'P0003';
  end if;

  v_side := case when p_side in ('bruna', 'calvin') then p_side else null end;

  insert into public.claims (gift_id, giver_name, message, side)
  values (p_gift_id, btrim(p_name), nullif(btrim(coalesce(p_message, '')), ''), v_side)
  returning id, token into v_id, v_token;

  return query select v_id, v_token;
end;
$$;

revoke all on function public.claim_gift(text, text, text, text) from public;
grant execute on function public.claim_gift(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
