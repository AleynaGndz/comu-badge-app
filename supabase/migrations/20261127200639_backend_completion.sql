-- Existing records are preserved. Duplicate or invalid legacy data aborts this
-- transaction instead of being deleted or silently reassigned.
begin;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(), wallet_address text not null,
  name text, role text not null default 'student', created_at timestamptz default now()
);
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(), name text not null,
  admin_id uuid references public.users(id)
);
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(), club_id uuid references public.clubs(id),
  title text not null, description text, event_date timestamptz not null,
  qr_token text not null, created_at timestamptz default now()
);
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  event_id uuid not null references public.events(id), nft_asset_id text,
  mint_status text not null default 'pending', created_at timestamptz default now(), tx_signature text
);
create table if not exists public.auth_nonces (
  id uuid primary key default gen_random_uuid(), wallet_address text not null,
  nonce text not null, created_at timestamptz default now(),
  expires_at timestamptz not null, used boolean not null default false
);
create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(), sponsor_id uuid references public.users(id),
  title text not null, description text, required_badges integer not null default 3
);
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  reward_id uuid not null references public.rewards(id), code text not null,
  status text not null default 'unused', created_at timestamptz default now(), used_at timestamptz
);

-- Preserve legacy status values while permitting the final state this backend writes.
-- Only single-column checks are extended; unrelated/composite invariants stay intact.
do $$ declare c record; begin
  for c in select con.conname, pg_get_expr(con.conbin, con.conrelid) as expression
    from pg_constraint con join pg_attribute a on a.attrelid = con.conrelid
    where con.conrelid = 'public.attendance'::regclass and con.contype = 'c'
      and a.attname = 'mint_status' and con.conkey = array[a.attnum]
  loop
    execute format('alter table public.attendance drop constraint %I', c.conname);
    execute format('alter table public.attendance add constraint %I check ((%s) or mint_status = %L)',
      c.conname, c.expression, 'minted');
  end loop;
end $$;

alter table public.users alter column role set default 'student';
alter table public.auth_nonces alter column used set default false;
alter table public.auth_nonces add column if not exists requester_hash text;
alter table public.events add column if not exists badge_key text;
alter table public.rewards add column if not exists active boolean not null default true;
alter table public.rewards add column if not exists expires_at timestamptz;
alter table public.coupons add column if not exists used_by uuid references public.users(id);

create unique index if not exists users_wallet_unique on public.users(wallet_address);
create unique index if not exists attendance_user_event_unique on public.attendance(user_id, event_id);
create unique index if not exists auth_nonce_unique on public.auth_nonces(nonce);
create unique index if not exists coupons_user_reward_unique on public.coupons(user_id, reward_id);
create unique index if not exists coupons_code_unique on public.coupons(code);
create index if not exists nonce_created_idx on public.auth_nonces(created_at);
create index if not exists nonce_expiry_idx on public.auth_nonces(expires_at);
create index if not exists nonce_wallet_created_idx on public.auth_nonces(wallet_address, created_at);
create index if not exists nonce_requester_created_idx on public.auth_nonces(requester_hash, created_at);
create index if not exists events_club_idx on public.events(club_id);
create index if not exists clubs_admin_idx on public.clubs(admin_id);
create index if not exists attendance_event_idx on public.attendance(event_id);
create index if not exists rewards_sponsor_idx on public.rewards(sponsor_id);
create index if not exists coupons_reward_idx on public.coupons(reward_id);
create index if not exists coupons_used_by_idx on public.coupons(used_by);

create table public.badge_mint_jobs (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null unique references public.attendance(id),
  wallet_address text not null, title text not null, metadata_uri text not null,
  state text not null default 'pending' check (state in
    ('pending', 'preparing', 'prepared', 'submitted', 'confirmed', 'failed', 'review_required')),
  lease_id uuid, lease_expires_at timestamptz,
  signed_transaction text, tx_signature text unique, last_valid_block_height bigint,
  failed_attempts jsonb not null default '[]'::jsonb,
  rpc_url text, tree_address text, asset_id text, confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mint_payload_complete check (
    state not in ('prepared','submitted','confirmed','review_required') or
    (signed_transaction is not null and tx_signature is not null and
     last_valid_block_height is not null and rpc_url is not null and tree_address is not null)
  )
);

