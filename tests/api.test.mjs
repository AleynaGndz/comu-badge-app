import { test } from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import * as jose from 'jose';
import { loadTs } from './helpers/load-ts.mjs';

const studentId = '00000000-0000-4000-8000-000000000001';
const eventId = '00000000-0000-4000-8000-000000000002';
const address = bs58.encode(nacl.sign.keyPair().publicKey);
function harness(results = [], session = { userId: studentId, walletAddress: address }) {
  const calls = [];
  const errors = [];
  const supabase = {
    from(table) {
      const result = results.shift();
      assert.ok(result, 'Unexpected database query: ' + table);
      const call = { table, operations: [] }; calls.push(call);
      const q = {};
      for (const method of ['select', 'eq', 'neq', 'gt', 'in', 'or', 'range', 'order', 'insert', 'update', 'upsert', 'single', 'maybeSingle']) {
        q[method] = (...args) => { call.operations.push([method, ...args]); return q; };
      }
      q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      return q;
    },
    async rpc(name, params) {
      calls.push({ rpc: name, params });
      const result = results.shift();
      assert.ok(result, 'Unexpected database RPC: ' + name);
      return result;
    },
  };
  const api = loadTs('lib/api.ts', {
    'server-only': {}, '@/lib/auth': { getSession: async () => session }, '@/lib/supabase': { supabase },
  }, { console: { error(...args) { errors.push(args.map(String).join(" ")); } } });
  const couponCodes = loadTs("lib/coupon-codes.ts", { "server-only": {} });
  const clubs = loadTs('lib/clubs.ts', { 'server-only': {}, '@/lib/api': api, '@/lib/supabase': { supabase } });
  const load = (file, mocks = {}) => loadTs(file, { 'server-only': {}, '@/lib/api': api,
    '@/lib/auth': { getSession: async () => session }, '@/lib/supabase': { supabase }, '@/lib/clubs': clubs, '@/lib/deposits': {}, '@/lib/coupon-codes': couponCodes, ...mocks },
    { console: { error(...args) { errors.push(args.map(String).join(" ")); } } });
  return { load, api, calls, errors };
}
const student = { data: { id: studentId, wallet_address: address, role: 'student' }, error: null };
const post = value => new Request('http://localhost/api/test', { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

test('protected routes require a session and the proper role before business operations', async () => {
  const unauth = harness([], null);
  const route = unauth.load('app/api/coupons/route.ts');
  assert.equal((await route.POST(post({ reward_id: eventId }))).status, 401);
  assert.equal(unauth.calls.length, 0);
  const wrongRole = harness([student]);
  assert.equal((await wrongRole.load('app/api/coupons/redeem/route.ts').POST(post({ code: 'a'.repeat(48) }))).status, 403);
  assert.equal(wrongRole.calls.length, 1);
});

test('nonce rate limiting returns 429 and Retry-After', async () => {
  const h = harness([{ data: false, error: null }]);
  const response = await h.load('app/api/auth/nonce/route.ts').POST(post({ wallet_address: address }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(h.calls[0].rpc, 'issue_login_nonce');
  assert.equal(h.calls[0].params.p_wallet, address);
});

test('claim refuses a supplied wallet mismatch and requires QR for new attendance', async () => {
  let h = harness([student]);
  let route = h.load('app/api/claim/route.ts', {
    '@/lib/attendance': {}, '@/lib/badge-catalog': {}, '@/lib/claim': {},
  });
  assert.equal((await route.POST(post({ eventId, walletAddress: 'other-wallet' }))).status, 403);
  h = harness([student, { data: { id: eventId, title: 'Event', badge_key: 'android' } }, { data: null, error: null }]);
  const attendance = h.load('lib/attendance.ts');
  route = h.load('app/api/claim/route.ts', {
    '@/lib/attendance': attendance, '@/lib/badge-catalog': { metadataForBadge: () => 'ipfs://metadata' }, '@/lib/claim': {},
  });
  assert.equal((await route.POST(post({ eventId }))).status, 400);
  assert.equal(h.calls.length, 3); // No attendance/job insert and no mint without a QR token.
});

test('claim preserves 202 processing status rather than announcing success', async () => {
  const h = harness([student, { data: { id: eventId, title: 'Event', badge_key: 'android' } },
    { data: { id: 'attendance', mint_status: 'pending', tx_signature: null, nft_asset_id: null } },
    { data: { title: 'Event', badge_key: 'android' } }, { error: null }, { data: { id: 'job' } }]);
  const route = h.load('app/api/claim/route.ts', {
    '@/lib/attendance': {}, '@/lib/badge-catalog': { metadataForBadge: () => 'ipfs://metadata' },
    '@/lib/claim': { processMint: async () => ({ status: 202, data: { success: false, processing: true } }) },
  });
  const response = await route.POST(post({ event_id: eventId }));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('retry-after'), '3');
  assert.deepEqual(await response.json(), { success: false, processing: true, refund: null });
  const insert = h.calls.find(call => call.table === 'badge_mint_jobs' && call.operations[0][0] === 'upsert');
  assert.equal(insert.operations[0][1].wallet_address, address);
});

test('badges query returns only confirmed jobs and rejects invalid pagination', async () => {
  const h = harness([{ data: [{ id: 'badge', title: 'Badge', metadata_uri: 'ipfs://metadata',
    confirmed_at: 'today', tx_signature: 'signature', asset_id: 'asset' }], error: null }]);
  const route = h.load('app/api/badges/route.ts');
  const response = await route.GET(new Request('http://localhost/api/badges?wallet=' + address));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).badges[0].image_url, 'ipfs://metadata');
  assert.ok(h.calls[0].operations.some(op => op[0] === 'eq' && op[1] === 'state' && op[2] === 'confirmed'));
  assert.equal((await route.GET(new Request('http://localhost/api/badges?wallet=' + address + '&offset=NaN'))).status, 400);
});

test('wallet login verifies a real signature, consumes a live unused nonce and sets verifiable JWT', async () => {
  const key = nacl.sign.keyPair();
  const wallet_address = bs58.encode(key.publicKey);
  const nonce = 'a'.repeat(64);
  const message = `CampusPass Login\nWallet: ${wallet_address}\nNonce: ${nonce}`;
  const signature = Array.from(nacl.sign.detached(new TextEncoder().encode(message), key.secretKey));
  const h = harness([{ data: { id: 'nonce' }, error: null }, { error: null },
    { data: { id: studentId, wallet_address, role: 'student' }, error: null }]);
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'a'.repeat(32);
  try {
    const route = h.load('app/api/users/route.ts', { jose });
    const response = await route.POST(post({ wallet_address, nonce, signature }));
    assert.equal(response.status, 200, JSON.stringify(h.errors));
    const cookie = response.cookies.get('campuspass_session');
    const { payload } = await jose.jwtVerify(cookie.value, new TextEncoder().encode(process.env.JWT_SECRET),
      { issuer: 'campuspass', audience: 'campuspass', algorithms: ['HS256'] });
    assert.equal(payload.wallet_address, wallet_address);
    assert.equal(payload.sub, studentId);
    assert.ok(h.calls[0].operations.some(op => op[0] === 'eq' && op[1] === 'used' && op[2] === false));
    assert.ok(h.calls[0].operations.some(op => op[0] === 'gt' && op[1] === 'expires_at'));
    assert.equal((await route.POST(post({ wallet_address, nonce, signature: signature.map(() => 0) }))).status, 401);
    assert.equal((await route.POST(new Request('http://localhost', { method: 'POST', body: '{' }))).status, 400);
  } finally {
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
  }
});


test('event creation rejects unknown badges and missing timezone before inserting', async () => {
  for (const input of [
    { title: 'Event', event_date: '2030-01-01T12:00:00Z', badge_key: 'unknown' },
    { title: 'Event', event_date: '2030-01-01', badge_key: 'android' },
  ]) {
    const h = harness([{ data: { id: studentId, role: 'admin' }, error: null }]);
    const catalog = h.load('lib/badge-catalog.ts', { '@/badges.json': { android: 'ipfs://metadata' } });
    const route = h.load('app/api/events/route.ts', { '@/lib/badge-catalog': catalog });
    assert.equal((await route.POST(post(input))).status, 400);
    assert.equal(h.calls.length, 1);
  }
});

test('merged frontend qrToken field reaches attendance validation', async () => {
  const h = harness([student, { data: { id: eventId, title: 'Event', badge_key: 'android' } },
    { data: null, error: null }, { data: { title: 'Event', badge_key: 'android' } },
    { error: null }, { data: { id: 'job' } }]);
  let validated = false;
  const route = h.load('app/api/claim/route.ts', {
    '@/lib/attendance': { recordAttendance: async (userId, id, token) => {
      assert.equal(userId, studentId);
      assert.equal(id, eventId);
      assert.equal(token, 'frontend-qr-token');
      validated = true;
      return { attendance: { id: 'attendance' } };
    } },
    '@/lib/badge-catalog': { metadataForBadge: () => 'ipfs://metadata' },
    '@/lib/claim': { processMint: async () => ({ status: 202, data: { success: false, processing: true } }) },
  });
  assert.equal((await route.POST(post({ eventId, walletAddress: address, qrToken: 'frontend-qr-token' }))).status, 202);
  assert.equal(validated, true);
});

test('club list and QR lookup accept membership-based administrators', async () => {
  const admin = { data: { id: studentId, wallet_address: address, role: 'admin' }, error: null };
  let h = harness([admin, { data: [{ id: eventId, name: 'Team Club', admin_id: 'different-owner' }], error: null }]);
  const clubs = await h.load('app/api/clubs/route.ts').GET();
  assert.equal(clubs.status, 200);
  assert.equal((await clubs.json()).clubs[0].name, 'Team Club');
  for (const allowed of [true, false]) {
    h = harness([admin, { data: { id: eventId, title: 'Event', club_id: eventId, qr_token: 'secret' }, error: null },
      { data: allowed, error: null }]);
    const qr = await h.load('app/api/events/qr/route.ts').GET(new Request('http://localhost/api/events/qr?event=' + eventId));
    assert.equal(qr.status, allowed ? 200 : 403, JSON.stringify(h.errors));
    if (allowed) assert.equal(new URL((await qr.json()).claim_path, 'http://localhost').searchParams.get('token'), 'secret');
    assert.equal(h.calls.at(-1).rpc, 'can_manage_club');
  }
});

test('non-owner club admins cannot add members or look up the target account', async () => {
  const h = harness([{ data: { id: studentId, wallet_address: address, role: 'admin' } }, { data: null, error: null }]);
  const response = await h.load('app/api/clubs/admins/route.ts').POST(post({ club_id: eventId, wallet_address: address }));
  assert.equal(response.status, 403);
  assert.equal(h.calls.length, 2);
});

test('managed event listing filters by all administrator memberships', async () => {
  const h = harness([
    { data: [{ id: eventId }], error: null }, // The event query is built first.
    { data: { id: studentId, wallet_address: address, role: 'admin' }, error: null },
    { data: [{ id: eventId, name: 'Club', admin_id: 'owner' }], error: null },
  ]);
  const response = await h.load('app/api/events/route.ts', { '@/lib/badge-catalog': {} }).GET(new Request('http://localhost/api/events?managed=true'));
  assert.equal(response.status, 200);
  const filter = h.calls[0].operations.find(op => op[0] === 'in');
  assert.equal(filter[1], 'club_id');
  assert.equal(filter[2][0], eventId);
});


test('deposit and distribution endpoints enforce authentication and roles before money operations', async () => {
  for (const file of ['app/api/rsvp/route.ts', 'app/api/rsvp/confirm/route.ts', 'app/api/rsvp/refund/route.ts', 'app/api/events/distribute/route.ts', 'app/api/deposits/reconcile/route.ts']) {
    const noSession = harness([], null);
    assert.equal((await noSession.load(file).POST(post({ event_id: eventId }))).status, 401, file);
    assert.equal(noSession.calls.length, 0);
    const role = file.includes('distribute') || file.includes('reconcile') ? 'student' : 'sponsor';
    const wrong = harness([{ data: { ...student.data, role }, error: null }]);
    assert.equal((await wrong.load(file).POST(post({ event_id: eventId }))).status, 403, file);
    assert.equal(wrong.calls.length, 1);
  }
});


test('short coupons are generated with bounded collision retries and remain owner/reward-bound', async () => {
  const h=harness([student,{error:{code:'23505'}},{data:{code:'CP-7K4M-9X2R-QT'},error:null}]);
  const res=await h.load('app/api/coupons/route.ts').POST(post({reward_id:eventId}));
  assert.equal(res.status,200);
  const issued=h.calls.filter(c=>c.rpc==='issue_reward_coupon');assert.equal(issued.length,2);
  for(const c of issued){assert.match(c.params.p_code,/^CP-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{2}$/);assert.equal(c.params.p_user_id,studentId);assert.equal(c.params.p_reward_id,eventId);}
  const full=harness([student,...Array.from({length:3},()=>({error:{code:'23505'}}))]);
  assert.equal((await full.load('app/api/coupons/route.ts').POST(post({reward_id:eventId}))).status,503);
});
test('redeem accepts readable short codes and legacy codes but rejects malformed codes before RPC', async () => {
  for(const [input,expected] of [[' cp7k4m9x2rqt ','CP-7K4M-9X2R-QT'],['A'.repeat(48),'a'.repeat(48)]]){
    const h=harness([{data:{...student.data,role:'sponsor'},error:null},{data:{status:'used'},error:null}]);
    assert.equal((await h.load('app/api/coupons/redeem/route.ts').POST(post({code:input}))).status,200);
    assert.equal(h.calls[1].params.p_code,expected);
  }
  const bad=harness([{data:{...student.data,role:'sponsor'},error:null}]);
  assert.equal((await bad.load('app/api/coupons/redeem/route.ts').POST(post({code:'CP-OOOO-1111-AA'}))).status,400);
  assert.equal(bad.calls.length,1);
});


test('coupon listing includes stored costs and the server credit balance',async()=>{
  const h=harness([student,{data:[{id:'coupon',badge_cost:2}],error:null},{data:{total:5,spent:2,available:3},error:null}]);
  const res=await h.load('app/api/coupons/route.ts').GET();assert.equal(res.status,200);
  const data=await res.json();assert.equal(data.coupons[0].badge_cost,2);assert.equal(data.balance.available,3);
  assert.equal(h.calls[2].rpc,'coupon_badge_balance');assert.equal(h.calls[2].params.p_user_id,studentId);
});
test('sponsor eligibility uses remaining credits and honors already issued unused coupons',async()=>{
  for(const status of ['unused','used',null]){
    const h=harness([{data:{...student.data,role:'sponsor'},error:null},{data:{id:eventId,required_badges:2,active:true,expires_at:null},error:null},
      {count:3,error:null},student,{data:[{reward_id:'other',status:'used',badge_cost:3},...(status?[{reward_id:eventId,status,badge_cost:0}]:[])],error:null}]);
    const res=await h.load('app/api/rewards/eligibility/route.ts').POST(post({reward_id:eventId,wallet_address:address}));
    assert.equal(res.status,200);const data=await res.json();assert.equal(data.badgeCount,0);assert.equal(data.eligible,status==='unused');
  }
});
