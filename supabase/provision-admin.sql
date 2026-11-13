-- Execute in the same SQL Editor session after setting sklad.admin_email.
-- Account creation/password setting happens in Supabase Auth, not by direct auth.users writes.
do $$
declare member_id uuid; configured_email text := current_setting('sklad.admin_email',true);
begin
  if configured_email is null or configured_email='' or configured_email='your-email@example.com' then
    raise exception 'Set sklad.admin_email to the confirmed administrator email first';
  end if;
  select id into strict member_id from auth.users where lower(email)=lower(configured_email) and email_confirmed_at is not null;
  create schema if not exists scanner_private;
  create table if not exists scanner_private.members (
    user_id uuid primary key references auth.users(id) on delete cascade,
    role text not null check(role in ('operator','admin'))
  );
  revoke all on schema scanner_private from public,anon,authenticated;
  revoke all on scanner_private.members from public,anon,authenticated;
  insert into scanner_private.members(user_id,role) values(member_id,'admin')
    on conflict(user_id) do update set role=excluded.role;
end $$;
