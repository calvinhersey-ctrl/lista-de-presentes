-- 26 Oct 2026: microwave added.
insert into public.gifts (id, qty) values ('microondas', 1)
on conflict (id) do update set qty = excluded.qty;
