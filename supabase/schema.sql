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
-- Název kategorie je unikátní v rámci typu (bez ohledu na velikost písmen)
create unique index if not exists categories_user_type_name_key on public.categories (user_id, type, lower(name));
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
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

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

-- ---------------------------------------------------------------------
-- Opakované transakce: vytvoří splatné transakce až do p_today včetně.
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
    where user_id = auth.uid() and active and next_date <= p_today
    for update skip locked
  loop
    d := r.next_date;
    anchor := coalesce(r.anchor_day, extract(day from r.next_date)::integer);
    guard := 0;

    while d <= p_today and guard < 500 loop
      insert into public.transactions (user_id, account_id, category_id, type, amount, date, note, recurring_id)
      values (r.user_id, r.account_id, r.category_id, r.type, r.amount, d, r.note, r.id);
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
