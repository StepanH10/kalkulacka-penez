-- =====================================================================
-- 002 – Přezdívky: username + náhodné 4místné číslo (tag „jana#0482“)
-- Bezpečné nad stávající databází: jen přidává sloupce, indexy, tabulku
-- a funkce. Žádná data se nemažou ani nepřepisují. Lze spustit i opakovaně.
-- =====================================================================

begin;

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

-- ---------------------------------------------------------------------
-- Registrace: přezdívka z formuláře + náhodné číslo do nového profilu
-- (create or replace – trigger on_auth_user_created zůstává beze změny)
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

commit;
