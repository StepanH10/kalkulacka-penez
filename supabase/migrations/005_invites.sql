-- =====================================================================
-- 005 – Pozvánky do skupin: podle tagu (jana#0482) a jednorázovým odkazem / QR
--
-- Pozvánky vytváří a mění výhradně funkce níže (klient nemá insert/update/delete).
-- Funkce s limitem pokusů při neúspěchu nevyhazují chybu, ale vrací
-- { ok: false, message } – jinak by se s chybou vrátil i zápis do rate_limits
-- a limit proti hádání tagů / tokenů by nefungoval.
--
-- Bezpečné nad stávající databází: jen přidává tabulku a funkce, nic nemaže.
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

commit;
