begin;
alter table public.events add column deposit_lamports bigint not null default 0 check(deposit_lamports in (0,500000000));
alter table public.events add column deposit_distribution_created boolean not null default false;

create table public.event_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  event_id uuid not null references public.events(id),
  wallet_address text not null, treasury_address text not null,
  lamports bigint not null check(lamports=500000000),
  state text not null default 'pending' check(state in ('pending','submitted','confirmed','failed','review_required')),
  payment_signature text unique, signed_transaction text, payment_message text,
  last_valid_block_height bigint, rpc_url text not null,
  confirmed_at timestamptz, created_at timestamptz not null default now(),
  unique(user_id,event_id)
);
-- Keep unsigned proposals immutable. A wallet may sign an earlier proposal after
-- an RPC retry; it must still be recognized rather than orphaning its payment.
create table public.deposit_proposals (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.event_deposits(id),
  message text not null, unsigned_transaction text not null,
  last_valid_block_height bigint not null,
  created_at timestamptz not null default now(),
  unique(deposit_id,message)
);
create index deposit_proposals_deposit_idx on public.deposit_proposals(deposit_id);
create index event_deposits_event_idx on public.event_deposits(event_id);

create table public.sol_payouts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  user_id uuid not null references public.users(id),
  deposit_id uuid references public.event_deposits(id),
  kind text not null check(kind in ('refund','bonus')),
  wallet_address text not null, treasury_address text not null, rpc_url text not null,
  lamports bigint not null check(lamports>0),
  state text not null default 'pending' check(state in
    ('pending','preparing','prepared','submitted','confirmed','failed','review_required')),
  lease_id uuid, lease_expires_at timestamptz,
  signed_transaction text, tx_signature text unique, last_valid_block_height bigint,
  confirmed_at timestamptz, created_at timestamptz not null default now(),
  unique(event_id,user_id,kind)
);
create index sol_payouts_deposit_idx on public.sol_payouts(deposit_id);
create index sol_payouts_user_idx on public.sol_payouts(user_id);
create index sol_payouts_event_idx on public.sol_payouts(event_id);

