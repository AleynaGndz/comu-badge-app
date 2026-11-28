import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await fs.readFile(new URL('../supabase/migrations/20261127200639_backend_completion.sql', import.meta.url), 'utf8');
const membershipsMigration = await fs.readFile(new URL('../supabase/migrations/20261127214121_club_admin_memberships.sql', import.meta.url), 'utf8');
const ids = {
  student: '00000000-0000-4000-8000-000000000001',
  student2: '00000000-0000-4000-8000-000000000002',
  admin: '00000000-0000-4000-8000-000000000003',
  sponsor: '00000000-0000-4000-8000-000000000004',
  otherSponsor: '00000000-0000-4000-8000-000000000005',
  club: '00000000-0000-4000-8000-000000000006',
  event: '00000000-0000-4000-8000-000000000007',
  reward: '00000000-0000-4000-8000-000000000008',
};
async function setup() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;');
  await db.exec(migration);
  await db.exec(membershipsMigration);
  await db.exec(await fs.readFile(new URL("../supabase/migrations/20261128110020_coupon_badge_spending.sql", import.meta.url), "utf8"));
  for (const role of ['student', 'student2', 'admin', 'sponsor', 'otherSponsor']) {
    await db.query('insert into users(id, wallet_address, role) values ($1,$2,$3)', [ids[role], role, role === 'student2' ? 'student' : role === 'otherSponsor' ? 'sponsor' : role]);
  }
  await db.query('insert into clubs(id,name,admin_id) values ($1,$2,$3)', [ids.club, 'Club', ids.admin]);
  await db.query("insert into events(id,club_id,title,event_date,qr_token,badge_key) values($1,$2,'Event',now(),'secret','dev3pack')", [ids.event, ids.club]);
  await db.query("insert into rewards(id,sponsor_id,title,required_badges) values($1,$2,'Coffee',1)", [ids.reward, ids.sponsor]);
  return db;
}
async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error.code === code);
}

test('attendance validates role, token, time and uniqueness; badge assignment freezes', async () => {
  const db = await setup();
  try {
    const call = (user, token = 'secret') => db.query('select record_attendance($1,$2,$3) as result', [user, ids.event, token]);
    await rejectsCode(call(ids.admin), 'PT403');
    await rejectsCode(call(ids.student, 'wrong'), 'PT403');
    await rejectsCode(call(ids.student, null), 'PT403');
    await db.query("update events set event_date = now() + interval '1 day'");
    await rejectsCode(call(ids.student), 'PT403');
    await db.query("update events set event_date = now() - interval '3 hours'");
    await rejectsCode(call(ids.student), 'PT403');
    await db.query('update events set event_date = now()');
    await db.query("select assign_event_badge($1,$2,'android')", [ids.admin, ids.event]);
    const results = await Promise.all([call(ids.student), call(ids.student)]);
    assert.deepEqual(results.map(r => r.rows[0].result.created).sort(), [false, true]);
    assert.equal((await db.query('select count(*)::int as count from attendance')).rows[0].count, 1);
    // A legacy unmapped event can receive its first badge before minting.
    await db.query('update events set badge_key = null');
    await db.query("select assign_event_badge($1,$2,'android')", [ids.admin, ids.event]);
    await rejectsCode(db.query("select assign_event_badge($1,$2,'dev3pack')", [ids.admin, ids.event]), 'PT409');
    await rejectsCode(db.query("select assign_event_badge($1,$2,'dev3pack')", [ids.student, ids.event]), 'PT403');
  } finally { await db.close(); }
});

