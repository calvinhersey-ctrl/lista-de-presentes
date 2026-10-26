-- 26 Oct 2026: full-length mirror added.
insert into public.gifts (id, qty) values ('espelho', 1)
on conflict (id) do update set qty = excluded.qty;