create function public.create_deposit_intent(p_user_id uuid,p_event_id uuid,p_treasury text,p_rpc_url text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.events; d public.event_deposits; w text;
begin
  select wallet_address into w from public.users where id=p_user_id and role='student';
  if not found then raise sqlstate 'PT403' using message='Student access required'; end if;
  select * into e from public.events where id=p_event_id for share;
  if not found then raise sqlstate 'PT404' using message='Event not found'; end if;
  if e.deposit_lamports=0 then raise sqlstate 'PT409' using message='This legacy event does not require a deposit'; end if;
  select * into d from public.event_deposits where user_id=p_user_id and event_id=p_event_id;
  if found then
    if d.state='pending' and (now()>e.event_date+interval '2 hours' or e.deposit_distribution_created) then
      raise sqlstate 'PT409' using message='Registration is closed';
    end if;
    return to_jsonb(d);
  end if;
  if now()>e.event_date+interval '2 hours' or e.deposit_distribution_created then
    raise sqlstate 'PT409' using message='Registration is closed';
  end if;
  insert into public.event_deposits(user_id,event_id,wallet_address,treasury_address,lamports,rpc_url)
    values(p_user_id,p_event_id,w,p_treasury,e.deposit_lamports,p_rpc_url)
    on conflict(user_id,event_id) do nothing returning * into d;
  if not found then select * into d from public.event_deposits where user_id=p_user_id and event_id=p_event_id; end if;
  return to_jsonb(d);
end $$;

create function public.bind_deposit_payment(p_user_id uuid,p_deposit_id uuid,p_signature text,p_signed text,p_message text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.event_deposits; e public.events; proposal public.deposit_proposals;
begin
  select ev.* into e from public.events ev join public.event_deposits dep on dep.event_id=ev.id
    where dep.id=p_deposit_id for share of ev;
  select * into d from public.event_deposits where id=p_deposit_id and user_id=p_user_id for update;
  if not found then raise sqlstate 'PT404' using message='Deposit not found'; end if;
  if d.payment_signature is not null then
    if d.payment_signature <> p_signature then raise sqlstate 'PT409' using message='Another payment is already bound; reconcile it first'; end if;
    return to_jsonb(d);
  end if;
  if now()>e.event_date+interval '2 hours' or e.deposit_distribution_created then
    raise sqlstate 'PT409' using message='Registration is closed';
  end if;
  select * into proposal from public.deposit_proposals where deposit_id=d.id and message=p_message;
  if not found then raise sqlstate 'PT400' using message='Unrecognized payment transaction'; end if;
  update public.event_deposits set payment_signature=p_signature,signed_transaction=p_signed,
    payment_message=p_message,last_valid_block_height=proposal.last_valid_block_height,state='submitted'
    where id=d.id returning * into d;
  return to_jsonb(d);
end $$;

create function public.queue_deposit_refund(p_user_id uuid,p_event_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare d public.event_deposits;
begin
  select * into d from public.event_deposits where user_id=p_user_id and event_id=p_event_id and state='confirmed';
  if not found then return; end if;
  if not exists(select 1 from public.attendance where user_id=p_user_id and event_id=p_event_id) then return; end if;
  insert into public.sol_payouts(event_id,user_id,deposit_id,kind,wallet_address,treasury_address,rpc_url,lamports)
    values(d.event_id,d.user_id,d.id,'refund',d.wallet_address,d.treasury_address,d.rpc_url,d.lamports)
    on conflict(event_id,user_id,kind) do nothing;
end $$;

create function public.confirm_deposit_payment(p_deposit_id uuid,p_signature text)
returns void language plpgsql security invoker set search_path='' as $$
declare d public.event_deposits;
begin
  select * into d from public.event_deposits where id=p_deposit_id for update;
  if not found or d.payment_signature is distinct from p_signature then
    raise sqlstate 'PT409' using message='Deposit transaction changed';
  end if;
  if d.state='confirmed' then return; end if;
  if d.state not in ('submitted','review_required') then raise sqlstate 'PT409' using message='Invalid deposit state'; end if;
  update public.event_deposits set state='confirmed',confirmed_at=now() where id=d.id;
  perform public.queue_deposit_refund(d.user_id,d.event_id);
end $$;

-- QR attendance is still the authority for refund eligibility, not the mint result.
create or replace function public.record_attendance(p_user_id uuid,p_event_id uuid,p_qr_token text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.events; a public.attendance; inserted boolean:=false;
begin
  if not exists(select 1 from public.users where id=p_user_id and role='student') then
    raise sqlstate 'PT403' using message='Student access required';
  end if;
  select * into e from public.events where id=p_event_id for share;
  if not found then raise sqlstate 'PT404' using message='Event not found'; end if;
  if p_qr_token is null or e.qr_token<>p_qr_token then raise sqlstate 'PT403' using message='Invalid QR token'; end if;
  if now()<e.event_date-interval '15 minutes' or now()>e.event_date+interval '2 hours' then
    raise sqlstate 'PT403' using message='Attendance is closed';
  end if;
  if e.deposit_lamports>0 and not exists(select 1 from public.event_deposits
    where user_id=p_user_id and event_id=p_event_id and state='confirmed') then
    raise sqlstate 'PT402' using message='A finalized 0.5 SOL Devnet deposit is required';
  end if;
  insert into public.attendance(user_id,event_id,mint_status) values(p_user_id,p_event_id,'pending')
    on conflict(user_id,event_id) do nothing returning * into a;
  inserted:=found;
  if not inserted then select * into a from public.attendance where user_id=p_user_id and event_id=p_event_id; end if;
  perform public.queue_deposit_refund(p_user_id,p_event_id);
  return jsonb_build_object('created',inserted,'attendance',to_jsonb(a));
end $$;

create function public.distribute_no_show_deposits(p_admin_id uuid,p_event_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.events; attendees bigint; pool bigint; share bigint; remainder bigint;
begin
  select * into e from public.events where id=p_event_id for update;
  if not found then raise sqlstate 'PT404' using message='Event not found'; end if;
  if not public.can_manage_club(p_admin_id,e.club_id) then raise sqlstate 'PT403' using message='Club access denied'; end if;
  if e.deposit_distribution_created then return jsonb_build_object('already_created',true); end if;
  if now()<=e.event_date+interval '2 hours' then raise sqlstate 'PT409' using message='Attendance is still open'; end if;
  if exists(select 1 from public.event_deposits where event_id=e.id and state in ('submitted','review_required')) then
    raise sqlstate 'PT409' using message='Reconcile pending deposit payments before distribution';
  end if;
  select count(*) into attendees from public.event_deposits d where d.event_id=e.id and d.state='confirmed'
    and exists(select 1 from public.attendance a where a.user_id=d.user_id and a.event_id=e.id);
  select coalesce(sum(lamports),0) into pool from public.event_deposits d where d.event_id=e.id and d.state='confirmed'
    and not exists(select 1 from public.attendance a where a.user_id=d.user_id and a.event_id=e.id);
  if attendees=0 then raise sqlstate 'PT409' using message='No attendees; funds remain held for operator review'; end if;
  -- All deposits for one event must use the same custody account/network.
  if (select count(distinct(treasury_address,rpc_url)) from public.event_deposits where event_id=e.id and state='confirmed')>1 then
    raise sqlstate 'PT409' using message='Mixed custody configuration requires operator review';
  end if;
  share:=pool/attendees; remainder:=pool%attendees;
  insert into public.sol_payouts(event_id,user_id,kind,wallet_address,treasury_address,rpc_url,lamports)
    select e.id,x.user_id,'bonus',x.wallet_address,x.treasury_address,x.rpc_url,
      share+case when x.position<=remainder then 1 else 0 end
    from (select d.*,row_number() over(order by d.wallet_address,d.user_id) as position
      from public.event_deposits d where d.event_id=e.id and d.state='confirmed'
      and exists(select 1 from public.attendance a where a.user_id=d.user_id and a.event_id=e.id)) x
    where share+case when x.position<=remainder then 1 else 0 end>0
    on conflict(event_id,user_id,kind) do nothing;
  update public.events set deposit_distribution_created=true where id=e.id;
  return jsonb_build_object('pool_lamports',pool,'attendees',attendees);
end $$;

-- New events require the deposit; existing events remain unchanged.
create or replace function public.create_club_event(p_admin_id uuid,p_club_id uuid,p_title text,
  p_description text,p_event_date timestamptz,p_qr_token text,p_badge_key text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.events;
begin
  perform 1 from public.clubs where id=p_club_id for share;
  if not public.can_manage_club(p_admin_id,p_club_id) then raise sqlstate 'PT403' using message='Club access denied'; end if;
  if p_event_date is null or p_event_date<=now() then raise sqlstate 'PT400' using message='Event must be in the future'; end if;
  insert into public.events(club_id,title,description,event_date,qr_token,badge_key,deposit_lamports)
    values(p_club_id,p_title,p_description,p_event_date,p_qr_token,p_badge_key,500000000) returning * into e;
  return to_jsonb(e);
end $$;

do $$ declare t text; f record; begin
  foreach t in array array['event_deposits','deposit_proposals','sol_payouts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('create_deposit_intent','bind_deposit_payment',
      'queue_deposit_refund','confirm_deposit_payment','distribute_no_show_deposits') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