-- These functions are service-only and run as the caller. They do not bypass RLS.
create function public.issue_login_nonce(p_wallet text, p_nonce text, p_requester_hash text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  -- Bound random-wallet flooding as well as per-wallet and trusted-proxy sources.
  perform pg_advisory_xact_lock(75264101);
  delete from public.auth_nonces where expires_at < now() - interval '1 day';
  if (select count(*) from public.auth_nonces where created_at > now() - interval '1 minute') >= 300
    or (select count(*) from public.auth_nonces where wallet_address = p_wallet
        and created_at > now() - interval '1 minute') >= 5
    or (p_requester_hash is not null and
       (select count(*) from public.auth_nonces where requester_hash = p_requester_hash
        and created_at > now() - interval '1 minute') >= 30) then
    return false;
  end if;
  insert into public.auth_nonces(wallet_address, nonce, expires_at, used, requester_hash)
    values(p_wallet, p_nonce, now() + interval '5 minutes', false, p_requester_hash);
  return true;
end $$;

create function public.record_attendance(p_user_id uuid, p_event_id uuid, p_qr_token text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare e public.events; a public.attendance; inserted boolean := false;
begin
  if not exists(select 1 from public.users where id = p_user_id and role = 'student') then
    raise sqlstate 'PT403' using message = 'Student access required';
  end if;
  -- Shares the event lock with metadata assignment/deletion.
  select * into e from public.events where id = p_event_id for share;
  if not found then raise sqlstate 'PT404' using message = 'Event not found'; end if;
  if p_qr_token is null or e.qr_token <> p_qr_token then
    raise sqlstate 'PT403' using message = 'Invalid QR token';
  end if;
  if now() < e.event_date - interval '15 minutes' or now() > e.event_date + interval '2 hours' then
    raise sqlstate 'PT403' using message = 'Attendance is closed';
  end if;
  insert into public.attendance(user_id, event_id, mint_status)
    values(p_user_id, p_event_id, 'pending')
    on conflict(user_id, event_id) do nothing returning * into a;
  inserted := found;
  if not inserted then
    select * into a from public.attendance where user_id = p_user_id and event_id = p_event_id;
  end if;
  return jsonb_build_object('created', inserted, 'attendance', to_jsonb(a));
end $$;

create function public.assign_event_badge(p_admin_id uuid, p_event_id uuid, p_badge_key text)
returns void language plpgsql security invoker set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where id = p_event_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Event not found'; end if;
  if not exists(select 1 from public.clubs c join public.users u on u.id = c.admin_id
    where c.id = e.club_id and u.id = p_admin_id and u.role = 'admin') then
    raise sqlstate 'PT403' using message = 'Club access denied';
  end if;
  if exists(select 1 from public.attendance where event_id = p_event_id) and
    (e.badge_key is not null or exists(
      select 1 from public.attendance a where a.event_id = p_event_id and
        (a.mint_status <> 'pending' or a.tx_signature is not null or a.nft_asset_id is not null)
    ) or exists(select 1 from public.badge_mint_jobs j join public.attendance a on a.id = j.attendance_id
      where a.event_id = p_event_id)) then
    raise sqlstate 'PT409' using message = 'Badge cannot change after attendance';
  end if;
  update public.events set badge_key = p_badge_key where id = p_event_id;
end $$;

create function public.complete_badge_mint(p_job_id uuid, p_signature text, p_asset_id text)
returns void language plpgsql security invoker set search_path = '' as $$
declare j public.badge_mint_jobs;
begin
  select * into j from public.badge_mint_jobs where id = p_job_id for update;
  if not found or j.tx_signature is distinct from p_signature then
    raise sqlstate 'PT409' using message = 'Mint transaction changed';
  end if;
  if j.state = 'confirmed' then return; end if;
  if j.state not in ('prepared', 'submitted', 'review_required') then
    raise sqlstate 'PT409' using message = 'Invalid mint state';
  end if;
  update public.badge_mint_jobs set state = 'confirmed', asset_id = p_asset_id,
    confirmed_at = now() where id = p_job_id;
  update public.attendance set tx_signature = p_signature, nft_asset_id = p_asset_id,
    mint_status = 'minted' where id = j.attendance_id;
end $$;

-- Called only after the server independently observes a finalized on-chain error.
-- Unknown/expired results cannot use this path.
create function public.reset_failed_badge_mint(p_job_id uuid, p_signature text)
returns void language plpgsql security invoker set search_path = '' as $$
declare j public.badge_mint_jobs;
begin
  select * into j from public.badge_mint_jobs where id = p_job_id for update;
  if not found or j.state <> 'failed' or j.tx_signature is distinct from p_signature then
    raise sqlstate 'PT409' using message = 'Failed mint transaction changed';
  end if;
  update public.badge_mint_jobs set state = 'pending',
    failed_attempts = failed_attempts || jsonb_build_array(jsonb_build_object(
      'signature', tx_signature, 'rpc_url', rpc_url, 'tree_address', tree_address, 'retried_at', now())),
    signed_transaction = null, tx_signature = null, last_valid_block_height = null,
    rpc_url = null, tree_address = null, lease_id = null, lease_expires_at = null
    where id = p_job_id;
end $$;

create function public.issue_reward_coupon(p_user_id uuid, p_reward_id uuid, p_code text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.rewards; c public.coupons; badge_count integer;
begin
  if not exists(select 1 from public.users where id = p_user_id and role = 'student') then
    raise sqlstate 'PT403' using message = 'Student access required';
  end if;
  select * into r from public.rewards where id = p_reward_id for share;
  if not found then raise sqlstate 'PT404' using message = 'Reward not found'; end if;
  if not r.active or (r.expires_at is not null and r.expires_at <= now()) then
    raise sqlstate 'PT409' using message = 'Reward is closed';
  end if;
  select count(*) into badge_count from public.badge_mint_jobs j
    join public.attendance a on a.id = j.attendance_id
    where a.user_id = p_user_id and j.state = 'confirmed';
  if badge_count < r.required_badges then
    raise sqlstate 'PT403' using message = 'Not enough verified badges';
  end if;
  insert into public.coupons(user_id, reward_id, code, status)
    values(p_user_id, p_reward_id, p_code, 'unused')
    on conflict(user_id, reward_id) do nothing returning * into c;
  if not found then
    select * into c from public.coupons where user_id = p_user_id and reward_id = p_reward_id;
  end if;
  return to_jsonb(c);
end $$;

create function public.redeem_reward_coupon(p_sponsor_id uuid, p_code text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.rewards; c public.coupons;
begin
  if not exists(select 1 from public.users where id = p_sponsor_id and role = 'sponsor') then
    raise sqlstate 'PT403' using message = 'Sponsor access required';
  end if;
  select * into c from public.coupons where code = p_code for update;
  if not found then raise sqlstate 'PT404' using message = 'Coupon not found'; end if;
  select * into r from public.rewards where id = c.reward_id for share;
  if r.sponsor_id is distinct from p_sponsor_id then
    raise sqlstate 'PT403' using message = 'Reward access denied';
  end if;
  if c.status <> 'unused' then raise sqlstate 'PT409' using message = 'Coupon already used'; end if;
  if not r.active or (r.expires_at is not null and r.expires_at <= now()) then
    raise sqlstate 'PT409' using message = 'Reward is closed';
  end if;
  update public.coupons set status = 'used', used_at = now(), used_by = p_sponsor_id
    where id = c.id returning * into c;
  return to_jsonb(c);
end $$;

-- Custom wallet JWTs are checked in Next.js, not Supabase Auth. Only the server
-- service key should access these tables; anon/authenticated receive no access.
do $$ declare table_name text; begin
  foreach table_name in array array['users','clubs','events','attendance','auth_nonces','rewards','coupons','badge_mint_jobs'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end $$;
revoke all on function public.issue_login_nonce(text,text,text) from public, anon, authenticated;
revoke all on function public.record_attendance(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.assign_event_badge(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.complete_badge_mint(uuid,text,text) from public, anon, authenticated;
revoke all on function public.reset_failed_badge_mint(uuid,text) from public, anon, authenticated;
revoke all on function public.issue_reward_coupon(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.redeem_reward_coupon(uuid,text) from public, anon, authenticated;
grant execute on function public.issue_login_nonce(text,text,text) to service_role;
grant execute on function public.record_attendance(uuid,uuid,text) to service_role;
grant execute on function public.assign_event_badge(uuid,uuid,text) to service_role;
grant execute on function public.complete_badge_mint(uuid,text,text) to service_role;
grant execute on function public.reset_failed_badge_mint(uuid,text) to service_role;
grant execute on function public.issue_reward_coupon(uuid,uuid,text) to service_role;
grant execute on function public.redeem_reward_coupon(uuid,text) to service_role;
notify pgrst, 'reload schema';
commit;
