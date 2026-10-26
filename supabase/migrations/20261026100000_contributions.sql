-- 26 Oct 2026: "Contribua com qualquer valor". Besides picking a specific gift,
-- people can pledge any amount toward the whole house. Same rules as claims:
-- anyone can read (never the undo token), writes only through the functions.

create table if not exists public.contributions (
  id         uuid primary key default gen_random_uuid(),
  giver_name text not null check (char_length(btrim(giver_name)) between 1 and 60),
  amount     numeric(12, 2) not null check (amount > 0 and amount <= 100000),
  currency   text not null check (currency in ('BRL', 'USD')),
  message    text check (message is null or char_length(message) <= 300),
  side       text check (side is null or side in ('bruna', 'calvin')),
  token      uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.contributions enable row level security;

drop policy if exists "contributions are public" on public.contributions;
create policy "contributions are public" on public.contributions
  for select to anon, authenticated using (true);

revoke all on public.contributions from anon, authenticated;
grant select (id, giver_name, amount, currency, message, side, created_at)
  on public.contributions to anon, authenticated;

create or replace function public.contribute(
  p_name     text,
  p_amount   numeric,
  p_currency text,
  p_message  text default null,
  p_side     text default null
)
returns table (contribution_id uuid, undo_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_token uuid;
begin
  if p_currency is null or p_currency not in ('BRL', 'USD') then
    raise exception 'bad currency' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    raise exception 'bad amount' using errcode = '22023';
  end if;

  insert into public.contributions (giver_name, amount, currency, message, side)
  values (
    btrim(p_name),
    round(p_amount, 2),
    p_currency,
    nullif(btrim(coalesce(p_message, '')), ''),
    case when p_side in ('bruna', 'calvin') then p_side else null end
  )
  returning id, token into v_id, v_token;

  return query select v_id, v_token;
end;
$$;

create or replace function public.uncontribute(p_id uuid, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.contributions where id = p_id and token = p_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.contribute(text, numeric, text, text, text) from public;
revoke all on function public.uncontribute(uuid, uuid) from public;
grant execute on function public.contribute(text, numeric, text, text, text) to anon, authenticated;
grant execute on function public.uncontribute(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
