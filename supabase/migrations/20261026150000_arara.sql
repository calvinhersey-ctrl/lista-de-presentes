-- 26 Oct 2026: pine clothes rack (link from Calvin).
insert into public.gifts (id, qty) values ('arara', 1) on conflict (id) do update set qty = excluded.qty;