test('mint finalization is atomic/idempotent and only confirmed badges unlock coupons', async () => {
  const db = await setup();
  try {
    await db.query('select record_attendance($1,$2,$3)', [ids.student, ids.event, 'secret']);
    const attendance = (await db.query('select id from attendance')).rows[0].id;
    const job = (await db.query(`insert into badge_mint_jobs(attendance_id,wallet_address,title,metadata_uri)
      values($1,'student','Badge','ipfs://metadata') returning id`, [attendance])).rows[0].id;
    await rejectsCode(db.query('select issue_reward_coupon($1,$2,$3)', [ids.student, ids.reward, 'a'.repeat(48)]), 'PT403');
    await rejectsCode(db.query('select complete_badge_mint($1,$2,$3)', [job, 'wrong', 'asset']), 'PT409');
    await db.query(`update badge_mint_jobs set state='submitted', signed_transaction='signed', tx_signature='signature',
      last_valid_block_height=100, rpc_url='https://rpc.invalid', tree_address='tree' where id=$1`, [job]);
    await db.query('select complete_badge_mint($1,$2,$3)', [job, 'signature', 'asset']);
    await db.query('select complete_badge_mint($1,$2,$3)', [job, 'signature', 'asset']);
    const record = (await db.query('select mint_status, tx_signature, nft_asset_id from attendance')).rows[0];
    assert.deepEqual(record, { mint_status: 'minted', tx_signature: 'signature', nft_asset_id: 'asset' });
    const coupons = await Promise.all(['a', 'b'].map(char => db.query('select issue_reward_coupon($1,$2,$3) as coupon', [ids.student, ids.reward, char.repeat(48)])));
    assert.equal(coupons[0].rows[0].coupon.id, coupons[1].rows[0].coupon.id);
    await rejectsCode(db.query('select redeem_reward_coupon($1,$2)', [ids.otherSponsor, 'a'.repeat(48)]), 'PT403');
    const redeemed = (await db.query('select redeem_reward_coupon($1,$2) as coupon', [ids.sponsor, 'a'.repeat(48)])).rows[0].coupon;
    assert.equal(redeemed.status, 'used');
    assert.equal(redeemed.used_by, ids.sponsor);
    await rejectsCode(db.query('select redeem_reward_coupon($1,$2)', [ids.sponsor, 'a'.repeat(48)]), 'PT409');
    await rejectsCode(db.query('select redeem_reward_coupon($1,$2)', [ids.student, 'a'.repeat(48)]), 'PT403');
    await db.query('update rewards set active=false');
    await rejectsCode(db.query('select issue_reward_coupon($1,$2,$3)', [ids.student, ids.reward, 'c'.repeat(48)]), 'PT409');
  } finally { await db.close(); }
});

test('nonce issuance is limited, expiration cleanup keeps recent rate-limit history', async () => {
  const db = await setup();
  try {
    for (let i = 0; i < 6; i++) {
      const r = await db.query('select issue_login_nonce($1,$2,$3) as allowed', ['wallet', 'nonce' + i, null]);
      assert.equal(r.rows[0].allowed, i < 5);
    }
    await db.query("insert into auth_nonces(wallet_address,nonce,expires_at,created_at) values('old','expired',now()-interval '2 days',now()-interval '3 days')");
    await db.query("select issue_login_nonce('new','newnonce',null)");
    assert.equal((await db.query("select count(*)::int as count from auth_nonces where nonce='expired'")).rows[0].count, 0);
    for (let i = 0; i < 31; i++) {
      const r = await db.query('select issue_login_nonce($1,$2,$3) as allowed', ['w' + i, 'n' + i, 'trusted-source']);
      assert.equal(r.rows[0].allowed, i < 30);
    }
  } finally { await db.close(); }
});

test('anon/authenticated cannot read tables or execute service-only RPCs', async () => {
  const db = await setup();
  try {
    const rows = await db.query(`select relname, relrowsecurity from pg_class
      where relnamespace='public'::regnamespace and relkind='r'`);
    assert.ok(rows.rows.every(row => row.relrowsecurity));
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      await rejectsCode(db.query('select * from users'), '42501');
      await rejectsCode(db.query("select issue_login_nonce('wallet','nonce',null)"), '42501');
      await rejectsCode(db.query('select complete_badge_mint($1,$2,$3)', [ids.student, 'x', 'y']), '42501');
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal((await db.query('select count(*)::int as count from users')).rows[0].count, 5);
  } finally { await db.close(); }
});


test('failed-mint reset archives its signature and cannot reset an active/confirmed job', async () => {
  const db = await setup();
  try {
    await db.query('select record_attendance($1,$2,$3)', [ids.student, ids.event, 'secret']);
    const attendance = (await db.query('select id from attendance')).rows[0].id;
    const job = (await db.query(`insert into badge_mint_jobs(attendance_id,wallet_address,title,metadata_uri,
      state,signed_transaction,tx_signature,last_valid_block_height,rpc_url,tree_address)
      values($1,'student','Badge','ipfs://meta','failed','signed','failedsig',100,'rpc','tree') returning id`, [attendance])).rows[0].id;
    await rejectsCode(db.query('select reset_failed_badge_mint($1,$2)', [job, 'different']), 'PT409');
    await db.query('select reset_failed_badge_mint($1,$2)', [job, 'failedsig']);
    const row = (await db.query('select * from badge_mint_jobs where id=$1', [job])).rows[0];
    assert.equal(row.state, 'pending');
    assert.equal(row.tx_signature, null);
    assert.equal(row.failed_attempts[0].signature, 'failedsig');
    await rejectsCode(db.query('select reset_failed_badge_mint($1,$2)', [job, 'failedsig']), 'PT409');
  } finally { await db.close(); }
});


