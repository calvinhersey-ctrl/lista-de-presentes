-- 26 Oct 2026: a better kitchen tap (Lorenzetti Loren Flex) and four more items from Bruna.
insert into public.gifts (id, qty) values
  ('torneira-cozinha', 1),
  ('sofa',             1),
  ('escrivaninha',     1),
  ('cabeceiras',       1),
  ('mesas-laterais',   1)
on conflict (id) do update set qty = excluded.qty;
