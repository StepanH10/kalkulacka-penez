-- =====================================================================
-- 009 – Počáteční zůstatek účtu
--
-- Počáteční zůstatek je vlastnost účtu, ne transakce, takže se nikdy
-- nezapočítá do statistik příjmů a výdajů.
-- Zůstatek účtu = opening_balance + pohyby s datem >= opening_balance_date.
-- Účet bez počátečního zůstatku (oba sloupce null) se počítá jako dosud,
-- ze všech pohybů, takže se stávající zůstatky migrací nezmění.
--
-- Práva: stávající politiky accounts_update_own a accounts_group_update
-- už pustí vlastníka osobního účtu a ve skupině owner/editor. Pozorovatel
-- účet měnit nesmí. Nová politika ani triggerová funkce nevzniká.
--
-- Bezpečné nad stávající databází: jen přidává dva prázdné sloupce
-- a omezení. Nic nemaže, lze spustit i opakovaně.
-- =====================================================================

begin;

create or replace function pg_temp.ensure_constraint(p_table text, p_name text, p_definition text)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = p_name and conrelid = format('public.%I', p_table)::regclass
  ) then
    execute format('alter table public.%I add constraint %I %s', p_table, p_name, p_definition);
  end if;
end;
$$;

-- Zůstatek smí být záporný (přečerpaný účet); širší než částka jedné transakce
alter table public.accounts add column if not exists opening_balance numeric(14, 2);
alter table public.accounts add column if not exists opening_balance_date date;

-- Částka a datum platí jen společně
select pg_temp.ensure_constraint('accounts', 'accounts_opening_balance_check',
  'check ((opening_balance is null) = (opening_balance_date is null))');

commit;
