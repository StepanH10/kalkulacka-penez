-- =====================================================================
-- 010 – Předplatná
--
-- Tabulka subscriptions: sledovaná předplatná i zamítnuté návrhy detektoru
-- (status 'ignored' = detektor je už nenabízí). Osobní nebo skupinová jako
-- ostatní data. Spárované platby se počítají na klientu, transakce se nemění.
--
-- Bezpečné nad stávající databází: jen přidává tabulku, indexy, triggery
-- a politiky. Nic nemaže, lze spustit i opakovaně.
-- =====================================================================

begin;

create or replace function pg_temp.ensure_policy(p_table text, p_name text, p_command text, p_using text, p_check text)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = p_table and policyname = p_name
  ) then
    execute format('create policy %I on public.%I for %s to authenticated', p_name, p_table, p_command)
      || coalesce(' using (' || p_using || ')', '')
      || coalesce(' with check (' || p_check || ')', '');
  end if;
end;
$$;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  -- text pro párování s transakcemi, normalizuje klient (malá písmena, bez diakritiky)
  match_text text not null check (char_length(match_text) between 2 and 60 and match_text = lower(trim(match_text))),
  category_id uuid,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'CZK' check (currency ~ '^[A-Z]{3}$'),
  -- povolená odchylka částky v procentech
  amount_tolerance numeric(5, 2) not null default 10 check (amount_tolerance between 0 and 100),
  interval text not null check (interval in ('weekly', 'monthly', 'quarterly', 'yearly')),
  started_on date not null default current_date,
  ended_on date,
  status text not null default 'active' check (status in ('active', 'cancelled', 'ignored')),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint subscriptions_scope_check check ((user_id is null) <> (group_id is null)),
  constraint subscriptions_dates_check check (ended_on is null or ended_on >= started_on),
  -- Unikátní v rámci prostoru. Druhý sloupec je vždy null u opačného typu řádku
  -- a null se v unikátním omezení nikdy neshoduje, takže stačí dvě úplná omezení.
  constraint subscriptions_user_match_key unique (user_id, match_text),
  constraint subscriptions_group_match_key unique (group_id, match_text),
  -- kategorie ze stejného prostoru; po smazání kategorie předplatné zůstane bez ní
  constraint subscriptions_category_user_fkey
    foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  constraint subscriptions_category_group_fkey
    foreign key (category_id, group_id) references public.categories (id, group_id) on delete set null (category_id)
);

create index if not exists subscriptions_category_id_idx on public.subscriptions (category_id);

-- Rozsah řádku hlídají stávající (security invoker) triggerové funkce
-- set_row_scope / keep_row_scope – žádná nová triggerová funkce nevzniká,
-- takže tu není potřeba ani revoke execute
create or replace trigger subscriptions_set_scope
  before insert on public.subscriptions
  for each row execute function public.set_row_scope('-');
create or replace trigger subscriptions_keep_scope
  before update on public.subscriptions
  for each row execute function public.keep_row_scope('-');

-- RLS: osobní jen vlastník; skupinová čte člen, mění a maže owner/editor
alter table public.subscriptions enable row level security;

select pg_temp.ensure_policy('subscriptions', 'subscriptions_select_own', 'select',
  'user_id = (select auth.uid())', null);
select pg_temp.ensure_policy('subscriptions', 'subscriptions_insert_own', 'insert',
  null, 'user_id = (select auth.uid())');
select pg_temp.ensure_policy('subscriptions', 'subscriptions_update_own', 'update',
  'user_id = (select auth.uid())', 'user_id = (select auth.uid())');
select pg_temp.ensure_policy('subscriptions', 'subscriptions_delete_own', 'delete',
  'user_id = (select auth.uid())', null);

select pg_temp.ensure_policy('subscriptions', 'subscriptions_group_select', 'select',
  'group_id is not null and public.is_group_member(group_id)', null);
select pg_temp.ensure_policy('subscriptions', 'subscriptions_group_insert', 'insert',
  null, 'group_id is not null and public.can_edit_group(group_id)');
select pg_temp.ensure_policy('subscriptions', 'subscriptions_group_update', 'update',
  'group_id is not null and public.can_edit_group(group_id)',
  'group_id is not null and public.can_edit_group(group_id)');
select pg_temp.ensure_policy('subscriptions', 'subscriptions_group_delete', 'delete',
  'group_id is not null and public.can_edit_group(group_id)', null);

commit;
