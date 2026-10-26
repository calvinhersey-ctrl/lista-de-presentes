-- Gift list: which gifts exist (ids match js/content.js), how many of each,
-- and who has claimed them. Anyone (anon) can read; claims only go through
-- the claim_gift / unclaim_gift functions, which enforce the limits.

create table if not exists public.gifts (
  id   text primary key,
  qty  integer not null default 1 check (qty >= 1)
);

create table if not exists public.claims (
  id         uuid primary key default gen_random_uuid(),
  gift_id    text not null references public.gifts(id) on delete cascade,
  giver_name text not null check (char_length(btrim(giver_name)) between 1 and 60),
  message    text check (message is null or char_length(message) <= 300),
  token      uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index if not exists claims_gift_id_idx on public.claims (gift_id);

alter table public.gifts  enable row level security;
alter table public.claims enable row level security;

-- Everyone can read the gift list and who gave what (never the undo token).
create policy "gifts are public" on public.gifts
  for select to anon, authenticated using (true);
create policy "claims are public" on public.claims
  for select to anon, authenticated using (true);

revoke all on public.gifts  from anon, authenticated;
revoke all on public.claims from anon, authenticated;
grant select on public.gifts to anon, authenticated;
grant select (id, gift_id, giver_name, message, created_at) on public.claims to anon, authenticated;

-- Claim one unit of a gift. Returns the claim id and an undo token that only
-- the person who claimed it holds (the site keeps it in their browser).
create or replace function public.claim_gift(p_gift_id text, p_name text, p_message text default null)
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
begin
  select qty into v_qty from public.gifts where id = p_gift_id for update;
  if v_qty is null then
    raise exception 'unknown gift' using errcode = 'P0002';
  end if;

  select count(*) into v_taken from public.claims where gift_id = p_gift_id;
  if v_taken >= v_qty then
    raise exception 'already taken' using errcode = 'P0003';
  end if;

  insert into public.claims (gift_id, giver_name, message)
  values (p_gift_id, btrim(p_name), nullif(btrim(coalesce(p_message, '')), ''))
  returning id, token into v_id, v_token;

  return query select v_id, v_token;
end;
$$;

-- Undo a claim. Only works with the token handed out at claim time.
create or replace function public.unclaim_gift(p_claim_id uuid, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.claims where id = p_claim_id and token = p_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.claim_gift(text, text, text) from public;
revoke all on function public.unclaim_gift(uuid, uuid) from public;
grant execute on function public.claim_gift(text, text, text) to anon, authenticated;
grant execute on function public.unclaim_gift(uuid, uuid) to anon, authenticated;

-- The gifts themselves. Ids and quantities must match js/content.js.
insert into public.gifts (id, qty) values
  ('cooktop',            1),
  ('cama-jasmim',        1),
  ('beliche',            1),
  ('colchao-casal',      2),
  ('colchoes-solteiro',  2),
  ('bicama',             1),
  ('mesa-jantar',        1),
  ('chuveiro',           2),
  ('torneira-cozinha',   1),
  ('torneira-lavatorio', 2)
on conflict (id) do update set qty = excluded.qty;
