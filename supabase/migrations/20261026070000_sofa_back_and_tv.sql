-- 26 Oct 2026: sofa back on the list, 65" Mini LED TV added.
insert into public.gifts (id, qty) values ('sofa', 1), ('tv', 1)
on conflict (id) do update set qty = excluded.qty;
