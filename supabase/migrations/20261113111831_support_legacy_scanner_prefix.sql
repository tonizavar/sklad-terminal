-- Accept the legacy SN; barcode prefix without renaming existing devices.
create or replace function scanner_private.apply_operation(p_id text,p_changes jsonb,p_terminal text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := null; -- Operator identity is unavailable without login; record terminal_id instead.
  payload jsonb := jsonb_build_object('changes',p_changes,'terminal',p_terminal);
  previous scanner_private.operations%rowtype;
  c jsonb; d public.devices%rowtype; desired jsonb; expected jsonb; sn text;
  mismatches jsonb := '[]'; result jsonb; exists_now boolean;
begin
  if p_id is null or length(p_id) not between 8 and 200 or p_terminal is null or length(p_terminal) not between 8 and 100
    or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 500 then
    raise exception 'Invalid operation';
  end if;
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
  else
    for c in select value from jsonb_array_elements(p_changes) loop
      sn:=c->>'serial'; desired:=c->'after';
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
      insert into public.movements(event_id,serial,action,worker,created_at,operator_id,terminal_id,occurred_at)
      values(p_id || ':' || sn,sn,c->>'action',coalesce(c->>'worker',''),coalesce(c->>'ts',clock_timestamp()::text),actor,p_terminal,coalesce(c->>'ts',clock_timestamp()::text)::timestamptz);
    end loop;
    result:=jsonb_build_object('status','applied');
  end if;
  insert into scanner_private.operations(id,payload,result,operator_id) values(p_id,payload,result,actor);
  return result;
end $$;
