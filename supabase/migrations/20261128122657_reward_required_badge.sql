begin;
alter table public.rewards add column required_badge_key text;
alter table public.rewards add constraint rewards_required_badge_key_valid
  check(required_badge_key is null or (length(required_badge_key) between 1 and 150 and btrim(required_badge_key)=required_badge_key));
comment on column public.rewards.required_badge_key is 'Optional exact badge catalog key. Requires a confirmed app-issued badge in addition to unspent badge credits.';

create function public.student_verified_badge_keys(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(distinct e.badge_key), '[]'::jsonb)
  from public.badge_mint_jobs j
  join public.attendance a on a.id=j.attendance_id
  join public.events e on e.id=a.event_id
  where a.user_id=p_user_id and j.state='confirmed' and e.badge_key is not null;
$$;
revoke all on function public.student_verified_badge_keys(uuid) from public,anon,authenticated;
grant execute on function public.student_verified_badge_keys(uuid) to service_role;

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
  if r.required_badge_key is not null and not (
    public.student_verified_badge_keys(p_user_id) ? r.required_badge_key
  ) then
    raise sqlstate 'PT403' using message='Required verified badge is missing';
  end if;
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

revoke all on function public.issue_reward_coupon(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.issue_reward_coupon(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
