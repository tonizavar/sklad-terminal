-- ID + PIN identity and server-attributed audit. Shared mode ends atomically at first owner setup.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table scanner_private.operator_config (
  singleton boolean primary key default true check(singleton), enabled boolean not null default false,
  owner_employee_id text, bootstrap_hash text, bootstrap_expires_at timestamptz
);
insert into scanner_private.operator_config(singleton) values(true);
create table scanner_private.operators (
  employee_id text primary key check(employee_id ~ '^[A-Z0-9_.-]{2,45}$'), display_name text not null default '',
  pin_hash text not null, role text not null check(role in ('owner','operator')), active boolean not null default true,
  created_at timestamptz not null default now()
);
create table scanner_private.operator_sessions (
  id uuid primary key default gen_random_uuid(), employee_id text not null references scanner_private.operators(employee_id),
  token_hash text not null unique, terminal_id text not null, created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '12 hours', revoked_at timestamptz
);
create table scanner_private.operator_login_attempts (
  id bigint generated always as identity primary key, employee_id text not null, ip_hash text not null,
  successful boolean not null, created_at timestamptz not null default now()
);
create index operator_login_rate_idx on scanner_private.operator_login_attempts(employee_id,created_at desc);
create index operator_login_ip_idx on scanner_private.operator_login_attempts(ip_hash,created_at desc);
create table scanner_private.audit_events (
  id bigint generated always as identity primary key, event_key text unique, operator_employee_id text,
  operator_session_id uuid, terminal_id text, action text not null, outcome text not null default 'ok',
  details jsonb not null default '{}', occurred_at timestamptz not null default now(), captured_at timestamptz
);
create index audit_operator_time_idx on scanner_private.audit_events(operator_employee_id,occurred_at desc);
alter table public.movements add column if not exists operator_employee_id text;
alter table public.movements add column if not exists operator_session_id uuid;
alter table scanner_private.operator_config enable row level security;
alter table scanner_private.operators enable row level security;
alter table scanner_private.operator_sessions enable row level security;
alter table scanner_private.operator_login_attempts enable row level security;
alter table scanner_private.audit_events enable row level security;
revoke all on all tables in schema scanner_private from public,anon,authenticated;