test('migration upgrades existing tables without deleting rows or rejecting legacy statuses', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    // The initial CREATE TABLE section mirrors the seven existing tables.
    const prefix = migration.slice(migration.indexOf('create table if not exists public.users'),
      migration.indexOf('-- Preserve legacy status values'));
    await db.exec(prefix);
    await db.exec("alter table attendance add constraint legacy_status_check check(mint_status in ('pending','success','failed'))");
    await db.query("insert into users(id,wallet_address) values($1,'legacy-wallet')", [ids.student]);
    await db.query("insert into events(id,title,event_date,qr_token) values($1,'Legacy',now(),'token')", [ids.event]);
    await db.query("insert into attendance(user_id,event_id,mint_status) values($1,$2,'success')", [ids.student, ids.event]);
    await db.exec(migration);
    assert.equal((await db.query('select mint_status from attendance')).rows[0].mint_status, 'success');
    await db.exec("update attendance set mint_status='minted'");
    assert.equal((await db.query('select count(*)::int as count from users')).rows[0].count, 1);
  } finally { await db.close(); }
});


test('club team administrators share event permissions without granting unrelated admins access', async () => {
  const db = await setup();
  try {
    const can = async user => (await db.query('select can_manage_club($1,$2) as allowed', [user, ids.club])).rows[0].allowed;
    assert.equal(await can(ids.admin), true); // Original owner works even for new clubs.
    assert.equal(await can(ids.student), false);
    await db.query("update users set role='admin' where id=$1", [ids.student2]);
    assert.equal(await can(ids.student2), false); // Global admin alone is not sufficient.
    await rejectsCode(db.query('select set_club_admin($1,$2,$3,true)', [ids.student2, ids.club, ids.student2]), 'PT403');
    await db.query('select set_club_admin($1,$2,$3,true)', [ids.admin, ids.club, ids.student]);
    assert.equal(await can(ids.student), true);
    assert.equal((await db.query('select role from users where id=$1', [ids.student])).rows[0].role, 'admin');
    assert.equal((await db.query('select * from managed_clubs($1)', [ids.student])).rows.length, 1);
    await db.query("select assign_event_badge($1,$2,'android')", [ids.student, ids.event]);
    const created = (await db.query(`select create_club_event($1,$2,'Team Event','',now()+interval '1 day','token','dev3pack') as event`, [ids.student, ids.club])).rows[0].event;
    await rejectsCode(db.query('select delete_club_event($1,$2)', [ids.student2, created.id]), 'PT403');
    await db.query('select delete_club_event($1,$2)', [ids.student, created.id]);
    await rejectsCode(db.query('select delete_club_event($1,$2)', [ids.student, ids.event]), 'PT409');
    await rejectsCode(db.query('select set_club_admin($1,$2,$3,false)', [ids.admin, ids.club, ids.admin]), 'PT409');
    await rejectsCode(db.query('select set_club_admin($1,$2,$3,true)', [ids.student, ids.club, ids.student2]), 'PT403');
    await db.query('select set_club_admin($1,$2,$3,false)', [ids.admin, ids.club, ids.student]);
    assert.equal(await can(ids.student), false);
    assert.equal(await can(ids.admin), true);
    await rejectsCode(db.query("select assign_event_badge($1,$2,'android')", [ids.student, ids.event]), 'PT403');
    await rejectsCode(db.query(`select create_club_event($1,$2,'Forbidden','',now()+interval '1 day','token',null)`, [ids.student, ids.club]), 'PT403');
    await db.exec('set role anon');
    await rejectsCode(db.query('select * from club_admins'), '42501');
    await rejectsCode(db.query('select can_manage_club($1,$2)', [ids.student, ids.club]), '42501');
    await rejectsCode(db.query('select set_club_admin($1,$2,$3,true)', [ids.admin, ids.club, ids.student]), '42501');
  } finally { await db.close(); }
});

