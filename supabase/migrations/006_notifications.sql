-- =====================================================================
-- 006 – Upozornění v aplikaci (zvonek)
--
-- Upozornění vytváří výhradně databázové triggery, klient je jen čte
-- a označuje jako přečtená. Typy:
--   invite_received  – nová pozvánka do skupiny (podle tagu)
--   invite_accepted  – někdo přijal mou pozvánku (tag i odkaz)
--   group_expense    – nový výdaj ve skupině (ostatním členům)
--   role_changed     – změna mé role ve skupině
--   member_removed   – vlastník mě odebral ze skupiny
-- data jsonb nese název skupiny a přezdívky v okamžiku události
-- (skupina může být později přejmenovaná nebo smazaná). Nikdy e-maily.
--
-- Bezpečné nad stávající databází: jen přidává tabulku, funkce a triggery.
-- Lze spustit i opakovaně.
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

commit;
