-- Preserve old proof records and retire live sessions issued without a PIN.
alter table scanner_private.operators add column pin_setup_required boolean not null default false;
update scanner_private.operators o set pin_setup_required=true
where o.role='operator' and (
  select a.details->>'identity_mode' from scanner_private.audit_events a
  where a.operator_employee_id=o.employee_id and a.action='operator_register'
  order by a.id limit 1
)='declared_id' and not exists (
  select 1 from scanner_private.audit_events a
  where a.action='operator_reset_pin' and a.details->>'employee_id'=o.employee_id
);

revoke execute on function public.scanner_operator_id_login(text,text) from public,anon,authenticated;
revoke execute on function scanner_private.operator_id_login(text,text) from public,anon,authenticated;
update scanner_private.operator_sessions s set revoked_at=now()
where s.revoked_at is null and s.expires_at>now() and exists (
  select 1 from scanner_private.audit_events a where a.operator_session_id=s.id
  and a.action='login' and a.details->>'identity_mode'='declared_id'
);

-- The old three-argument API remains the first-PIN entry point for new and migrated employees.
create or replace function scanner_private.operator_register(p_employee_id text,p_pin text,p_terminal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee text:=upper(trim(p_employee_id)); source text; attempt_id bigint;
        reply jsonb; existing scanner_private.operators%rowtype; existing_id boolean;
begin
  if employee is null or employee !~ '^[A-Z0-9_.-]{2,45}$' or p_terminal is null or length(p_terminal) not between 8 and 100 then
    return jsonb_build_object('status','invalid');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{6,12}$' then return jsonb_build_object('status','invalid_pin'); end if;
  perform pg_advisory_xact_lock(78134112003);
  begin source:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-forwarded-for','unknown'); exception when others then source:='unknown'; end;
  source:=encode(extensions.digest(source,'sha256'),'hex');
  if (select count(*)>=10 from scanner_private.operator_registration_attempts where ip_hash=source and created_at>now()-interval '15 minutes')
     or (select count(*)>=100 from scanner_private.operator_registration_attempts where created_at>now()-interval '1 hour') then
    return jsonb_build_object('status','locked');
  end if;
  insert into scanner_private.operator_registration_attempts(ip_hash) values(source) returning id into attempt_id;
  if exists(select 1 from scanner_private.operator_config where singleton and owner_employee_id=employee) then
    return jsonb_build_object('status','reserved');
  end if;
  if not exists(select 1 from scanner_private.operators where role='owner' and active) then return jsonb_build_object('status','owner_required'); end if;
  select * into existing from scanner_private.operators where employee_id=employee for update;
  existing_id:=found;
  if existing_id then
    if not (existing.role='operator' and existing.active and existing.pin_setup_required) then return jsonb_build_object('status','exists'); end if;
    update scanner_private.operators set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10)),pin_setup_required=false where employee_id=employee;
  else
    insert into scanner_private.operators(employee_id,pin_hash,role) values(employee,extensions.crypt(p_pin,extensions.gen_salt('bf',10)),'operator');
  end if;
  reply:=scanner_private.operator_login(employee,p_pin,p_terminal);
  if reply->>'status'<>'ok' then
    if existing_id then
      update scanner_private.operators set pin_hash=existing.pin_hash,pin_setup_required=true where employee_id=employee;
    else delete from scanner_private.operators where employee_id=employee;
    end if;
    return reply;
  end if;
  update scanner_private.operator_registration_attempts set successful=true where id=attempt_id;
  insert into scanner_private.audit_events(operator_employee_id,operator_session_id,terminal_id,action,details)
    values(employee,(reply->'profile'->>'session_id')::uuid,p_terminal,'operator_register',jsonb_build_object('existing_id',existing_id));
  return reply;
end $$;

-- A reset by the creator consumes the first-PIN option under the same identity lock.
create function scanner_private.finish_pin_setup() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.pin_hash is distinct from old.pin_hash then new.pin_setup_required:=false; end if;
  return new;
end $$;
revoke all on function scanner_private.finish_pin_setup() from public,anon,authenticated;
create trigger scanner_finish_pin_setup before update of pin_hash on scanner_private.operators
for each row when (old.pin_setup_required and new.pin_setup_required)
execute function scanner_private.finish_pin_setup();

create table scanner_private.workstations (
  terminal_id text primary key,
  label text not null default '' check(length(label)<=60),
  last_seen_at timestamptz not null,
  employee_id text not null references scanner_private.operators(employee_id)
);
alter table scanner_private.workstations enable row level security;
revoke all on table scanner_private.workstations from public,anon,authenticated;

create function scanner_private.workstation_heartbeat() returns void
language plpgsql security definer set search_path='' as $$
declare profile jsonb:=scanner_private.operator_profile();
begin
  if profile is null then raise sqlstate '42501' using message='OPERATOR_LOGIN_REQUIRED'; end if;
  insert into scanner_private.workstations(terminal_id,last_seen_at,employee_id)
    values(profile->>'terminal_id',now(),profile->>'employee_id')
    on conflict(terminal_id) do update set last_seen_at=excluded.last_seen_at,employee_id=excluded.employee_id
    where scanner_private.workstations.last_seen_at<now()-interval '30 seconds'
       or scanner_private.workstations.employee_id<>excluded.employee_id;
end $$;

create function scanner_private.manage_workstations(p_terminal text,p_label text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform scanner_private.require_owner();
  if p_terminal is not null then
    if p_label is null or length(trim(p_label))>60 then raise exception 'INVALID_TERMINAL_LABEL'; end if;
    update scanner_private.workstations set label=trim(p_label) where terminal_id=p_terminal;
    if not found then raise exception 'TERMINAL_NOT_FOUND'; end if;
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.last_seen_at desc),'[]') from (
    select terminal_id,label,last_seen_at,employee_id from scanner_private.workstations order by last_seen_at desc limit 500
  ) t);
end $$;
create function public.scanner_workstation_heartbeat() returns void
language sql security invoker set search_path='' as $$ select scanner_private.workstation_heartbeat() $$;
create function public.scanner_manage_workstations(p_terminal text default null,p_label text default null) returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.manage_workstations(p_terminal,p_label) $$;
revoke all on function scanner_private.workstation_heartbeat(),scanner_private.manage_workstations(text,text),
  public.scanner_workstation_heartbeat(),public.scanner_manage_workstations(text,text) from public,anon,authenticated;
grant execute on function scanner_private.workstation_heartbeat(),scanner_private.manage_workstations(text,text),
  public.scanner_workstation_heartbeat(),public.scanner_manage_workstations(text,text) to anon,authenticated;
