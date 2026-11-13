-- Employee self-enrollment. Existing PINs and the configured creator ID are never replaced.
create table scanner_private.operator_registration_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  successful boolean not null default false,
  created_at timestamptz not null default now()
);
create index operator_registration_rate_idx on scanner_private.operator_registration_attempts(ip_hash,created_at desc);
alter table scanner_private.operator_registration_attempts enable row level security;
revoke all on scanner_private.operator_registration_attempts from public,anon,authenticated;
revoke all on sequence scanner_private.operator_registration_attempts_id_seq from public,anon,authenticated;

create function scanner_private.operator_register(p_employee_id text,p_pin text,p_terminal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee text:=upper(trim(p_employee_id)); source text; attempt_id bigint; reply jsonb;
begin
  if employee is null or employee !~ '^[A-Z0-9_.-]{2,45}$' or p_terminal is null or length(p_terminal) not between 8 and 100 then
    return jsonb_build_object('status','invalid');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{6,12}$' then return jsonb_build_object('status','invalid_pin'); end if;
  -- Share the identity lock with login/setup; two first registrations cannot claim the same ID.
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
  if exists(select 1 from scanner_private.operators where employee_id=employee) then return jsonb_build_object('status','exists'); end if;
  -- No client-provided role or name is accepted by this endpoint.
  insert into scanner_private.operators(employee_id,pin_hash,role) values(employee,extensions.crypt(p_pin,extensions.gen_salt('bf',10)),'operator');
  reply:=scanner_private.operator_login(employee,p_pin,p_terminal);
  if reply->>'status'<>'ok' then
    -- Login may be rate-limited by previous guessing of this ID. Roll enrollment back too.
    delete from scanner_private.operators where employee_id=employee;
    return reply;
  end if;
  update scanner_private.operator_registration_attempts set successful=true where id=attempt_id;
  insert into scanner_private.audit_events(operator_employee_id,operator_session_id,terminal_id,action)
    values(employee,(reply->'profile'->>'session_id')::uuid,p_terminal,'operator_register');
  return reply;
end $$;
revoke all on function scanner_private.operator_register(text,text,text) from public,anon,authenticated;
grant execute on function scanner_private.operator_register(text,text,text) to anon,authenticated;
create function public.scanner_operator_register(p_employee_id text,p_pin text,p_terminal text) returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.operator_register(p_employee_id,p_pin,p_terminal); $$;
revoke all on function public.scanner_operator_register(text,text,text) from public;
grant execute on function public.scanner_operator_register(text,text,text) to anon,authenticated;
