-- 26 Oct 2026: Calvin's cuts from the house round two: washer, kitchen cabinets, oven and hammock
-- come off the list. (The TV stand stays, swapped for a light-coloured one; same id.)
delete from public.gifts where id in ('maquina-lavar', 'armario-cozinha', 'forno', 'rede');
