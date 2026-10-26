-- 26 Oct 2026: right mattresses for each bed.
-- Top bunk: one 88 cm Ortobom single. Trundle bed: a kit of two 78 x 188 x 12 cm.
delete from public.gifts where id = 'colchoes-solteiro';
insert into public.gifts (id, qty) values ('colchao-solteiro', 1), ('colchoes-bicama', 1)
on conflict (id) do update set qty = excluded.qty;