create function scanner_private.operator_profile() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare token text;
begin
  begin token:=nullif(current_setting('request.headers',true),'')::jsonb->>'x-operator-session'; exception when others then return null; end;
  if token is null or length(token)<>64 then return null; end if;
  return (select jsonb_build_object('employee_id',o.employee_id,'display_name',o.display_name,'role',o.role,
    'session_id',s.id,'expires_at',s.expires_at,'terminal_id',s.terminal_id)
    from scanner_private.operator_sessions s join scanner_private.operators o using(employee_id)
    where s.token_hash=encode(extensions.digest(token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now() and o.active);
end $$;
create function scanner_private.operator_can_read() returns boolean
language sql stable security definer set search_path='' as $$
 select not (select enabled from scanner_private.operator_config where singleton) or scanner_private.operator_profile() is not null;
$$;
create function scanner_private.require_owner() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare profile jsonb:=scanner_private.operator_profile();
begin if profile->>'role' is distinct from 'owner' then raise sqlstate '42501' using message='OWNER_REQUIRED'; end if; return profile; end $$;
revoke all on function scanner_private.operator_profile(),scanner_private.operator_can_read(),scanner_private.require_owner() from public,anon,authenticated;
grant execute on function scanner_private.operator_can_read() to anon,authenticated;

create function scanner_private.operator_login(p_employee_id text,p_pin text,p_terminal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  employee text:=upper(trim(p_employee_id)); operator_row scanner_private.operators%rowtype;
  ip text; failures integer; token text; session_row scanner_private.operator_sessions%rowtype; profile jsonb;
begin
  if employee is null or employee !~ '^[A-Z0-9_.-]{2,45}$' or p_pin is null or length(p_pin)>12
    or p_terminal is null or length(p_terminal) not between 8 and 100 then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(78134112003);
  begin ip:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-forwarded-for','unknown'); exception when others then ip:='unknown'; end;
  ip:=encode(extensions.digest(ip,'sha256'),'hex');
  select count(*) into failures from scanner_private.operator_login_attempts where not successful and created_at>now()-interval '15 minutes'
    and (employee_id=employee or ip_hash=ip)
    and (employee_id<>employee or created_at>coalesce((select max(created_at) from scanner_private.operator_login_attempts where employee_id=employee and successful),'-infinity'));
  if (select count(*)>=5 from scanner_private.operator_login_attempts where employee_id=employee and not successful and created_at>now()-interval '15 minutes'
      and created_at>coalesce((select max(created_at) from scanner_private.operator_login_attempts where employee_id=employee and successful),'-infinity')) or failures>=30 then
    return jsonb_build_object('status','locked');
  end if;
  select * into operator_row from scanner_private.operators where employee_id=employee and active;
  if not found or p_pin !~ '^[0-9]{6,12}$' or extensions.crypt(p_pin,operator_row.pin_hash) is distinct from operator_row.pin_hash then
    insert into scanner_private.operator_login_attempts(employee_id,ip_hash,successful) values(employee,ip,false);
    insert into scanner_private.audit_events(operator_employee_id,terminal_id,action,outcome) values(employee,p_terminal,'login','denied');
    return jsonb_build_object('status','invalid');
  end if;
  token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into scanner_private.operator_sessions(employee_id,token_hash,terminal_id) values(employee,encode(extensions.digest(token,'sha256'),'hex'),p_terminal) returning * into session_row;
  insert into scanner_private.operator_login_attempts(employee_id,ip_hash,successful) values(employee,ip,true);
  insert into scanner_private.audit_events(operator_employee_id,operator_session_id,terminal_id,action) values(employee,session_row.id,p_terminal,'login');
  profile:=jsonb_build_object('employee_id',employee,'display_name',operator_row.display_name,'role',operator_row.role,
    'session_id',session_row.id,'expires_at',session_row.expires_at,'terminal_id',p_terminal);
  return jsonb_build_object('status','ok','token',token,'profile',profile);
end $$;
create function scanner_private.operator_setup(p_employee_id text,p_pin text,p_setup_token text,p_terminal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg scanner_private.operator_config%rowtype; employee text:=upper(trim(p_employee_id));
begin
  perform pg_advisory_xact_lock(78134112003);
  select * into cfg from scanner_private.operator_config where singleton for update;
  if exists(select 1 from scanner_private.operators where role='owner') or cfg.bootstrap_hash is null or cfg.bootstrap_expires_at<now()
    or cfg.owner_employee_id is distinct from employee
    or cfg.bootstrap_hash is distinct from encode(extensions.digest(coalesce(p_setup_token,''),'sha256'),'hex') then
    return jsonb_build_object('status','setup_denied');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{6,12}$' then return jsonb_build_object('status','invalid_pin'); end if;
  insert into scanner_private.operators(employee_id,pin_hash,role,display_name) values(employee,extensions.crypt(p_pin,extensions.gen_salt('bf',10)),'owner','Создатель');
  update scanner_private.operator_config set enabled=true,bootstrap_hash=null,bootstrap_expires_at=null where singleton;
  insert into scanner_private.audit_events(operator_employee_id,terminal_id,action) values(employee,p_terminal,'owner_setup');
  return scanner_private.operator_login(employee,p_pin,p_terminal);
end $$;
create function scanner_private.operator_manage(p_action text,p_employee_id text default null,p_name text default null,p_pin text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile jsonb:=scanner_private.require_owner(); employee text:=upper(trim(p_employee_id));
begin
  if p_action='list' then return (select coalesce(jsonb_agg(jsonb_build_object('employee_id',employee_id,'display_name',display_name,'role',role,'active',active) order by employee_id),'[]') from scanner_private.operators); end if;
  if employee is null or employee !~ '^[A-Z0-9_.-]{2,45}$' or coalesce(length(p_name),0)>100 then raise exception 'INVALID_EMPLOYEE_ID'; end if;
  if p_action='create' then
    if p_pin is null or p_pin !~ '^[0-9]{6,12}$' then raise exception 'PIN_REQUIRES_6_TO_12_DIGITS'; end if;
    insert into scanner_private.operators(employee_id,display_name,pin_hash,role) values(employee,coalesce(p_name,''),extensions.crypt(p_pin,extensions.gen_salt('bf',10)),'operator');
  elsif p_action='reset_pin' then
    if p_pin is null or p_pin !~ '^[0-9]{6,12}$' then raise exception 'PIN_REQUIRES_6_TO_12_DIGITS'; end if;
    update scanner_private.operators set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10)) where employee_id=employee;
    if not found then raise exception 'OPERATOR_NOT_FOUND'; end if;
    update scanner_private.operator_sessions set revoked_at=now() where employee_id=employee and revoked_at is null;
  elsif p_action in ('disable','enable') then
    if employee=profile->>'employee_id' then raise exception 'CANNOT_DISABLE_CURRENT_OWNER'; end if;
    update scanner_private.operators set active=(p_action='enable') where employee_id=employee and role='operator';
    if not found then raise exception 'OPERATOR_NOT_FOUND'; end if;
    if p_action='disable' then update scanner_private.operator_sessions set revoked_at=now() where employee_id=employee and revoked_at is null; end if;
  else raise exception 'INVALID_ACTION'; end if;
  insert into scanner_private.audit_events(operator_employee_id,operator_session_id,terminal_id,action,details)
    values(profile->>'employee_id',(profile->>'session_id')::uuid,profile->>'terminal_id','operator_'||p_action,jsonb_build_object('employee_id',employee));
  return jsonb_build_object('status','ok');
end $$;
create function scanner_private.operator_logout() returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile jsonb:=scanner_private.operator_profile();
begin
  if profile is not null then
    update scanner_private.operator_sessions set revoked_at=now() where id=(profile->>'session_id')::uuid;
    insert into scanner_private.audit_events(operator_employee_id,operator_session_id,terminal_id,action) values(profile->>'employee_id',(profile->>'session_id')::uuid,profile->>'terminal_id','logout');
  end if;
  return jsonb_build_object('status','ok');
end $$;
-- Signed queued operations retain the verified author even after an operator switch.
create function scanner_private.verify_operator_proof(p_session uuid,p_payload text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s scanner_private.operator_sessions%rowtype; o scanner_private.operators%rowtype; body jsonb; captured timestamptz;
begin
  if p_payload is null or octet_length(p_payload)>2000000 or p_signature is null or length(p_signature)<>64 then raise sqlstate '42501' using message='OPERATOR_PROOF_REQUIRED'; end if;
  select * into s from scanner_private.operator_sessions where id=p_session;
  if not found or encode(extensions.hmac(convert_to(p_payload,'UTF8'),decode(s.token_hash,'hex'),'sha256'),'hex') is distinct from p_signature then
    raise sqlstate '42501' using message='INVALID_OPERATOR_PROOF';
  end if;
  body:=p_payload::jsonb; captured:=(body->>'captured_at')::timestamptz;
  select * into o from scanner_private.operators where employee_id=s.employee_id;
  if not o.active or body->>'employee_id' is distinct from s.employee_id or body->>'terminal' is distinct from s.terminal_id
    or body->>'session_id' is distinct from s.id::text or captured is null or captured<s.created_at-interval '1 minute'
    or captured>s.expires_at or (s.revoked_at is not null and captured>s.revoked_at) or captured>now()+interval '5 minutes' then
    raise sqlstate '42501' using message='OPERATOR_PROOF_EXPIRED';
  end if;
  return body || jsonb_build_object('verified_role',o.role);
end $$;

-- Helpers are callable only through the explicit API wrappers below.
revoke all on function scanner_private.operator_login(text,text,text),scanner_private.operator_setup(text,text,text,text),scanner_private.operator_manage(text,text,text,text),scanner_private.operator_logout(),scanner_private.verify_operator_proof(uuid,text,text) from public,anon,authenticated;

create function scanner_private.public_operator_status() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('configured',exists(select 1 from scanner_private.operators where role='owner'),'setup_ready',bootstrap_hash is not null and bootstrap_expires_at>now()) from scanner_private.operator_config where singleton;
$$;
create function public.scanner_operator_status() returns jsonb language sql security invoker set search_path='' as $$ select scanner_private.public_operator_status(); $$;

create or replace function scanner_private.apply_operation(p_id text,p_changes jsonb,p_terminal text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := null; -- Operator identity is unavailable without login; record terminal_id instead.
  payload jsonb := jsonb_build_object('changes',p_changes,'terminal',p_terminal);
  employee text:=nullif(current_setting('sklad.verified_employee',true),'');
  session_id uuid:=nullif(current_setting('sklad.verified_session',true),'')::uuid;
  operator_role text:=nullif(current_setting('sklad.verified_role',true),'');
  real_before jsonb; real_after jsonb;
  previous scanner_private.operations%rowtype;
  c jsonb; d public.devices%rowtype; desired jsonb; expected jsonb; sn text;
  mismatches jsonb := '[]'; result jsonb; exists_now boolean;
begin
  if p_id is null or length(p_id) not between 8 and 200 or p_terminal is null or length(p_terminal) not between 8 and 100
    or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 500 then
    raise exception 'Invalid operation';
  end if;
  if (select enabled from scanner_private.operator_config where singleton) and employee is null then raise sqlstate '42501' using message='OPERATOR_PROOF_REQUIRED'; end if;
  if employee is not null then payload:=payload || jsonb_build_object('operator_employee_id',employee); end if;
  -- Serializes check + mutation + journal, including simultaneous inserts and swaps.
  perform pg_advisory_xact_lock(78134112001);
  select * into previous from scanner_private.operations where id=p_id;
  if found then
    if previous.operator_id is distinct from actor or previous.payload <> payload then raise exception 'Operation identifier reused'; end if;
    return previous.result;
  end if;
  if (select count(*) <> count(distinct value->>'serial') from jsonb_array_elements(p_changes)) then raise exception 'Duplicate serial'; end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    sn := c->>'serial'; desired := c->'after'; expected := c->'before';
    if sn is null or sn !~ '^(SN;)?[A-Z0-9_.-]{2,60}$' then raise exception 'Invalid serial'; end if;
    if coalesce(length(c->>'action'),0) not between 1 and 2200 or coalesce(length(c->>'worker'),0)>200 then raise exception 'Invalid event'; end if;
    if desired is null or desired='null'::jsonb then
      null; -- Logical retirement remains available in shared mode.
    else
      if desired->>'serial' is distinct from sn or desired->>'version' is distinct from p_id || ':' || sn
        or desired->>'status' is null or desired->>'status' not in ('free','issued','repair')
        or coalesce(length(desired->>'holder'),0)>200 or coalesce(length(desired->>'defect'),0)>2000
        or coalesce(length(desired->>'model'),0)>100
        or (desired->>'status'='issued' and (coalesce(trim(desired->>'holder'),'')='' or desired->>'issued_at' is null)) then raise exception 'Invalid scanner state'; end if;
      if desired->>'status'='issued' then perform (desired->>'issued_at')::timestamptz; end if;
    end if;
    select * into d from public.devices where serial=sn for update;
    exists_now := found;
    if employee is not null and operator_role<>'owner' and (not exists_now or d.deleted_at is not null or desired is null or desired='null'::jsonb) then raise sqlstate '42501' using message='OWNER_REQUIRED'; end if;
    -- Versions protect a scanner; this additional invariant protects the worker across different scanners.
    if desired is not null and desired <> 'null'::jsonb and desired->>'status'='issued' and (
      exists(select 1 from public.devices other
        where other.serial<>sn and other.deleted_at is null and other.status='issued'
          and upper(trim(other.holder))=upper(trim(desired->>'holder'))
          and not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'serial'=other.serial
            and (x->'after'='null'::jsonb or x->'after' is null or x->'after'->>'status'<>'issued'
              or upper(trim(x->'after'->>'holder'))<>upper(trim(desired->>'holder')))))
      or exists(select 1 from jsonb_array_elements(p_changes) x where x->>'serial'<>sn
        and x->'after'->>'status'='issued' and upper(trim(x->'after'->>'holder'))=upper(trim(desired->>'holder')))
    ) then mismatches:=mismatches || jsonb_build_array(sn); end if;
    if expected is null or expected='null'::jsonb then
      if exists_now then mismatches := mismatches || jsonb_build_array(sn); end if;
    elsif not exists_now or expected->>'version' is null or d.version is distinct from expected->>'version' then
      mismatches := mismatches || jsonb_build_array(sn);
    end if;
  end loop;
  if jsonb_array_length(mismatches)>0 then
    result := jsonb_build_object('status','conflict','serials',mismatches);
    insert into scanner_private.audit_events(event_key,operator_employee_id,operator_session_id,terminal_id,action,outcome,details) values(p_id||':conflict',employee,session_id,p_terminal,'device_operation','conflict',result);
  else
    for c in select value from jsonb_array_elements(p_changes) loop
      sn:=c->>'serial'; desired:=c->'after';
      select to_jsonb(actual_device) into real_before from public.devices actual_device where actual_device.serial=sn;
      if desired is null or desired='null'::jsonb then
        update public.devices set deleted_at=now(),version=p_id || ':' || sn,last_move=clock_timestamp()::text where serial=sn;
      else
        insert into public.devices(serial,model,status,holder,shift,issued_at,last_move,defect,version,deleted_at)
        values(sn,desired->>'model',desired->>'status',case when desired->>'status'='issued' then desired->>'holder' else '' end,
          case when desired->>'status'='issued' then desired->>'shift' else '—' end,
          case when desired->>'status'='issued' then desired->>'issued_at' else null end,
          desired->>'last_move',coalesce(desired->>'defect',''),desired->>'version',null)
        on conflict(serial) do update set model=excluded.model,status=excluded.status,holder=excluded.holder,shift=excluded.shift,
          issued_at=excluded.issued_at,last_move=excluded.last_move,defect=excluded.defect,version=excluded.version,deleted_at=null;
      end if;
      insert into public.movements(event_id,serial,action,worker,created_at,operator_id,terminal_id,occurred_at,operator_employee_id,operator_session_id)
      values(p_id || ':' || sn,sn,c->>'action',coalesce(c->>'worker',''),coalesce(c->>'ts',clock_timestamp()::text),actor,p_terminal,coalesce(c->>'ts',clock_timestamp()::text)::timestamptz,employee,session_id);
      select to_jsonb(actual_device) into real_after from public.devices actual_device where actual_device.serial=sn;
      insert into scanner_private.audit_events(event_key,operator_employee_id,operator_session_id,terminal_id,action,details,captured_at) values(p_id||':'||sn,employee,session_id,p_terminal,
        case when desired is null or desired='null'::jsonb then 'retire' when real_before is null then 'register' when real_after->>'status'='repair' then 'repair' when real_before->>'status'='repair' then 'repair_complete' when real_before->>'status'='issued' and real_after->>'status'='free' then 'return' when real_after->>'status'='issued' and real_before->>'holder' is distinct from real_after->>'holder' then 'issue' else 'device_update' end,
        jsonb_build_object('serial',sn,'before',real_before,'after',real_after,'operation_id',p_id),coalesce(c->>'ts',clock_timestamp()::text)::timestamptz);
    end loop;
    result:=jsonb_build_object('status','applied');
  end if;
  insert into scanner_private.operations(id,payload,result,operator_id) values(p_id,payload,result,actor);
  return result;
end $$;

create function scanner_private.submit_operator_operation(p_id text,p_changes jsonb,p_events jsonb,p_terminal text,p_session uuid,p_payload text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare body jsonb;
begin
  if p_events is distinct from '[]'::jsonb then raise exception 'INVALID_EVENTS'; end if;
  if (select enabled from scanner_private.operator_config where singleton) then
    body:=scanner_private.verify_operator_proof(p_session,p_payload,p_signature);
    if body->>'id' is distinct from p_id or body->>'kind' is distinct from 'device_operation' or body->>'terminal' is distinct from p_terminal or body->'changes' is distinct from p_changes then
      raise sqlstate '42501' using message='OPERATOR_PROOF_PAYLOAD_MISMATCH';
    end if;
    perform set_config('sklad.verified_employee',body->>'employee_id',true);
    perform set_config('sklad.verified_session',p_session::text,true);
    perform set_config('sklad.verified_role',body->>'verified_role',true);
  else
    perform set_config('sklad.verified_employee','',true);
    perform set_config('sklad.verified_session','',true);
    perform set_config('sklad.verified_role','',true);
  end if;
  return scanner_private.apply_operation(p_id,p_changes,p_terminal);
end $$;
drop function public.scanner_apply(text,jsonb,jsonb,text);
create function public.scanner_apply(p_id text,p_changes jsonb,p_events jsonb default '[]',p_terminal text default null,p_session uuid default null,p_payload text default null,p_signature text default null) returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.submit_operator_operation(p_id,p_changes,p_events,p_terminal,p_session,p_payload,p_signature); $$;

create function scanner_private.secure_pull(p_after bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not scanner_private.operator_can_read() then raise sqlstate '42501' using message='OPERATOR_LOGIN_REQUIRED'; end if;
  return scanner_private.pull_inventory(p_after);
end $$;
create or replace function public.scanner_pull(p_after bigint default 0) returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.secure_pull(p_after); $$;
create function scanner_private.secure_backup(p_action text,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile jsonb;
begin
  if (select enabled from scanner_private.operator_config where singleton) then profile:=scanner_private.require_owner(); end if;
  insert into scanner_private.audit_events(operator_employee_id,operator_session_id,terminal_id,action,details)
    values(profile->>'employee_id',(profile->>'session_id')::uuid,profile->>'terminal_id','backup_'||p_action,jsonb_build_object('name',p_name));
  return scanner_private.backup_action(p_action,p_name);
end $$;
create or replace function public.scanner_backup(p_action text,p_name text default null) returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.secure_backup(p_action,p_name); $$;

create function scanner_private.owner_audit(p_employee_id text,p_from timestamptz,p_to timestamptz,p_before bigint,p_limit integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform scanner_private.require_owner();
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '31 days' or p_limit is null or p_limit not between 1 and 200 then raise exception 'INVALID_AUDIT_PERIOD'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]') from (
    select a.id,a.operator_employee_id,a.terminal_id,a.action,a.outcome,a.details,a.occurred_at,a.captured_at,o.display_name
    from scanner_private.audit_events a left join scanner_private.operators o on o.employee_id=a.operator_employee_id
    where a.occurred_at>=p_from and a.occurred_at<p_to and (p_before is null or a.id<p_before)
      and (nullif(trim(p_employee_id),'') is null or a.operator_employee_id=upper(trim(p_employee_id)))
    order by a.id desc limit p_limit
  ) e);
end $$;
create function scanner_private.record_operator_action(p_action text,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile jsonb:=scanner_private.operator_profile();
begin
  if profile is null then raise sqlstate '42501' using message='OPERATOR_LOGIN_REQUIRED'; end if;
  if p_action not in ('report_export','fleet_export','print_act','queue_reconciliation','cache_refresh') or octet_length(p_details::text)>10000 then raise exception 'INVALID_ACTION'; end if;
  if p_action in ('queue_reconciliation','cache_refresh') then perform scanner_private.require_owner(); end if;
  insert into scanner_private.audit_events(operator_employee_id,operator_session_id,terminal_id,action,details)
    values(profile->>'employee_id',(profile->>'session_id')::uuid,profile->>'terminal_id',p_action,coalesce(p_details,'{}'));
  return jsonb_build_object('status','ok');
end $$;

create function scanner_private.public_operator_session() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('profile',scanner_private.operator_profile(),'server_time',now());
$$;
create function public.scanner_operator_login(p_employee_id text,p_pin text,p_terminal text) returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.operator_login(p_employee_id,p_pin,p_terminal); $$;
create function public.scanner_operator_setup(p_employee_id text,p_pin text,p_setup_token text,p_terminal text) returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.operator_setup(p_employee_id,p_pin,p_setup_token,p_terminal); $$;
create function public.scanner_operator_session() returns jsonb language sql security invoker set search_path='' as $$ select scanner_private.public_operator_session(); $$;
create function public.scanner_operator_logout() returns jsonb language sql security invoker set search_path='' as $$ select scanner_private.operator_logout(); $$;
create function public.scanner_operator_manage(p_action text,p_employee_id text default null,p_name text default null,p_pin text default null) returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.operator_manage(p_action,p_employee_id,p_name,p_pin); $$;
create function public.scanner_owner_audit(p_employee_id text default null,p_from timestamptz default now()-interval '1 day',p_to timestamptz default now()+interval '1 minute',p_before bigint default null,p_limit integer default 100) returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.owner_audit(p_employee_id,p_from,p_to,p_before,p_limit); $$;
create function public.scanner_record_action(p_action text,p_details jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.record_operator_action(p_action,p_details); $$;

drop policy scanner_device_read on public.devices;
drop policy scanner_history_read on public.movements;
create policy scanner_device_read on public.devices for select to anon,authenticated using((select scanner_private.operator_can_read()));
create policy scanner_history_read on public.movements for select to anon,authenticated using((select scanner_private.operator_can_read()));
revoke all on all functions in schema scanner_private from public,anon,authenticated;
grant execute on function scanner_private.operator_can_read(),scanner_private.public_operator_status(),scanner_private.public_operator_session(),
  scanner_private.operator_login(text,text,text),scanner_private.operator_setup(text,text,text,text),scanner_private.operator_logout(),
  scanner_private.operator_manage(text,text,text,text),scanner_private.submit_operator_operation(text,jsonb,jsonb,text,uuid,text,text),
  scanner_private.secure_pull(bigint),scanner_private.secure_backup(text,text),scanner_private.owner_audit(text,timestamptz,timestamptz,bigint,integer),
  scanner_private.record_operator_action(text,jsonb) to anon,authenticated;
revoke all on function public.scanner_operator_status(),public.scanner_operator_session(),public.scanner_operator_login(text,text,text),public.scanner_operator_setup(text,text,text,text),
  public.scanner_operator_logout(),public.scanner_operator_manage(text,text,text,text),public.scanner_owner_audit(text,timestamptz,timestamptz,bigint,integer),public.scanner_record_action(text,jsonb),public.scanner_apply(text,jsonb,jsonb,text,uuid,text,text) from public;
grant execute on function public.scanner_operator_status(),public.scanner_operator_session(),public.scanner_operator_login(text,text,text),public.scanner_operator_setup(text,text,text,text),
  public.scanner_operator_logout(),public.scanner_operator_manage(text,text,text,text),public.scanner_owner_audit(text,timestamptz,timestamptz,bigint,integer),public.scanner_record_action(text,jsonb),public.scanner_apply(text,jsonb,jsonb,text,uuid,text,text) to anon,authenticated;
-- Browser-side exports/printing are durably queued too; their original author survives offline logout.
create function scanner_private.record_signed_action(p_session uuid,p_payload text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare body jsonb:=scanner_private.verify_operator_proof(p_session,p_payload,p_signature); previous scanner_private.audit_events%rowtype;
begin
  if body->>'kind' is distinct from 'client_action' or coalesce(length(body->>'id'),0) not between 8 and 200
    or body->>'action' not in ('report_export','fleet_export','print_act','queue_reconciliation','cache_refresh','logout_offline')
    or octet_length(coalesce((body->'details')::text,'{}'))>10000 then raise exception 'INVALID_ACTION'; end if;
  if body->>'action' in ('queue_reconciliation','cache_refresh') and body->>'verified_role'<>'owner' then raise sqlstate '42501' using message='OWNER_REQUIRED'; end if;
  perform pg_advisory_xact_lock(78134112004);
  select * into previous from scanner_private.audit_events where event_key=body->>'id';
  if found then
    if previous.operator_employee_id is distinct from body->>'employee_id' or previous.action is distinct from body->>'action' or previous.details is distinct from body->'details' then raise exception 'ACTION_IDENTIFIER_REUSED'; end if;
    return jsonb_build_object('status','applied');
  end if;
  insert into scanner_private.audit_events(event_key,operator_employee_id,operator_session_id,terminal_id,action,details,captured_at)
    values(body->>'id',body->>'employee_id',p_session,body->>'terminal',body->>'action',coalesce(body->'details','{}'),(body->>'captured_at')::timestamptz);
  if body->>'action'='logout_offline' then update scanner_private.operator_sessions set revoked_at=least(coalesce(revoked_at,(body->>'captured_at')::timestamptz),(body->>'captured_at')::timestamptz) where id=p_session; end if;
  return jsonb_build_object('status','applied');
end $$;
revoke all on function scanner_private.record_signed_action(uuid,text,text) from public,anon,authenticated;
grant execute on function scanner_private.record_signed_action(uuid,text,text) to anon,authenticated;
create function public.scanner_record_signed_action(p_session uuid,p_payload text,p_signature text) returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.record_signed_action(p_session,p_payload,p_signature); $$;
revoke all on function public.scanner_record_signed_action(uuid,text,text) from public;
grant execute on function public.scanner_record_signed_action(uuid,text,text) to anon,authenticated;

create or replace function scanner_private.create_backup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; backup_name text;
begin
  backup_name:='backup-' || to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD-HH24MISS-MS') || '-' || gen_random_uuid()::text || '.json';
  select jsonb_build_object('version',14,'created_at',now(),
    'devices',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.devices d where deleted_at is null),
    'movements',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.movements m),
    'audit_events',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from scanner_private.audit_events a),
    'operators',(select coalesce(jsonb_agg(jsonb_build_object('employee_id',employee_id,'display_name',display_name,'role',role,'active',active)),'[]') from scanner_private.operators)) into snapshot;
  insert into scanner_private.backups(name,snapshot) values(backup_name,snapshot);
  -- Retain by age, not browser-dependent file count. Never remove before saving the new copy.
  delete from scanner_private.backups where created_at < now()-interval '30 days';
  return jsonb_build_object('name',backup_name,'total',jsonb_array_length(snapshot->'devices'));
end $$;

revoke all on function scanner_private.create_backup() from public,anon,authenticated;
