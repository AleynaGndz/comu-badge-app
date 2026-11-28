import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const files = (await fs.readdir(new URL('../supabase/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
const migrations = await Promise.all(files.map(f => fs.readFile(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8')));
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
async function setup() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for (const sql of migrations) await db.exec(sql);
  for (let i = 1; i <= 6; i++) await db.query('insert into users(id,wallet_address,role) values($1,$2,$3)', [id(i), 'wallet-' + i, i === 1 || i === 6 ? 'admin' : 'student']);
  await db.query("insert into clubs(id,name,admin_id) values($1,'Club',$2)", [id(10), id(1)]);
  await db.query("insert into events(id,club_id,title,event_date,qr_token,badge_key,deposit_lamports) values($1,$2,'Paid Event',now(),'secret','dev3pack',500000000)", [id(20), id(10)]);
  return db;
}
async function paid(db, user) {
  const d = (await db.query("select create_deposit_intent($1,$2,'treasury','rpc') as d", [id(user), id(20)])).rows[0].d;
  await db.query('insert into deposit_proposals(deposit_id,message,unsigned_transaction,last_valid_block_height) values($1,$2,$3,100)', [d.id, 'message-' + user, 'unsigned']);
  await db.query('select bind_deposit_payment($1,$2,$3,$4,$5)', [id(user), d.id, 'signature-' + user, 'signed', 'message-' + user]);
  await db.query('select confirm_deposit_payment($1,$2)', [d.id, 'signature-' + user]);
  return d;
}
const code = (p, expected) => assert.rejects(p, e => e.code === expected);

test('deposit transactions are owner-bound, proposal-bound and cannot be reused', async () => {
  const db = await setup();
  try {
    const d = (await db.query("select create_deposit_intent($1,$2,'treasury','rpc') as d", [id(2), id(20)])).rows[0].d;
    await code(db.query('select bind_deposit_payment($1,$2,$3,$4,$5)', [id(3), d.id, 'sig', 'signed', 'forged']), 'PT404');
    await code(db.query('select bind_deposit_payment($1,$2,$3,$4,$5)', [id(2), d.id, 'sig', 'signed', 'forged']), 'PT400');
    await db.query("insert into deposit_proposals(deposit_id,message,unsigned_transaction,last_valid_block_height) values($1,'correct','unsigned',100)", [d.id]);
    await db.query("select bind_deposit_payment($1,$2,'sig','signed','correct')", [id(2), d.id]);
    await code(db.query("select bind_deposit_payment($1,$2,'different','signed','correct')", [id(2), d.id]), 'PT409');
    await code(db.query("select confirm_deposit_payment($1,'different')", [d.id]), 'PT409');
    await db.query("select confirm_deposit_payment($1,'sig')", [d.id]);
    await db.query("select confirm_deposit_payment($1,'sig')", [d.id]);
    assert.equal((await db.query('select state from event_deposits')).rows[0].state, 'confirmed');
  } finally { await db.close(); }
});

test('paid attendance queues exactly one full refund before minting', async () => {
  const db = await setup();
  try {
    await code(db.query("select record_attendance($1,$2,'secret')", [id(2), id(20)]), 'PT402');
    await paid(db, 2);
    await code(db.query("select record_attendance($1,$2,'wrong')", [id(2), id(20)]), 'PT403');
    assert.equal((await db.query('select count(*)::int as n from sol_payouts')).rows[0].n, 0);
    await db.query("select record_attendance($1,$2,'secret')", [id(2), id(20)]);
    await db.query("select record_attendance($1,$2,'secret')", [id(2), id(20)]);
    const rows = (await db.query('select kind,lamports,wallet_address from sol_payouts')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'refund');
    assert.equal(Number(rows[0].lamports), 500000000);
    assert.equal(rows[0].wallet_address, 'wallet-2');
    assert.equal((await db.query('select mint_status from attendance')).rows[0].mint_status, 'pending');
  } finally { await db.close(); }
});

test('no-show pool is distributed exactly with deterministic lamport remainder and no duplicate jobs', async () => {
  const db = await setup();
  try {
    for (const user of [2, 3, 4, 5]) await paid(db, user);
    for (const user of [2, 3, 4]) await db.query("select record_attendance($1,$2,'secret')", [id(user), id(20)]);
    await code(db.query('select distribute_no_show_deposits($1,$2)', [id(1), id(20)]), 'PT409');
    await db.query("update events set event_date=now()-interval '3 hours'");
    await code(db.query('select distribute_no_show_deposits($1,$2)', [id(6), id(20)]), 'PT403');
    await db.query('select distribute_no_show_deposits($1,$2)', [id(1), id(20)]);
    await db.query('select distribute_no_show_deposits($1,$2)', [id(1), id(20)]);
    const bonus = (await db.query("select user_id,lamports from sol_payouts where kind='bonus' order by wallet_address")).rows;
    assert.deepEqual(bonus.map(r => Number(r.lamports)), [166666667,166666667,166666666]);
    assert.equal(bonus.reduce((sum,r) => sum+Number(r.lamports), 0), 500000000);
    assert.ok(bonus.every(r => r.user_id !== id(5)));
    assert.equal(Number((await db.query('select sum(lamports) as total from sol_payouts')).rows[0].total), 2000000000);
  } finally { await db.close(); }
});

test('unknown payments block final distribution, and no attendees leaves funds held', async () => {
  const db = await setup();
  try {
    await paid(db, 2);
    await db.query("update events set event_date=now()-interval '3 hours'");
    await code(db.query('select distribute_no_show_deposits($1,$2)', [id(1), id(20)]), 'PT409');
    assert.equal((await db.query('select count(*)::int as n from sol_payouts')).rows[0].n, 0);
    await db.query("update event_deposits set state='review_required'");
    await code(db.query('select distribute_no_show_deposits($1,$2)', [id(1), id(20)]), 'PT409');
    await db.exec('set role anon');
    await code(db.query('select * from event_deposits'), '42501');
    await code(db.query("select create_deposit_intent($1,$2,'t','rpc')", [id(2), id(20)]), '42501');
    await code(db.query('select distribute_no_show_deposits($1,$2)', [id(1), id(20)]), '42501');
  } finally { await db.close(); }
});
