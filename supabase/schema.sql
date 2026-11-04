-- =====================================================================
-- Kalkulačka peněz – databázové schéma pro Supabase (PostgreSQL 15+)
-- Spusťte celé v Supabase → SQL Editor. Skript je možné spustit opakovaně.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabulky
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  type text not null default 'cash' check (type in ('cash', 'bank', 'card', 'savings', 'other')),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  type text not null check (type in ('expense', 'income')),
  color text not null default '#8A8A8A',
  icon text not null default '📦',
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.recurring (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- šablona transakce
  account_id uuid not null,
  category_id uuid,
  type text not null check (type in ('expense', 'income')),
  amount numeric(12, 2) not null check (amount > 0),
  note text not null default '',
  -- opakování
  interval text not null check (interval in ('weekly', 'monthly')),
  next_date date not null,
  anchor_day smallint check (anchor_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null,
  category_id uuid,
  type text not null check (type in ('expense', 'income')),
  amount numeric(12, 2) not null check (amount > 0),
  date date not null default current_date,
  note text not null default '',
  recurring_id uuid,
  created_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (recurring_id, user_id) references public.recurring (id, user_id) on delete set null (recurring_id)
);

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_account_id uuid not null,
  to_account_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  date date not null default current_date,
  note text not null default '',
  created_at timestamptz not null default now(),
  check (from_account_id <> to_account_id),
  foreign key (from_account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  foreign key (to_account_id, user_id) references public.accounts (id, user_id) on delete cascade
);

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  target_amount numeric(12, 2) not null check (target_amount > 0),
  deadline date,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

-- amount > 0 = vklad, amount < 0 = výběr
create table if not exists public.savings_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid not null,
  amount numeric(12, 2) not null check (amount <> 0),
  date date not null default current_date,
  created_at timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.savings_goals (id, user_id) on delete cascade
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null,
  monthly_limit numeric(12, 2) not null check (monthly_limit > 0),
  created_at timestamptz not null default now(),
  unique (user_id, category_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Indexy
-- ---------------------------------------------------------------------

create index if not exists accounts_user_id_idx on public.accounts (user_id);
create index if not exists categories_user_id_idx on public.categories (user_id);
-- Unikátní názvy kategorií: viz sekce Skupiny (částečné indexy pro osobní a skupinové)
create index if not exists recurring_user_id_idx on public.recurring (user_id);
create index if not exists recurring_next_date_idx on public.recurring (user_id, next_date);
create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);
create index if not exists transfers_user_id_idx on public.transfers (user_id);
create index if not exists transfers_user_date_idx on public.transfers (user_id, date desc);
create index if not exists savings_goals_user_id_idx on public.savings_goals (user_id);
create index if not exists savings_entries_user_id_idx on public.savings_entries (user_id);
create index if not exists savings_entries_user_date_idx on public.savings_entries (user_id, date desc);
create index if not exists budgets_user_id_idx on public.budgets (user_id);

-- ---------------------------------------------------------------------
-- Row Level Security – uživatel vidí a mění jen své řádky
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles_delete_own" on public.profiles for delete to authenticated using (id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'categories', 'recurring', 'transactions', 'transfers',
    'savings_goals', 'savings_entries', 'budgets'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
      t || '_delete_own', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- Výchozí data po registraci: profil, účet „Hotovost“ a kategorie
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(v_username, nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  -- Přezdívka z registrace s náhodným číslem. Když je neplatná nebo obsazená,
  -- registrace neselže – uživatel si ji nastaví po přihlášení.
  if v_username is not null then
    begin
      perform public.validate_username(v_username);
      update public.profiles
      set username = v_username, discriminator = public.pick_discriminator(v_username, null, new.id)
      where id = new.id;
    exception when others then
      null;
    end;
  end if;

  insert into public.accounts (user_id, name, type)
  values (new.id, 'Hotovost', 'cash');

  insert into public.categories (user_id, name, type, color, icon) values
    (new.id, 'Jídlo',    'expense', '#D9944A', '🍽️'),
    (new.id, 'Doprava',  'expense', '#4F86B5', '🚌'),
    (new.id, 'Bydlení',  'expense', '#8466AE', '🏠'),
    (new.id, 'Zábava',   'expense', '#CF6679', '🎬'),
    (new.id, 'Zdraví',   'expense', '#3E9C9E', '💊'),
    (new.id, 'Nákupy',   'expense', '#B9774B', '🛍️'),
    (new.id, 'Ostatní',  'expense', '#8A8A8A', '📦'),
    (new.id, 'Výplata',  'income',  '#3A7D5C', '💼'),
    (new.id, 'Ostatní',  'income',  '#6E9E87', '💰');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- triggerová funkce: nesmí jít volat přes RPC (trigger EXECUTE nepotřebuje)
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Opakované transakce (osobní i skupinové): vytvoří splatné transakce až do p_today včetně.
-- Běží s právy volajícího (RLS platí), řádky zamyká, takže dvě zařízení
-- najednou nevytvoří duplicitní transakce.
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

revoke all on function public.process_recurring(date) from public, anon;
grant execute on function public.process_recurring(date) to authenticated;

-- ---------------------------------------------------------------------
-- Smazání vlastního účtu včetně všech dat (kaskádově přes auth.users)
-- ---------------------------------------------------------------------

create or replace function public.delete_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_user() from public, anon;
grant execute on function public.delete_user() to authenticated;

-- =====================================================================
-- Přezdívky: username + náhodné 4místné číslo (tag „jana#0482“)
-- =====================================================================

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists discriminator text;
alter table public.profiles add column if not exists username_changed_at timestamptz;

-- Kontroly formátu se přidají jen jednou (stávající profily mají přezdívku null, takže projdou)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_username_format' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_username_format check (
      username is null or (
        username ~ '^[A-Za-z0-9_.]{3,20}$'
        and lower(username) <> all (array['admin', 'administrator', 'support', 'system', 'moderator', 'kalkulacka', 'null', 'undefined'])
      )
    );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_discriminator_format' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_discriminator_format check (
      discriminator is null or discriminator ~ '^[0-9]{4}$'
    );
  end if;
end
$$;

-- Kombinace přezdívka + číslo je unikátní bez ohledu na velikost písmen
create unique index if not exists profiles_tag_key on public.profiles (lower(username), discriminator);

-- Klient smí v profilu měnit jen display_name. Přezdívku a číslo nastavují výhradně funkce níže.
revoke insert, update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- Rate limit: záznam každého pokusu, kontroluje databáze
-- ---------------------------------------------------------------------

create table if not exists public.rate_limits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limits_lookup_idx on public.rate_limits (user_id, action, created_at);

-- RLS bez politik: klient tabulku nevidí ani do ní nezapisuje, pracují s ní jen funkce
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.check_rate_limit(p_action text, p_max integer, p_interval interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  used integer;
begin
  if uid is null then
    raise exception using errcode = 'KP401', message = 'Nejste přihlášeni.';
  end if;
  -- souběžné pokusy téhož uživatele o stejnou akci se zpracují postupně
  perform pg_advisory_xact_lock(hashtext(uid::text || ':' || p_action));
  -- počítají se jen pokusy v okně p_interval; starší záznamy nevadí
  select count(*) into used from public.rate_limits
  where user_id = uid and action = p_action and created_at > now() - p_interval;
  if used >= p_max then
    raise exception using errcode = 'KP429', message = 'Příliš mnoho pokusů, zkuste to později.';
  end if;
  insert into public.rate_limits (user_id, action) values (uid, p_action);
end;
$$;

revoke all on function public.check_rate_limit(text, integer, interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Validace přezdívky a výběr čísla
-- ---------------------------------------------------------------------

create or replace function public.validate_username(p_username text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_username is null or p_username !~ '^[A-Za-z0-9_.]{3,20}$' then
    raise exception using errcode = 'KP400',
      message = 'Přezdívka musí mít 3–20 znaků: písmena bez diakritiky, číslice, _ nebo tečku.';
  end if;
  if lower(p_username) = any (array['admin', 'administrator', 'support', 'system', 'moderator', 'kalkulacka', 'null', 'undefined']) then
    raise exception using errcode = 'KP400', message = 'Tuto přezdívku nelze použít.';
  end if;
end;
$$;

-- Vrátí volné číslo pro přezdívku: preferované (pokud je volné), jinak náhodné – nikdy pořadové
create or replace function public.pick_discriminator(p_username text, p_prefer text, p_self uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate text;
begin
  if p_prefer is not null and not exists (
    select 1 from public.profiles
    where lower(username) = lower(p_username) and discriminator = p_prefer and id <> p_self
  ) then
    return p_prefer;
  end if;

  for i in 1..30 loop
    candidate := lpad((1 + floor(random() * 9999))::integer::text, 4, '0');
    if not exists (
      select 1 from public.profiles
      where lower(username) = lower(p_username) and discriminator = candidate and id <> p_self
    ) then
      return candidate;
    end if;
  end loop;

  -- skoro plná přezdívka: náhodně z ještě volných čísel
  select lpad(n::text, 4, '0') into candidate
  from generate_series(1, 9999) as n
  where not exists (
    select 1 from public.profiles
    where lower(username) = lower(p_username) and discriminator = lpad(n::text, 4, '0') and id <> p_self
  )
  order by random()
  limit 1;

  if candidate is null then
    raise exception using errcode = 'KP409', message = 'Tato přezdívka je obsazená. Zvolte prosím jinou.';
  end if;
  return candidate;
end;
$$;

revoke all on function public.validate_username(text) from public, anon, authenticated;
revoke all on function public.pick_discriminator(text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Nastavení / změna přezdívky (jediná cesta, jak ji klient může změnit)
-- První nastavení se do limitu nepočítá, každá další změna max. 1× za 30 dní.
-- ---------------------------------------------------------------------

create or replace function public.set_username(p_username text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v text := trim(p_username);
  cur public.profiles;
  prefer text;
  attempts integer := 0;
begin
  if uid is null then
    raise exception using errcode = 'KP401', message = 'Nejste přihlášeni.';
  end if;
  perform public.validate_username(v);

  select * into cur from public.profiles where id = uid for update;
  if not found then
    raise exception using errcode = 'KP404', message = 'Profil nebyl nalezen.';
  end if;

  if cur.username is not null then
    if cur.username = v then
      return cur;
    end if;
    perform public.check_rate_limit('username_change', 1, interval '30 days');
    prefer := cur.discriminator;
  end if;

  loop
    begin
      update public.profiles
      set username = v,
          discriminator = public.pick_discriminator(v, prefer, uid),
          display_name = v,
          username_changed_at = case when cur.username is null then username_changed_at else now() end
      where id = uid
      returning * into cur;
      return cur;
    exception when unique_violation then
      -- souběh s jiným uživatelem: zkusit jiné náhodné číslo
      attempts := attempts + 1;
      prefer := null;
      if attempts >= 5 then
        raise exception using errcode = 'KP409', message = 'Tato přezdívka je obsazená. Zvolte prosím jinou.';
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

-- =====================================================================
-- Skupiny (sdílené prostory)
-- Řádek dat patří buď uživateli (user_id, group_id null), nebo skupině
-- (group_id, user_id null). Pro skupiny platí paralelní cizí klíče
-- (x_id, group_id) a politiky *_group_*.
-- =====================================================================

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

-- Unikátní názvy kategorií zvlášť pro osobní prostor a pro každou skupinu
create unique index if not exists categories_personal_name_key
  on public.categories (user_id, type, lower(name)) where group_id is null;
create unique index if not exists categories_group_name_key
  on public.categories (group_id, type, lower(name)) where group_id is not null;

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

-- triggerová funkce: nesmí jít volat přes RPC (trigger EXECUTE nepotřebuje)
revoke execute on function public.enforce_group_limits() from public, anon, authenticated;

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

-- triggerová funkce: nesmí jít volat přes RPC (trigger EXECUTE nepotřebuje)
revoke execute on function public.handle_user_deleting() from public, anon, authenticated;

-- =====================================================================
-- Pozvánky do skupin (podle tagu a jednorázovým odkazem / QR)
-- =====================================================================

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
-- Tabulka pozvánek
-- ---------------------------------------------------------------------

create table if not exists public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- pozvánka podle tagu: komu je určena
  invited_user_id uuid references auth.users (id) on delete cascade,
  -- pozvánka odkazem: SHA-256 tokenu (samotný token se neukládá, owner ho uvidí jen při vytvoření)
  token_hash text unique,
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  expires_at timestamptz not null,
  used_at timestamptz,
  -- kdo pozvánku přijal (u odkazu není předem známý)
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- právě jeden typ: podle tagu, nebo odkazem
  check ((invited_user_id is null) <> (token_hash is null))
);

create index if not exists group_invites_group_idx on public.group_invites (group_id, created_at desc);
create index if not exists group_invites_invited_idx on public.group_invites (invited_user_id) where invited_user_id is not null;
-- jeden čekající pozvánkový záznam na uživatele a skupinu
create unique index if not exists group_invites_one_pending_key
  on public.group_invites (group_id, invited_user_id)
  where status = 'pending' and invited_user_id is not null;

alter table public.group_invites enable row level security;
revoke insert, update, delete on public.group_invites from anon, authenticated;

select pg_temp.ensure_policy('group_invites', 'group_invites_select_owner', 'select',
  'public.is_group_owner(group_id)', null);
select pg_temp.ensure_policy('group_invites', 'group_invites_select_invitee', 'select',
  'invited_user_id = (select auth.uid())', null);

-- ---------------------------------------------------------------------
-- Pomocné funkce (jen pro funkce níže, klient je volat nemůže)
-- ---------------------------------------------------------------------

create or replace function public.invite_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- Přidá člena podle pozvánky; plná skupina / limit 5 skupin vrátí českou hlášku místo chyby
create or replace function public.join_from_invite(p_invite public.group_invites, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.group_members (group_id, user_id, role) values (p_invite.group_id, p_user, p_invite.role);
  exception when sqlstate 'KP422' then
    return jsonb_build_object('ok', false, 'message', sqlerrm);
  end;
  update public.group_invites
  set status = 'accepted', used_at = now(), accepted_by = p_user
  where id = p_invite.id;
  return jsonb_build_object('ok', true, 'group_id', p_invite.group_id);
end;
$$;

revoke all on function public.invite_token_hash(text) from public, anon, authenticated;
revoke all on function public.join_from_invite(public.group_invites, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Pozvání podle tagu (jen vlastník, max. 10 za hodinu)
-- Hledá jen přesnou shodu přezdívka (bez ohledu na velikost písmen) + číslo.
-- ---------------------------------------------------------------------

create or replace function public.invite_by_tag(p_group uuid, p_tag text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_tag text := trim(coalesce(p_tag, ''));
  v_name text;
  v_disc text;
  target uuid;
  invite_id uuid;
begin
  if not public.is_group_owner(p_group) then
    raise exception using errcode = 'KP403', message = 'Zvát může jen vlastník skupiny.';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception using errcode = 'KP400', message = 'Neplatná role.';
  end if;
  perform public.check_rate_limit('invite_by_tag', 10, interval '1 hour');

  -- od této chvíle žádné výjimky: pokus musí zůstat započítaný
  v_name := split_part(v_tag, '#', 1);
  v_disc := split_part(v_tag, '#', 2);
  if v_tag !~ '^[A-Za-z0-9_.]{3,20}#[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'message', 'Uživatel nenalezen.');
  end if;

  select id into target from public.profiles
  where lower(username) = lower(v_name) and discriminator = v_disc;
  if target is null then
    return jsonb_build_object('ok', false, 'message', 'Uživatel nenalezen.');
  end if;
  if target = uid then
    return jsonb_build_object('ok', false, 'message', 'Sami sebe pozvat nemůžete.');
  end if;
  if exists (select 1 from public.group_members where group_id = p_group and user_id = target) then
    return jsonb_build_object('ok', false, 'message', 'Tento uživatel už je členem skupiny.');
  end if;
  if (select count(*) from public.group_members where group_id = p_group) >= 10 then
    return jsonb_build_object('ok', false, 'message', 'Skupina je plná (nejvýše 10 členů).');
  end if;

  update public.group_invites set status = 'expired'
  where group_id = p_group and invited_user_id = target and status = 'pending' and expires_at <= now();
  if exists (
    select 1 from public.group_invites
    where group_id = p_group and invited_user_id = target and status = 'pending'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Tento uživatel už má pozvánku, která čeká na přijetí.');
  end if;

  insert into public.group_invites (group_id, invited_user_id, role, created_by, expires_at)
  values (p_group, target, p_role, uid, now() + interval '7 days')
  returning id into invite_id;

  return jsonb_build_object('ok', true, 'invite_id', invite_id);
end;
$$;

-- ---------------------------------------------------------------------
-- Jednorázový odkaz / QR (jen vlastník, max. 10 za hodinu, platnost 24 h)
-- Token: 64 hex znaků ze dvou gen_random_uuid() (pg_strong_random = kryptograficky
-- bezpečný generátor, ~244 bitů náhodnosti). Do databáze se ukládá jen jeho hash.
-- ---------------------------------------------------------------------

create or replace function public.create_invite_link(p_group uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  inv public.group_invites;
begin
  if not public.is_group_owner(p_group) then
    raise exception using errcode = 'KP403', message = 'Odkaz může vytvořit jen vlastník skupiny.';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception using errcode = 'KP400', message = 'Neplatná role.';
  end if;
  perform public.check_rate_limit('invite_link', 10, interval '1 hour');

  insert into public.group_invites (group_id, token_hash, role, created_by, expires_at)
  values (p_group, public.invite_token_hash(v_token), p_role, uid, now() + interval '24 hours')
  returning * into inv;

  return jsonb_build_object('ok', true, 'invite_id', inv.id, 'token', v_token, 'expires_at', inv.expires_at);
end;
$$;

-- Zneplatnění čekající pozvánky (odkazu i pozvánky podle tagu) vlastníkem
create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid;
begin
  select group_id into gid from public.group_invites where id = p_invite;
  if gid is null or not public.is_group_owner(gid) then
    raise exception using errcode = 'KP404', message = 'Pozvánka nebyla nalezena.';
  end if;
  update public.group_invites set status = 'revoked', used_at = now()
  where id = p_invite and status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------
-- Odkaz /join/<token>: náhled (název skupiny) a přijetí.
-- Oba kroky sdílí limit 20 pokusů za hodinu (proti hádání tokenů).
-- Neplatný, použitý, zneplatněný i prošlý token dostanou stejnou hlášku.
-- ---------------------------------------------------------------------

create or replace function public.preview_invite_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.group_invites;
  v_group_name text;
begin
  if auth.uid() is null then
    raise exception using errcode = 'KP401', message = 'Nejste přihlášeni.';
  end if;
  perform public.check_rate_limit('invite_token', 20, interval '1 hour');

  select * into inv from public.group_invites
  where token_hash = public.invite_token_hash(coalesce(p_token, ''));
  if inv.id is null or inv.status <> 'pending' or inv.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'Odkaz je neplatný nebo už vypršel.');
  end if;

  select name into v_group_name from public.groups where id = inv.group_id;
  return jsonb_build_object(
    'ok', true,
    'group_name', v_group_name,
    'role', inv.role,
    'already_member', exists (select 1 from public.group_members where group_id = inv.group_id and user_id = auth.uid())
  );
end;
$$;

create or replace function public.accept_invite_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.group_invites;
begin
  if uid is null then
    raise exception using errcode = 'KP401', message = 'Nejste přihlášeni.';
  end if;
  perform public.check_rate_limit('invite_token', 20, interval '1 hour');

  select * into inv from public.group_invites
  where token_hash = public.invite_token_hash(coalesce(p_token, ''))
  for update;
  if inv.id is null or inv.status <> 'pending' or inv.expires_at <= now() then
    if inv.id is not null and inv.status = 'pending' then
      update public.group_invites set status = 'expired' where id = inv.id;
    end if;
    return jsonb_build_object('ok', false, 'message', 'Odkaz je neplatný nebo už vypršel.');
  end if;

  -- člen odkaz nespotřebuje, může ho použít ještě někdo jiný
  if exists (select 1 from public.group_members where group_id = inv.group_id and user_id = uid) then
    return jsonb_build_object('ok', true, 'group_id', inv.group_id, 'already_member', true);
  end if;

  return public.join_from_invite(inv, uid);
end;
$$;

-- ---------------------------------------------------------------------
-- Pozvánka podle tagu: přijetí / odmítnutí jen tím, komu patří
-- ---------------------------------------------------------------------

create or replace function public.accept_invite(p_invite uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.group_invites;
begin
  select * into inv from public.group_invites
  where id = p_invite and invited_user_id = uid
  for update;
  if inv.id is null then
    raise exception using errcode = 'KP404', message = 'Pozvánka nebyla nalezena.';
  end if;
  if inv.status <> 'pending' or inv.expires_at <= now() then
    if inv.status = 'pending' then
      update public.group_invites set status = 'expired' where id = inv.id;
      return jsonb_build_object('ok', false, 'message', 'Pozvánka už vypršela.');
    end if;
    return jsonb_build_object('ok', false, 'message', 'Pozvánka už není platná.');
  end if;
  if exists (select 1 from public.group_members where group_id = inv.group_id and user_id = uid) then
    update public.group_invites set status = 'accepted', used_at = now(), accepted_by = uid where id = inv.id;
    return jsonb_build_object('ok', true, 'group_id', inv.group_id, 'already_member', true);
  end if;

  return public.join_from_invite(inv, uid);
end;
$$;

create or replace function public.decline_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.group_invites set status = 'declined', used_at = now()
  where id = p_invite and invited_user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception using errcode = 'KP404', message = 'Pozvánka nebyla nalezena.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Seznamy pro UI (přezdívky, nikdy e-maily)
-- ---------------------------------------------------------------------

-- Moje čekající pozvánky podle tagu (pozvaný ještě není člen, skupinu přes RLS nevidí)
create or replace function public.get_my_invites()
returns table (
  id uuid, group_id uuid, group_name text, role text,
  invited_by text, expires_at timestamptz, created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.group_id, g.name, i.role,
         coalesce(p.username || '#' || p.discriminator, 'Bývalý člen'),
         i.expires_at, i.created_at
  from public.group_invites i
  join public.groups g on g.id = i.group_id
  left join public.profiles p on p.id = i.created_by
  where i.invited_user_id = (select auth.uid())
    and i.status = 'pending' and i.expires_at > now()
  order by i.created_at desc;
$$;

-- Pozvánky skupiny pro vlastníka: komu / odkaz, stav (prošlé jako 'expired'), kdo přijal
create or replace function public.get_group_invites(p_group uuid)
returns table (
  id uuid, kind text, invited text, accepted_by text, role text,
  status text, expires_at timestamptz, created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id,
         case when i.token_hash is null then 'tag' else 'link' end,
         case when i.invited_user_id is null then null
              else coalesce(pi.username || '#' || pi.discriminator, 'Smazaný účet') end,
         pa.username || '#' || pa.discriminator,
         i.role,
         case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
         i.expires_at, i.created_at
  from public.group_invites i
  left join public.profiles pi on pi.id = i.invited_user_id
  left join public.profiles pa on pa.id = i.accepted_by
  where i.group_id = p_group and public.is_group_owner(p_group)
  order by i.created_at desc
  limit 50;
$$;

-- ---------------------------------------------------------------------
-- Oprávnění ke spuštění
-- ---------------------------------------------------------------------

revoke all on function public.invite_by_tag(uuid, text, text) from public, anon;
revoke all on function public.create_invite_link(uuid, text) from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
revoke all on function public.preview_invite_token(text) from public, anon;
revoke all on function public.accept_invite_token(text) from public, anon;
revoke all on function public.accept_invite(uuid) from public, anon;
revoke all on function public.decline_invite(uuid) from public, anon;
revoke all on function public.get_my_invites() from public, anon;
revoke all on function public.get_group_invites(uuid) from public, anon;

grant execute on function public.invite_by_tag(uuid, text, text) to authenticated;
grant execute on function public.create_invite_link(uuid, text) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.preview_invite_token(text) to authenticated;
grant execute on function public.accept_invite_token(text) to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.decline_invite(uuid) to authenticated;
grant execute on function public.get_my_invites() to authenticated;
grant execute on function public.get_group_invites(uuid) to authenticated;

-- =====================================================================
-- Upozornění v aplikaci (vytváří je jen triggery)
-- =====================================================================

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
-- Tabulka upozornění
-- ---------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('invite_received', 'invite_accepted', 'group_expense', 'role_changed', 'member_removed')),
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Klient upozornění nevytváří ani nemaže; smí jen nastavit read_at u svých
alter table public.notifications enable row level security;
revoke insert, update, delete on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

select pg_temp.ensure_policy('notifications', 'notifications_select_own', 'select',
  'user_id = (select auth.uid())', null);
select pg_temp.ensure_policy('notifications', 'notifications_update_own', 'update',
  'user_id = (select auth.uid())', 'user_id = (select auth.uid())');

-- ---------------------------------------------------------------------
-- Pomocné funkce
-- ---------------------------------------------------------------------

-- Tag „jana#0482“ (null, když účet už neexistuje nebo nemá přezdívku)
create or replace function public.user_tag(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select username || '#' || discriminator from public.profiles where id = p_user;
$$;

-- Vloží upozornění; příjemce, jehož účet se právě maže, se přeskočí
create or replace function public.notify(p_user uuid, p_type text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
    return;
  end if;
  insert into public.notifications (user_id, type, data) values (p_user, p_type, p_data);
end;
$$;

revoke all on function public.user_tag(uuid) from public, anon, authenticated;
revoke all on function public.notify(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Triggery: pozvánky
-- ---------------------------------------------------------------------

create or replace function public.notify_invite_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group text;
begin
  select name into v_group from public.groups where id = new.group_id;

  -- nová pozvánka podle tagu → pozvanému
  if tg_op = 'INSERT' and new.invited_user_id is not null then
    perform public.notify(new.invited_user_id, 'invite_received', jsonb_build_object(
      'invite_id', new.id,
      'group_id', new.group_id,
      'group_name', v_group,
      'role', new.role,
      'invited_by', coalesce(public.user_tag(new.created_by), 'Bývalý člen')
    ));
  end if;

  -- přijetí (tag i odkaz) → tomu, kdo pozvánku vytvořil
  if tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted'
     and new.created_by is distinct from new.accepted_by then
    perform public.notify(new.created_by, 'invite_accepted', jsonb_build_object(
      'invite_id', new.id,
      'group_id', new.group_id,
      'group_name', v_group,
      'role', new.role,
      'kind', case when new.token_hash is null then 'tag' else 'link' end,
      'accepted_by', public.user_tag(new.accepted_by)
    ));
  end if;
  -- odmítnutí a vypršení se záměrně neoznamují (vlastník je uvidí jen jako stav pozvánky)

  return null;
end;
$$;

create or replace trigger group_invites_notify
  after insert or update of status on public.group_invites
  for each row execute function public.notify_invite_events();

-- triggerová funkce: nesmí jít volat přes RPC (trigger EXECUTE nepotřebuje)
revoke execute on function public.notify_invite_events() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Trigger: nový výdaj ve skupině → všem ostatním členům
-- (výdaje z opakovaných plateb se neoznamují – zapisuje je ten, kdo
-- zrovna otevřel aplikaci, takže by autor byl zavádějící)
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
  if new.group_id is null or new.type <> 'expense' or new.recurring_id is not null then
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

create or replace trigger transactions_notify_group_expense
  after insert on public.transactions
  for each row execute function public.notify_group_expense();

-- triggerová funkce: nesmí jít volat přes RPC (trigger EXECUTE nepotřebuje)
revoke execute on function public.notify_group_expense() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Triggery: změna role a odebrání ze skupiny
-- ---------------------------------------------------------------------

create or replace function public.notify_member_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group text;
begin
  -- změna role (i při předání vlastnictví); kdo si roli změnil sám, upozornění nedostane
  if tg_op = 'UPDATE' then
    if new.role is distinct from old.role and new.user_id is distinct from auth.uid() then
      select name into v_group from public.groups where id = new.group_id;
      perform public.notify(new.user_id, 'role_changed', jsonb_build_object(
        'group_id', new.group_id,
        'group_name', v_group,
        'old_role', old.role,
        'new_role', new.role
      ));
    end if;
    return null;
  end if;

  -- odebrání: ne při vlastním odchodu ani při smazání celé skupiny / účtu
  if tg_op = 'DELETE' and old.user_id is distinct from auth.uid() then
    select name into v_group from public.groups where id = old.group_id;
    if v_group is not null then
      perform public.notify(old.user_id, 'member_removed', jsonb_build_object(
        'group_id', old.group_id,
        'group_name', v_group
      ));
    end if;
  end if;
  return null;
end;
$$;

create or replace trigger group_members_notify
  after update of role or delete on public.group_members
  for each row execute function public.notify_member_events();

-- triggerová funkce: nesmí jít volat přes RPC (trigger EXECUTE nepotřebuje)
revoke execute on function public.notify_member_events() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Realtime: nová upozornění chodí do aplikace hned (RLS platí i tady).
-- Přidá se jen tehdy, když publikace existuje a tabulka v ní ještě není.
-- ---------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
