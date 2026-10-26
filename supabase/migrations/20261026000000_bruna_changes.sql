-- 26 Oct 2026: Bruna's changes. No kitchen tap; two Jasmim beds, so three double mattresses.
delete from public.gifts where id = 'torneira-cozinha';
update public.gifts set qty = 2 where id = 'cama-jasmim';
update public.gifts set qty = 3 where id = 'colchao-casal';
