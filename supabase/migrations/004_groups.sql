-- =====================================================================
-- 004 – Skupiny (sdílené prostory): tabulky, vazby, RLS a funkce
--
-- Princip: řádek dat patří buď uživateli (user_id vyplněné, group_id null),
-- nebo skupině (group_id vyplněné, user_id null). Stávající osobní data,
-- cizí klíče (x_id, user_id) i RLS politiky zůstávají beze změny; pro skupiny
-- přibývají paralelní cizí klíče (x_id, group_id) a nové politiky.
--
-- Bezpečné nad stávající databází: nic nemaže, jediný drop je
-- „drop index if exists categories_user_type_name_key“ (viz níže – index
-- nahrazují dva částečné indexy, data se nemění). Lze spustit i opakovaně.
-- =====================================================================

begin;

-- Pomocné funkce jen pro tuto migraci (pg_temp zmizí s koncem spojení):
-- vytvoří omezení / politiku jen tehdy, když ještě neexistuje – bez drop
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
-- Tabulky skupin a členů
-- ---------------------------------------------------------------------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 40),
  -- při smazání účtu vlastníka předá trigger vlastnictví jinému členovi;
  -- skupina bez dalších členů se smaže i se všemi daty
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists groups_owner_id_idx on public.groups (owner_id);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_id_idx on public.group_members (user_id);
-- každá skupina má právě jednoho vlastníka
create unique index if not exists group_members_one_owner_key on public.group_members (group_id) where role = 'owner';

-- ---------------------------------------------------------------------
-- Pomocné funkce pro RLS (security definer: čtou group_members bez RLS,
-- takže politiky na group_members se nezacyklí)
-- ---------------------------------------------------------------------

create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = (select auth.uid())
  );
$$;

create or replace function public.can_edit_group(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = (select auth.uid()) and role in ('owner', 'editor')
  );
$$;

