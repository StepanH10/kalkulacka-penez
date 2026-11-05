-- =====================================================================
-- 008 – Import transakcí z CSV výpisu banky
--
-- 1) transactions.import_hash: otisk importovaného řádku výpisu
--    („kb:<identifikace transakce>“). Stejný řádek nejde do stejného
--    účtu vložit dvakrát ani při opakovaném nahrání souboru.
-- 2) import_rules: pravidla automatických kategorií („lidl“ → Jídlo),
--    osobní nebo skupinová jako ostatní data.
-- 3) notify_group_expense: importované výdaje ve skupině neposílají
--    upozornění po jednom (import stovky řádků = stovky upozornění).
--
-- Bezpečné nad stávající databází: jen přidává sloupec, omezení,
-- tabulku a politiky, funkci nahrazuje přes create or replace.
-- Nic nemaže, lze spustit i opakovaně.
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

-- ---------------------------------------------------------------------
-- Otisk importované transakce + ochrana proti duplicitám
-- ---------------------------------------------------------------------

alter table public.transactions add column if not exists import_hash text;
select pg_temp.ensure_constraint('transactions', 'transactions_import_hash_check',
  'check (import_hash is null or char_length(import_hash) between 1 and 200)');

-- Unikátní (account_id, import_hash). Ručně zadané transakce mají import_hash
-- null a null se v unikátním omezení nikdy neshoduje, takže se omezení týká
-- jen importovaných řádků (stejně jako částečný index „where import_hash is
-- not null“). Úplné omezení místo částečného indexu proto, že na něj jde
-- cílit „on conflict (account_id, import_hash) do nothing“ z klienta
-- (upsert s ignoreDuplicates). Částečný index by konflikt bez podmínky
-- where neodvodil.
select pg_temp.ensure_constraint('transactions', 'transactions_account_import_hash_key',
  'unique (account_id, import_hash)');

-- ---------------------------------------------------------------------
-- Pravidla importu: text v popisu / protistraně → kategorie
-- ---------------------------------------------------------------------

create table if not exists public.import_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  -- porovnává se bez ohledu na velikost písmen a diakritiku (normalizuje klient)
  match_text text not null check (char_length(trim(match_text)) between 2 and 60),
  category_id uuid not null,
  created_at timestamptz not null default now(),
  constraint import_rules_scope_check check ((user_id is null) <> (group_id is null)),
  -- kategorie ze stejného prostoru; smazání kategorie smaže i její pravidla
  constraint import_rules_category_user_fkey
    foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade,
  constraint import_rules_category_group_fkey
    foreign key (category_id, group_id) references public.categories (id, group_id) on delete cascade
);

create index if not exists import_rules_user_id_idx on public.import_rules (user_id) where user_id is not null;
create index if not exists import_rules_group_id_idx on public.import_rules (group_id) where group_id is not null;
create index if not exists import_rules_category_id_idx on public.import_rules (category_id);

-- Rozsah řádku hlídají stávající (security invoker) triggerové funkce
-- set_row_scope / keep_row_scope – žádná nová triggerová funkce nevzniká
create or replace trigger import_rules_set_scope
  before insert on public.import_rules
  for each row execute function public.set_row_scope('-');
create or replace trigger import_rules_keep_scope
  before update on public.import_rules
  for each row execute function public.keep_row_scope('-');

-- RLS: osobní pravidla jen vlastník; skupinová čte člen, mění a maže owner/editor
alter table public.import_rules enable row level security;

select pg_temp.ensure_policy('import_rules', 'import_rules_select_own', 'select',
  'user_id = (select auth.uid())', null);
select pg_temp.ensure_policy('import_rules', 'import_rules_insert_own', 'insert',
  null, 'user_id = (select auth.uid())');
select pg_temp.ensure_policy('import_rules', 'import_rules_update_own', 'update',
  'user_id = (select auth.uid())', 'user_id = (select auth.uid())');
select pg_temp.ensure_policy('import_rules', 'import_rules_delete_own', 'delete',
  'user_id = (select auth.uid())', null);

select pg_temp.ensure_policy('import_rules', 'import_rules_group_select', 'select',
  'group_id is not null and public.is_group_member(group_id)', null);
select pg_temp.ensure_policy('import_rules', 'import_rules_group_insert', 'insert',
  null, 'group_id is not null and public.can_edit_group(group_id)');
select pg_temp.ensure_policy('import_rules', 'import_rules_group_update', 'update',
  'group_id is not null and public.can_edit_group(group_id)',
  'group_id is not null and public.can_edit_group(group_id)');
select pg_temp.ensure_policy('import_rules', 'import_rules_group_delete', 'delete',
  'group_id is not null and public.can_edit_group(group_id)', null);

-- ---------------------------------------------------------------------
-- Upozornění: importované výdaje ve skupině se neoznamují po jednom
-- (stejně jako výdaje z opakovaných plateb)
-- ---------------------------------------------------------------------

create or replace function public.notify_group_expense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group text;
  v_category text;
  v_author text;
  m record;
begin
  if new.group_id is null or new.type <> 'expense' or new.recurring_id is not null
     or new.import_hash is not null then
    return null;
  end if;
  select name into v_group from public.groups where id = new.group_id;
  select name into v_category from public.categories where id = new.category_id;
  v_author := coalesce(public.user_tag(new.created_by), 'Bývalý člen');

  for m in
    select user_id from public.group_members
    where group_id = new.group_id and user_id is distinct from new.created_by
  loop
    perform public.notify(m.user_id, 'group_expense', jsonb_build_object(
      'group_id', new.group_id,
      'group_name', v_group,
      'transaction_id', new.id,
      'amount', new.amount,
      'category', v_category,
      'note', new.note,
      'author', v_author
    ));
  end loop;
  return null;
end;
$$;

-- triggerová funkce: nesmí jít volat přes RPC (create or replace práva
-- zachová, revoke je tu pro jistotu podle pravidla v CLAUDE.md)
revoke execute on function public.notify_group_expense() from public, anon, authenticated;

commit;
