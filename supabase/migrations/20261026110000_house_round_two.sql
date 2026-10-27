-- 26 Oct 2026: what the house still needs, after comparing the list with the Paraty house
-- room by room (washer, kitchen cabinets, oven, water purifier, gas kit, TV stand, ceiling fans,
-- two single wardrobes, sheets, bathroom accessory sets, hammock, drying rack).
insert into public.gifts (id, qty) values
  ('maquina-lavar', 1),
  ('armario-cozinha', 1),
  ('forno', 1),
  ('purificador', 1),
  ('kit-gas', 1),
  ('rack-tv', 1),
  ('ventilador-teto', 4),
  ('guarda-roupa-solteiro', 2),
  ('jogo-lencol', 3),
  ('kit-banheiro', 2),
  ('rede', 1),
  ('varal', 1)
on conflict (id) do update set qty = excluded.qty;