test('membership migration backfills owners and keeps existing club ownership', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(migration);
    await db.query("insert into users(id,wallet_address,role) values($1,'owner','admin')", [ids.admin]);
    await db.query("insert into clubs(id,name,admin_id) values($1,'Existing Club',$2)", [ids.club, ids.admin]);
    await db.exec(membershipsMigration);
  await db.exec(await fs.readFile(new URL("../supabase/migrations/20261128110020_coupon_badge_spending.sql", import.meta.url), "utf8"));
    assert.equal((await db.query('select user_id from club_admins')).rows[0].user_id, ids.admin);
    assert.equal((await db.query('select admin_id from clubs')).rows[0].admin_id, ids.admin);
  } finally { await db.close(); }
});

test('readable coupons persist unchanged, remain unique and redeem only once', async () => {
  const db=await setup();
  try {
    await db.query('update rewards set required_badges=0 where id=$1',[ids.reward]);
    const code='CP-7K4M-9X2R-QT';
    const issued=(await db.query('select issue_reward_coupon($1,$2,$3) as coupon',[ids.student,ids.reward,code])).rows[0].coupon;
    assert.equal(issued.code,code);
    const existing=(await db.query('select issue_reward_coupon($1,$2,$3) as coupon',[ids.student,ids.reward,'CP-ABCD-EFGH-JK'])).rows[0].coupon;
    assert.equal(existing.id,issued.id);assert.equal(existing.code,code);
    await rejectsCode(db.query('select issue_reward_coupon($1,$2,$3)',[ids.student2,ids.reward,code]),'23505');
    await rejectsCode(db.query('select redeem_reward_coupon($1,$2)',[ids.otherSponsor,code]),'PT403');
    await db.query('select redeem_reward_coupon($1,$2)',[ids.sponsor,code]);
    await rejectsCode(db.query('select redeem_reward_coupon($1,$2)',[ids.sponsor,code]),'PT409');
  } finally {await db.close();}
});


test('coupons spend confirmed badge credits once and preserve the original cost',async()=>{
  const db=await setup();
  try {
    await db.query('select record_attendance($1,$2,$3)',[ids.student,ids.event,'secret']);
    const attendance=(await db.query('select id from attendance')).rows[0].id;
    const job=(await db.query("insert into badge_mint_jobs(attendance_id,wallet_address,title,metadata_uri,state,signed_transaction,tx_signature,last_valid_block_height,rpc_url,tree_address) values($1,'student','Badge','ipfs://metadata','submitted','raw','signature',100,'https://rpc.invalid','tree') returning id",[attendance])).rows[0].id;
    await db.query('select complete_badge_mint($1,$2,$3)',[job,'signature','asset']);
    const other='00000000-0000-4000-8000-000000000099';
    await db.query("insert into rewards(id,sponsor_id,title,required_badges) values($1,$2,'Other',1)",[other,ids.sponsor]);
    const results=await Promise.allSettled([ids.reward,other].map((r,i)=>db.query('select issue_reward_coupon($1,$2,$3) as coupon',[ids.student,r,'CP-ABCD-EFGH-'+(i?'23':'45')])));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'PT403');
    const coupon=results.find(r=>r.status==='fulfilled').value.rows[0].coupon;
    assert.equal(coupon.badge_cost,1);
    await db.query('update rewards set required_badges=20 where id=$1',[coupon.reward_id]);
    const again=(await db.query('select issue_reward_coupon($1,$2,$3) as coupon',[ids.student,coupon.reward_id,'CP-2345-6789-AB'])).rows[0].coupon;
    assert.equal(again.id,coupon.id);assert.equal(again.badge_cost,1);
    assert.deepEqual((await db.query('select coupon_badge_balance($1) as balance',[ids.student])).rows[0].balance,{total:1,spent:1,available:0});
    await db.query('select redeem_reward_coupon($1,$2)',[ids.sponsor,coupon.code]);
    assert.equal((await db.query('select coupon_badge_balance($1) as balance',[ids.student])).rows[0].balance.spent,1);
    assert.equal((await db.query('select count(*)::int as n from badge_mint_jobs')).rows[0].n,1);
    await db.exec('set role anon');
    await rejectsCode(db.query('select coupon_badge_balance($1)',[ids.student]),'42501');
  }finally{await db.close();}
});
