-- Requested shared-post mode: IDs are declared, not authenticated identities.
-- Keep server sessions, immutable audit attribution and signed offline operations.
create function scanner_private.operator_id_login(p_employee_id text,p_terminal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 employee text:=upper(trim(p_employee_id)); operator_row scanner_private.operators%rowtype;
 session_row scanner_private.operator_sessions%rowtype; token text; source text; enrolled boolean:=false;
begin
 if employee is null or employee !~ '^[A-Z0-9_.-]{2,45}$' or p_terminal is null or length(p_terminal) not between 8 and 100 then
  return jsonb_build_object('status','invalid');
 end if;
 perform pg_advisory_xact_lock(78134112003);
 if not exists(select 1 from scanner_private.operators where role='owner' and active) then
  return jsonb_build_object('status','owner_required');
 end if;
 select * into operator_row from scanner_private.operators where employee_id=employee;
 if not found then
  if exists(select 1 from scanner_private.operator_config where owner_employee_id=employee) then
   return jsonb_build_object('status','owner_required');
  end if;
  begin source:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-forwarded-for','unknown'); exception when others then source:='unknown'; end;
  source:=encode(extensions.digest(source,'sha256'),'hex');
  if (select count(*)>=10 from scanner_private.operator_registration_attempts where ip_hash=source and created_at>now()-interval '15 minutes') then
   return jsonb_build_object('status','locked');
  end if;
  insert into scanner_private.operator_registration_attempts(ip_hash,successful) values(source,true);
  -- No usable password is assigned or returned. Existing credentials are untouched.
  insert into scanner_private.operators(employee_id,pin_hash,role)
   values(employee,extensions.crypt(encode(extensions.gen_random_bytes(32),'hex'),extensions.gen_salt('bf',8)),'operator') returning * into operator_row;
  enrolled:=true;
 end if;
 if not operator_row.active then
  insert into scanner_private.audit_events(operator_employee_id,terminal_id,action,outcome,details)
   values(employee,p_terminal,'login','denied','{"identity_mode":"declared_id"}');
  return jsonb_build_object('status','disabled');
 end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into scanner_private.operator_sessions(employee_id,token_hash,terminal_id)
  values(employee,encode(extensions.digest(token,'sha256'),'hex'),p_terminal) returning * into session_row;
 if enrolled then
  insert into scanner_private.audit_events(operator_employee_id,operator_session_id,terminal_id,action,details)
   values(employee,session_row.id,p_terminal,'operator_register','{"identity_mode":"declared_id"}');
 end if;
 insert into scanner_private.audit_events(operator_employee_id,operator_session_id,terminal_id,action,details)
  values(employee,session_row.id,p_terminal,'login','{"identity_mode":"declared_id"}');
 return jsonb_build_object('status','ok','token',token,'profile',jsonb_build_object(
  'employee_id',employee,'display_name',operator_row.display_name,'role',operator_row.role,
  'session_id',session_row.id,'expires_at',session_row.expires_at,'terminal_id',p_terminal,'identity_mode','declared_id'));
end $$;
revoke all on function scanner_private.operator_id_login(text,text) from public,anon,authenticated;
grant execute on function scanner_private.operator_id_login(text,text) to anon,authenticated;
create function public.scanner_operator_id_login(p_employee_id text,p_terminal text) returns jsonb
language sql security invoker set search_path='' as $$ select scanner_private.operator_id_login(p_employee_id,p_terminal); $$;
revoke all on function public.scanner_operator_id_login(text,text) from public;
grant execute on function public.scanner_operator_id_login(text,text) to anon,authenticated;
