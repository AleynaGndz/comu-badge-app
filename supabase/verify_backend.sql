-- Read-only post-migration checks. Run in the Supabase SQL Editor.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in
  ('users','clubs','events','attendance','auth_nonces','badge_mint_jobs','rewards','coupons')
order by tablename;

select tablename, indexname, indexdef from pg_indexes
where schemaname = 'public' and indexname in
  ('users_wallet_unique','attendance_user_event_unique','auth_nonce_unique',
   'coupons_user_reward_unique','coupons_code_unique');

select table_name, column_name, column_default from information_schema.columns
where table_schema = 'public' and
  ((table_name = 'users' and column_name = 'role') or
   (table_name = 'auth_nonces' and column_name = 'used'));

select c.relname as table_name, con.conname, pg_get_constraintdef(con.oid)
from pg_constraint con join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('attendance','users','rewards','coupons','badge_mint_jobs');

select p.proname, p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'execute') as anon_execute,
  has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('issue_login_nonce','record_attendance','assign_event_badge','complete_badge_mint',
   'reset_failed_badge_mint','issue_reward_coupon','redeem_reward_coupon');