create or replace function public.is_group_owner(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

revoke all on function public.is_group_member(uuid) from public, anon;
revoke all on function public.can_edit_group(uuid) from public, anon;
revoke all on function public.is_group_owner(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.can_edit_group(uuid) to authenticated;
grant execute on function public.is_group_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Datové tabulky: group_id, autor, rozsah (osobní × skupina)
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'categories', 'recurring', 'transactions', 'transfers',
    'savings_goals', 'savings_entries', 'budgets'
  ] loop
    execute format(
      'alter table public.%I add column if not exists group_id uuid references public.groups (id) on delete cascade', t);
    -- skupinová data nepatří jednomu uživateli
    execute format('alter table public.%I alter column user_id drop not null', t);
    -- řádek patří právě jednomu: uživateli, nebo skupině
    perform pg_temp.ensure_constraint(t, t || '_scope_check', 'check ((user_id is null) <> (group_id is null))');
    execute format(
      'create index if not exists %I on public.%I (group_id) where group_id is not null', t || '_group_id_idx', t);
  end loop;
end
$$;

-- Autor záznamu: u osobních = user_id, ve skupině = kdo ho vytvořil.
-- Po smazání účtu autora zůstane záznam s created_by = null („Bývalý člen“).
alter table public.transactions add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.transfers add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.savings_entries add column if not exists created_by uuid references auth.users (id) on delete set null;

update public.transactions set created_by = user_id where created_by is null and group_id is null;
update public.transfers set created_by = user_id where created_by is null and group_id is null;
update public.savings_entries set created_by = user_id where created_by is null and group_id is null;

-- Cíle odkazů ve skupině: (id, group_id) musí jít odkazovat
select pg_temp.ensure_constraint('accounts', 'accounts_id_group_id_key', 'unique (id, group_id)');
select pg_temp.ensure_constraint('categories', 'categories_id_group_id_key', 'unique (id, group_id)');
select pg_temp.ensure_constraint('recurring', 'recurring_id_group_id_key', 'unique (id, group_id)');
select pg_temp.ensure_constraint('savings_goals', 'savings_goals_id_group_id_key', 'unique (id, group_id)');

-- Skupinové záznamy smí odkazovat jen na účty / kategorie / cíle téže skupiny.
-- U osobních řádků je group_id null, takže se tyto klíče nekontrolují (MATCH SIMPLE)
-- a platí původní klíče (x_id, user_id) – a naopak.
select pg_temp.ensure_constraint('recurring', 'recurring_account_group_fkey',
  'foreign key (account_id, group_id) references public.accounts (id, group_id) on delete cascade');
select pg_temp.ensure_constraint('recurring', 'recurring_category_group_fkey',
  'foreign key (category_id, group_id) references public.categories (id, group_id) on delete set null (category_id)');
select pg_temp.ensure_constraint('transactions', 'transactions_account_group_fkey',
  'foreign key (account_id, group_id) references public.accounts (id, group_id) on delete cascade');
select pg_temp.ensure_constraint('transactions', 'transactions_category_group_fkey',
  'foreign key (category_id, group_id) references public.categories (id, group_id) on delete set null (category_id)');
select pg_temp.ensure_constraint('transactions', 'transactions_recurring_group_fkey',
  'foreign key (recurring_id, group_id) references public.recurring (id, group_id) on delete set null (recurring_id)');
select pg_temp.ensure_constraint('transfers', 'transfers_from_account_group_fkey',
  'foreign key (from_account_id, group_id) references public.accounts (id, group_id) on delete cascade');
select pg_temp.ensure_constraint('transfers', 'transfers_to_account_group_fkey',
  'foreign key (to_account_id, group_id) references public.accounts (id, group_id) on delete cascade');
select pg_temp.ensure_constraint('savings_entries', 'savings_entries_goal_group_fkey',
  'foreign key (goal_id, group_id) references public.savings_goals (id, group_id) on delete cascade');
select pg_temp.ensure_constraint('budgets', 'budgets_category_group_fkey',
  'foreign key (category_id, group_id) references public.categories (id, group_id) on delete cascade');

create index if not exists transactions_group_date_idx on public.transactions (group_id, date desc) where group_id is not null;
create index if not exists transfers_group_date_idx on public.transfers (group_id, date desc) where group_id is not null;
create index if not exists savings_entries_group_date_idx on public.savings_entries (group_id, date desc) where group_id is not null;

-- Unikátní názvy kategorií zvlášť pro osobní prostor a pro každou skupinu.
-- Nejdřív vzniknou nové částečné indexy, pak se smaže původní index
-- (drop index if exists: index nahrazuje osobní varianta níže; drop indexu data nemění).
create unique index if not exists categories_personal_name_key
  on public.categories (user_id, type, lower(name)) where group_id is null;
create unique index if not exists categories_group_name_key
  on public.categories (group_id, type, lower(name)) where group_id is not null;
drop index if exists public.categories_user_type_name_key;

-- Jeden rozpočet na kategorii i ve skupině (osobní hlídá stávající unique (user_id, category_id))
create unique index if not exists budgets_group_category_key
  on public.budgets (group_id, category_id) where group_id is not null;

-- ---------------------------------------------------------------------
-- Triggery na datových tabulkách
-- ---------------------------------------------------------------------

-- Před vložením: skupinový řádek nemá user_id; autora určí databáze, ne klient
create or replace function public.set_row_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is not null then
    new.user_id := null;
  end if;
  if tg_argv[0] = 'author' then
    new.created_by := case
      when new.group_id is null then new.user_id
      else coalesce(auth.uid(), new.created_by)
    end;
  end if;
  return new;
end;
$$;

-- Při úpravě: záznam nejde přesunout mezi osobním prostorem a skupinou ani mezi skupinami
-- a autor se nedá přepsat (výjimka: created_by → null při smazání účtu autora)
create or replace function public.keep_row_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id or new.user_id is distinct from old.user_id then
    raise exception using errcode = 'KP400', message = 'Záznam nelze přesunout mezi osobními daty a skupinou.';
  end if;
  -- vnořené if: tabulky bez sloupce created_by se na něj nesmí ani zeptat
  if tg_argv[0] = 'author' then
    if new.created_by is distinct from old.created_by and new.created_by is not null then
      raise exception using errcode = 'KP400', message = 'Autora záznamu nelze změnit.';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
  author text;
begin
  foreach t in array array[
    'accounts', 'categories', 'recurring', 'transactions', 'transfers',
    'savings_goals', 'savings_entries', 'budgets'
  ] loop
    author := case when t in ('transactions', 'transfers', 'savings_entries') then '''author''' else '''-''' end;
    execute format(
      'create or replace trigger %I before insert on public.%I for each row execute function public.set_row_scope(%s)',
      t || '_set_scope', t, author);
    execute format(
      'create or replace trigger %I before update on public.%I for each row execute function public.keep_row_scope(%s)',
      t || '_keep_scope', t, author);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- Limity: max. 10 členů ve skupině, max. 5 skupin na uživatele
-- ---------------------------------------------------------------------

create or replace function public.enforce_group_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- zamknutí skupiny a uživatele: souběžná přidání se nepřelezou přes limit
  perform 1 from public.groups where id = new.group_id for update;
  perform pg_advisory_xact_lock(hashtext('group_limit:' || new.user_id::text));

  if (select count(*) from public.group_members where group_id = new.group_id) >= 10 then
    raise exception using errcode = 'KP422', message = 'Skupina může mít nejvýše 10 členů.';
  end if;
  if (select count(*) from public.group_members where user_id = new.user_id) >= 5 then
    raise exception using errcode = 'KP422', message = 'Uživatel může být nejvýše v 5 skupinách.';
  end if;
  return new;
end;
$$;

create or replace trigger group_members_limits
  before insert on public.group_members
  for each row execute function public.enforce_group_limits();

-- ---------------------------------------------------------------------
-- RLS: skupiny a členové
-- ---------------------------------------------------------------------

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- Skupinu zakládá jen create_group, členy přidávají jen funkce (pozvánky ve fázi 4).
-- U skupiny jde měnit jen název, u člena jen role.
revoke insert, update on public.groups from anon, authenticated;
grant update (name) on public.groups to authenticated;
revoke insert, update on public.group_members from anon, authenticated;
grant update (role) on public.group_members to authenticated;

select pg_temp.ensure_policy('groups', 'groups_select_member', 'select',
  'public.is_group_member(id)', null);
select pg_temp.ensure_policy('groups', 'groups_update_owner', 'update',
  'public.is_group_owner(id)', 'public.is_group_owner(id)');
select pg_temp.ensure_policy('groups', 'groups_delete_owner', 'delete',
  'public.is_group_owner(id)', null);

select pg_temp.ensure_policy('group_members', 'group_members_select_member', 'select',
  'public.is_group_member(group_id)', null);
select pg_temp.ensure_policy('group_members', 'group_members_update_owner', 'update',
  'role <> ''owner'' and public.is_group_owner(group_id)',
  'role in (''editor'', ''viewer'') and public.is_group_owner(group_id)');
select pg_temp.ensure_policy('group_members', 'group_members_delete', 'delete',
  'role <> ''owner'' and (user_id = (select auth.uid()) or public.is_group_owner(group_id))', null);

-- ---------------------------------------------------------------------
-- RLS: skupinová data (osobní politiky *_own zůstávají beze změny –
-- skupinové řádky mají user_id null, takže na ně nedosáhnou)
-- ---------------------------------------------------------------------

do $$
declare
  t text;
  write_rule text;
  delete_rule text;
begin
  foreach t in array array[
    'accounts', 'categories', 'recurring', 'transactions', 'transfers',
    'savings_goals', 'savings_entries', 'budgets'
  ] loop
    if t in ('transactions', 'transfers', 'savings_entries') then
      -- záznamy pohybů: autor (dokud je editor nebo vlastník) nebo vlastník skupiny
      write_rule := 'group_id is not null and (public.is_group_owner(group_id) or (created_by = (select auth.uid()) and public.can_edit_group(group_id)))';
      delete_rule := write_rule;
    else
      -- účty, kategorie, rozpočty, cíle, opakované platby: upravit editor, smazat vlastník
      write_rule := 'group_id is not null and public.can_edit_group(group_id)';
      delete_rule := 'group_id is not null and public.is_group_owner(group_id)';
    end if;

    perform pg_temp.ensure_policy(t, t || '_group_select', 'select',
      'group_id is not null and public.is_group_member(group_id)', null);
    perform pg_temp.ensure_policy(t, t || '_group_insert', 'insert',
      null, 'group_id is not null and public.can_edit_group(group_id)');
    perform pg_temp.ensure_policy(t, t || '_group_update', 'update', write_rule, write_rule);
    perform pg_temp.ensure_policy(t, t || '_group_delete', 'delete', delete_rule, null);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- RPC: vytvoření skupiny
-- ---------------------------------------------------------------------

create or replace function public.create_group(p_name text)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_name text := trim(p_name);
  g public.groups;
begin
  if uid is null then
    raise exception using errcode = 'KP401', message = 'Nejste přihlášeni.';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception using errcode = 'KP400', message = 'Název skupiny musí mít 1–40 znaků.';
  end if;
  perform public.check_rate_limit('create_group', 5, interval '1 day');

  insert into public.groups (name, owner_id) values (v_name, uid) returning * into g;
  -- limit 5 skupin na uživatele hlídá trigger group_members_limits
  insert into public.group_members (group_id, user_id, role) values (g.id, uid, 'owner');

  insert into public.accounts (group_id, name, type) values (g.id, 'Společný účet', 'bank');

  insert into public.categories (group_id, name, type, color, icon) values
    (g.id, 'Jídlo',    'expense', '#D9944A', '🍽️'),
    (g.id, 'Doprava',  'expense', '#4F86B5', '🚌'),
    (g.id, 'Bydlení',  'expense', '#8466AE', '🏠'),
    (g.id, 'Zábava',   'expense', '#CF6679', '🎬'),
    (g.id, 'Zdraví',   'expense', '#3E9C9E', '💊'),
    (g.id, 'Nákupy',   'expense', '#B9774B', '🛍️'),
    (g.id, 'Ostatní',  'expense', '#8A8A8A', '📦'),
    (g.id, 'Výplata',  'income',  '#3A7D5C', '💼'),
    (g.id, 'Ostatní',  'income',  '#6E9E87', '💰');

  return g;
end;
$$;

revoke all on function public.create_group(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: předání vlastnictví (vlastník nemůže odejít, dokud ho nepředá)
-- ---------------------------------------------------------------------

create or replace function public.transfer_ownership(p_group uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  perform 1 from public.groups where id = p_group for update;
  if not public.is_group_owner(p_group) then
    raise exception using errcode = 'KP403', message = 'Vlastnictví může předat jen vlastník skupiny.';
  end if;
  if p_new_owner = uid then
    raise exception using errcode = 'KP400', message = 'Vyberte jiného člena skupiny.';
  end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = p_new_owner) then
    raise exception using errcode = 'KP404', message = 'Tento uživatel není členem skupiny.';
  end if;

  -- nejdřív uvolnit místo vlastníka (ve skupině smí být jen jeden)
  update public.group_members set role = 'editor' where group_id = p_group and user_id = uid;
  update public.group_members set role = 'owner' where group_id = p_group and user_id = p_new_owner;
  update public.groups set owner_id = p_new_owner where id = p_group;
end;
$$;

revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: členové skupiny s přezdívkou (nikdy e-mail); jen pro členy
-- ---------------------------------------------------------------------

create or replace function public.get_group_members(p_group uuid)
returns table (user_id uuid, username text, discriminator text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.username, p.discriminator, m.role, m.joined_at
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  where m.group_id = p_group and public.is_group_member(p_group)
  order by (m.role = 'owner') desc, m.joined_at;
$$;

revoke all on function public.get_group_members(uuid) from public, anon;
grant execute on function public.get_group_members(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Smazání účtu vlastníka: vlastnictví přejde na dalšího člena (editor
-- má přednost, pak nejdéle přítomný). Skupinu bez dalších členů smaže
-- cizí klíč groups.owner_id (on delete cascade) i se všemi daty.
-- ---------------------------------------------------------------------

create or replace function public.handle_user_deleting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
  heir uuid;
begin
  for g in select id from public.groups where owner_id = old.id for update loop
    select m.user_id into heir
    from public.group_members m
    where m.group_id = g.id and m.user_id <> old.id
    order by (m.role = 'editor') desc, m.joined_at, m.user_id
    limit 1;

    if heir is not null then
      update public.group_members set role = 'editor' where group_id = g.id and user_id = old.id;
      update public.group_members set role = 'owner' where group_id = g.id and user_id = heir;
      update public.groups set owner_id = heir where id = g.id;
    end if;
  end loop;
  return old;
end;
$$;

create or replace trigger on_auth_user_deleting
  before delete on auth.users
  for each row execute function public.handle_user_deleting();

-- ---------------------------------------------------------------------
-- Opakované platby: i skupinové (zpracuje je kterýkoli editor / vlastník,
-- zámek řádků zabrání duplicitám při souběhu)
-- ---------------------------------------------------------------------

create or replace function public.process_recurring(p_today date)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.recurring%rowtype;
  d date;
  created integer := 0;
  guard integer;
  anchor integer;
  next_month date;
begin
  for r in
    select * from public.recurring
    where active and next_date <= p_today
      and (
        (group_id is null and user_id = auth.uid())
        or (group_id is not null and public.can_edit_group(group_id))
      )
    for update skip locked
  loop
    d := r.next_date;
    anchor := coalesce(r.anchor_day, extract(day from r.next_date)::integer);
    guard := 0;

    while d <= p_today and guard < 500 loop
      insert into public.transactions (user_id, group_id, account_id, category_id, type, amount, date, note, recurring_id)
      values (r.user_id, r.group_id, r.account_id, r.category_id, r.type, r.amount, d, r.note, r.id);
      created := created + 1;
      guard := guard + 1;

      if r.interval = 'weekly' then
        d := d + 7;
      else
        next_month := (date_trunc('month', d::timestamp) + interval '1 month')::date;
        d := next_month + (least(
          anchor,
          extract(day from (next_month::timestamp + interval '1 month' - interval '1 day'))::integer
        ) - 1);
      end if;
    end loop;

    update public.recurring set next_date = d where id = r.id;
  end loop;

  return created;
end;
$$;

commit;
