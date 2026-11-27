begin;

create table public.club_admins (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index club_admins_user_idx on public.club_admins(user_id);
insert into public.club_admins(club_id,user_id)
  select id,admin_id from public.clubs where admin_id is not null
  on conflict do nothing;
alter table public.club_admins enable row level security;
revoke all on public.club_admins from public,anon,authenticated;
grant select,insert,update,delete on public.club_admins to service_role;

-- Global admin status alone never grants access to an unrelated club.
-- The original admin_id remains the club owner and works for newly created clubs.
create function public.can_manage_club(p_user_id uuid, p_club_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.clubs c join public.users u on u.id = p_user_id
    where c.id = p_club_id and u.role = 'admin' and
    (c.admin_id = u.id or exists(select 1 from public.club_admins m
      where m.club_id = c.id and m.user_id = u.id)));
$$;
create function public.managed_clubs(p_user_id uuid)
returns table(id uuid,name text,admin_id uuid)
language sql stable security invoker set search_path = '' as $$
  select c.id,c.name,c.admin_id from public.clubs c
    where public.can_manage_club(p_user_id,c.id) order by c.name,c.id;
$$;

-- Only the original owner can change the management team. No self-enrollment.
create function public.set_club_admin(p_owner_id uuid,p_club_id uuid,p_user_id uuid,p_enabled boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare c public.clubs; target_role text;
begin
  select * into c from public.clubs where id=p_club_id for update;
  if not found then raise sqlstate 'PT404' using message='Club not found'; end if;
  if c.admin_id is distinct from p_owner_id or not exists(
    select 1 from public.users where id=p_owner_id and role='admin') then
    raise sqlstate 'PT403' using message='Only the club owner can manage administrators';
  end if;
  select role into target_role from public.users where id=p_user_id for update;
  if not found then raise sqlstate 'PT404' using message='User not found'; end if;
  if p_enabled then
    if target_role not in ('student','admin') then
      raise sqlstate 'PT409' using message='This user has an incompatible role';
    end if;
    insert into public.club_admins(club_id,user_id) values(p_club_id,p_user_id) on conflict do nothing;
    update public.users set role='admin' where id=p_user_id and role='student';
  else
    if p_user_id=c.admin_id then raise sqlstate 'PT409' using message='The club owner cannot be removed'; end if;
    delete from public.club_admins where club_id=p_club_id and user_id=p_user_id;
    -- Keep the application role: this user may administer other clubs. All club
    -- actions recheck membership, so the removed club becomes inaccessible.
  end if;
end $$;

create function public.create_club_event(p_admin_id uuid,p_club_id uuid,p_title text,
  p_description text,p_event_date timestamptz,p_qr_token text,p_badge_key text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare e public.events;
begin
  perform 1 from public.clubs where id=p_club_id for share;
  if not public.can_manage_club(p_admin_id,p_club_id) then
    raise sqlstate 'PT403' using message='Club access denied';
  end if;
  if p_event_date is null or p_event_date <= now() then
    raise sqlstate 'PT400' using message='Event must be in the future';
  end if;
  insert into public.events(club_id,title,description,event_date,qr_token,badge_key)
    values(p_club_id,p_title,p_description,p_event_date,p_qr_token,p_badge_key) returning * into e;
  return to_jsonb(e);
end $$;

create function public.delete_club_event(p_admin_id uuid,p_event_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where id=p_event_id for update;
  if not found then raise sqlstate 'PT404' using message='Event not found'; end if;
  perform 1 from public.clubs where id=e.club_id for share;
  if not public.can_manage_club(p_admin_id,e.club_id) then
    raise sqlstate 'PT403' using message='Club access denied';
  end if;
  if e.event_date <= now()+interval '15 minutes' or
    exists(select 1 from public.attendance where event_id=e.id) then
    raise sqlstate 'PT409' using message='Event is open or has attendance; deletion is blocked';
  end if;
  delete from public.events where id=e.id;
end $$;

create or replace function public.assign_event_badge(p_admin_id uuid,p_event_id uuid,p_badge_key text)
returns void language plpgsql security invoker set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where id=p_event_id for update;
  if not found then raise sqlstate 'PT404' using message='Event not found'; end if;
  perform 1 from public.clubs where id=e.club_id for share;
  if not public.can_manage_club(p_admin_id,e.club_id) then
    raise sqlstate 'PT403' using message='Club access denied';
  end if;
  if exists(select 1 from public.attendance where event_id=p_event_id) and
    (e.badge_key is not null or exists(
      select 1 from public.attendance a where a.event_id=p_event_id and
        (a.mint_status <> 'pending' or a.tx_signature is not null or a.nft_asset_id is not null)
    ) or exists(select 1 from public.badge_mint_jobs j join public.attendance a on a.id=j.attendance_id
      where a.event_id=p_event_id)) then
    raise sqlstate 'PT409' using message='Badge cannot change after attendance';
  end if;
  update public.events set badge_key=p_badge_key where id=p_event_id;
end $$;

revoke all on function public.can_manage_club(uuid,uuid) from public,anon,authenticated;
revoke all on function public.managed_clubs(uuid) from public,anon,authenticated;
revoke all on function public.set_club_admin(uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.create_club_event(uuid,uuid,text,text,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.delete_club_event(uuid,uuid) from public,anon,authenticated;
grant execute on function public.can_manage_club(uuid,uuid) to service_role;
grant execute on function public.managed_clubs(uuid) to service_role;
grant execute on function public.set_club_admin(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.create_club_event(uuid,uuid,text,text,timestamptz,text,text) to service_role;
grant execute on function public.delete_club_event(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
