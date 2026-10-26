-- 26 Oct 2026: wardrobe added. (Kitchen tap keeps its id; only the product changed.)
insert into public.gifts (id, qty) values ('guarda-roupa', 1)
on conflict (id) do update set qty = excluded.qty;
