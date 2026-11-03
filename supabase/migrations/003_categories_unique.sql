-- =====================================================================
-- 003 – Unikátní název kategorie v rámci typu (bez ohledu na velikost písmen)
-- Stejný index jako v schema.sql. Nic nemaže ani nepřejmenovává.
-- Pokud v databázi existují duplicity, migrace skončí srozumitelnou chybou
-- a nic nezmění – nejdřív je vyřešte ručně (viz README, deník změn).
-- Lze spustit i opakovaně.
-- =====================================================================

begin;

-- Kontrola duplicit předem: místo obecné chyby „could not create unique index“
-- vypíše, kolik skupin duplicit existuje
do $$
declare
  duplicates integer;
begin
  select count(*) into duplicates
  from (
    select 1
    from public.categories
    group by user_id, type, lower(name)
    having count(*) > 1
  ) as d;

  if duplicates > 0 then
    raise exception 'Nalezeno % skupin duplicitních kategorií (stejný uživatel, typ a název). Vyřešte je ručně a migraci spusťte znovu.', duplicates;
  end if;
end
$$;

-- Název kategorie je unikátní v rámci uživatele a typu (výdaj / příjem)
create unique index if not exists categories_user_type_name_key
  on public.categories (user_id, type, lower(name));

commit;
