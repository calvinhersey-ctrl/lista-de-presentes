-- 26 Oct 2026: storage bench (link from Calvin).
insert into public.gifts (id, qty) values ('banco-bau', 1) on conflict (id) do update set qty = excluded.qty;
