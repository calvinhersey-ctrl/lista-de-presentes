-- 26 Oct 2026: fridge with freezer added.
insert into public.gifts (id, qty) values ('geladeira', 1)
on conflict (id) do update set qty = excluded.qty;
