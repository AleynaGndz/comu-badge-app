begin;
-- Snapshot coupon cost so later campaign edits cannot rewrite spending history.
alter table public.coupons add column badge_cost integer;
update public.coupons c set badge_cost=greatest(0,r.required_badges)
  from public.rewards r where r.id=c.reward_id;
alter table public.coupons alter column badge_cost set default 0;
alter table public.coupons alter column badge_cost set not null;
alter table public.coupons add constraint coupons_badge_cost_nonnegative check(badge_cost>=0);
create index coupons_user_id_idx on public.coupons(user_id);

create function public.coupon_badge_balance(p_user_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('total',t.n,'spent',s.n,'available',greatest(0,t.n-s.n))
  from (select count(*) as n from public.badge_mint_jobs j
    join public.attendance a on a.id=j.attendance_id
    where a.user_id=p_user_id and j.state='confirmed') t
  cross join (select coalesce(sum(badge_cost),0) as n from public.coupons where user_id=p_user_id) s;
$$;
create or replace function public.issue_reward_coupon(p_user_id uuid,p_reward_id uuid,p_code text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.rewards; c public.coupons; earned bigint; spent bigint;
begin
  -- Serialize all reward purchases by this student, including different rewards.
  perform 1 from public.users where id=p_user_id and role='student' for update;
  if not found then raise sqlstate 'PT403' using message='Student access required'; end if;
  select * into r from public.rewards where id=p_reward_id for share;
  if not found then raise sqlstate 'PT404' using message='Reward not found'; end if;
  if not r.active or (r.expires_at is not null and r.expires_at<=now()) then
    raise sqlstate 'PT409' using message='Reward is closed';
  end if;
  select * into c from public.coupons where user_id=p_user_id and reward_id=p_reward_id;
  if found then return to_jsonb(c); end if;
  select count(*) into earned from public.badge_mint_jobs j
    join public.attendance a on a.id=j.attendance_id
    where a.user_id=p_user_id and j.state='confirmed';
  select coalesce(sum(badge_cost),0) into spent from public.coupons where user_id=p_user_id;
  if earned-spent<greatest(0,r.required_badges) then
    raise sqlstate 'PT403' using message='Not enough unspent verified badges';
  end if;
  insert into public.coupons(user_id,reward_id,code,status,badge_cost)
    values(p_user_id,p_reward_id,p_code,'unused',greatest(0,r.required_badges)) returning * into c;
  return to_jsonb(c);
end $$;
revoke all on function public.coupon_badge_balance(uuid) from public,anon,authenticated;
grant execute on function public.coupon_badge_balance(uuid) to service_role;
-- create or replace preserves the existing service-only issuance grants.
notify pgrst,'reload schema';
commit;
