-- =====================================================================
-- 007 – Triggerové funkce nejdou volat přes RPC
--
-- Supabase Security Advisor: security definer triggerové funkce
-- v public mají EXECUTE pro public, anon i authenticated (Supabase je
-- přiděluje výchozími právy), takže by šly zavolat přes /rest/v1/rpc.
-- Triggery EXECUTE nepotřebují: Postgres právo na funkci kontroluje jen
-- při vytvoření triggeru, ne při jeho spuštění. Odebráním se chování
-- aplikace nemění.
--
-- Nemění se pomocné funkce RLS (is_group_member, can_edit_group,
-- is_group_owner) ani RPC funkce, které aplikace volá.
-- Bezpečné nad stávající databází, lze spustit i opakovaně.
-- =====================================================================

begin;

revoke execute on function public.enforce_group_limits() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_deleting() from public, anon, authenticated;
revoke execute on function public.notify_group_expense() from public, anon, authenticated;
revoke execute on function public.notify_invite_events() from public, anon, authenticated;
revoke execute on function public.notify_member_events() from public, anon, authenticated;

commit;
