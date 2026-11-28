import { test } from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { loadTs } from './helpers/load-ts.mjs';

class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
const signatureBytes = new Uint8Array(64).fill(1);
const signature = bs58.encode(signatureBytes);
function setup(options = {}) {
  const job = { id: 'job', attendance_id: 'attendance', wallet_address: 'wallet', title: 'Badge',
    metadata_uri: 'ipfs://metadata', state: options.state ?? 'pending', lease_id: null,
    lease_expires_at: null, asset_id: null, confirmed_at: null,
    ...(options.state && options.state !== 'pending' ? { tx_signature: signature,
      signed_transaction: 'c2lnbmVk', last_valid_block_height: 100,
      rpc_url: 'https://rpc.invalid', tree_address: 'tree' } : {}),
  };
  const sent = [];
  let preparations = 0;
  let dbFinalizations = 0;
  const db = {
    from() {
      const filters = [];
      let patch;
      const q = {
        select() { return q; }, update(value) { patch = value; return q; },
        eq(key, value) { filters.push(() => job[key] === value); return q; },
        neq(key, value) { filters.push(() => job[key] !== value); return q; },
        in(key, values) { filters.push(() => values.includes(job[key])); return q; },
        or() { filters.push(() => !job.lease_expires_at || Date.parse(job.lease_expires_at) < Date.now()); return q; },
        single() { return q; }, maybeSingle() { return q; },
        then(resolve) {
          if (!filters.every(fn => fn())) return Promise.resolve({ data: null, error: null }).then(resolve);
          if (patch) Object.assign(job, structuredClone(patch));
          if (patch?.state === 'prepared' && options.lostSaveResponse) {
            return Promise.resolve({ data: null, error: { message: 'connection lost after commit' } }).then(resolve);
          }
          return Promise.resolve({ data: structuredClone(job), error: null }).then(resolve);
        },
      };
      return q;
    },
    async rpc(name, params) {
      if (name === 'reset_failed_badge_mint') {
        assert.equal(job.state, 'failed');
        assert.equal(params.p_signature, signature);
        job.previous_signature = job.tx_signature;
        job.state = 'pending'; job.tx_signature = null; job.signed_transaction = null;
        return { error: null };
      }
      assert.equal(name, 'complete_badge_mint');
      assert.equal(params.p_signature, signature);
      dbFinalizations++;
      job.state = 'confirmed'; job.asset_id = params.p_asset_id;
      return { error: null };
    },
  };
  const rpc = {
    async call(method,params) {
      if(method==='getTransaction') {
        assert.equal(params[1].commitment,'finalized');
        if(options.receiptError)throw Error('429');
        const status=options.chainStatuses?options.chainStatuses.shift():options.chainStatus;
        return status?.commitment==='finalized'?{meta:{err:status.error}}:null;
      }
      assert.equal(method,'getBlockHeight');return options.height??10;
    },
    async sendTransaction(transaction) {
      sent.push(transaction);
      if (options.sendError) throw new Error('network dropped after send');
      return signatureBytes;
    },
  };
  const mint = {
    async prepareBadgeMint() {
      preparations++;
      if (options.prepareError) throw new Error('RPC unavailable');
      if (options.beforePrepared) await options.beforePrepared();
      return { signed_transaction: 'c2lnbmVk', tx_signature: signature,
        last_valid_block_height: 100, rpc_url: 'https://rpc.invalid', tree_address: 'tree' };
    },
    mintRpc: (endpoint) => { assert.equal(endpoint, "rpc"); return ({ rpc, transactions: { deserialize: data => Buffer.from(data).toString() } }); },
  };
  const { processMint } = loadTs('lib/claim.ts', {
    'server-only': {}, '@/lib/api': { ApiError }, '@/lib/supabase': { supabase: db }, '@/lib/mint': mint,
    '@metaplex-foundation/mpl-bubblegum': {
      parseLeafFromMintV2Transaction: async () => ({ owner: options.wrongOwner ? 'attacker' : 'wallet', id: 'asset' }),
    },
  }, { process: { env: { SOLANA_RPC_URL: 'rpc', MINT_SECRET_KEY: 'key', MERKLE_TREE_ADDRESS: 'tree' } },
    console: { error() {} } });
  return { processMint, job, sent, stats: () => ({ preparations, dbFinalizations }) };
}

test('concurrent claims prepare once; retry resends identical bytes and signature', async () => {
  const state = setup();
  await Promise.all([state.processMint(structuredClone(state.job)), state.processMint(structuredClone(state.job))]);
  assert.equal(state.stats().preparations, 1);
  assert.equal(state.sent.length, 1);
  assert.equal(state.job.state, 'submitted');
  await state.processMint(structuredClone(state.job));
  assert.equal(state.sent.length, 2);
  assert.equal(state.sent[0], state.sent[1]);
  assert.equal(state.stats().preparations, 1);
});

test('network errors after send retain persisted transaction for safe retries', async () => {
  const state = setup({ sendError: true });
  const r = await state.processMint(structuredClone(state.job));
  assert.equal(r.status, 202);
  assert.equal(r.data.success, false);
  assert.equal(state.job.tx_signature, signature);
  assert.equal(state.job.state, 'prepared');
  await state.processMint(structuredClone(state.job));
  assert.equal(state.stats().preparations, 1);
  assert.equal(state.sent.length, 2);
});

test('preparation failures can retry, but a lost committed save never resets a prepared job', async () => {
  for (const options of [{ prepareError: true }, { lostSaveResponse: true }]) {
    const state = setup(options);
    await assert.rejects(state.processMint(structuredClone(state.job)), e => e.status === 503);
    assert.equal(state.sent.length, 0);
    assert.equal(state.job.state, options.prepareError ? 'pending' : 'prepared');
  }
});

test('only finalized mint succeeds; repeated completed claims do not send', async () => {
  const state = setup({ state: 'submitted', chainStatus: { commitment: 'finalized', error: null } });
  const r = await state.processMint(structuredClone(state.job));
  assert.equal(r.status, 200);
  assert.equal(r.data.success, true);
  assert.equal(state.job.asset_id, 'asset');
  await state.processMint(structuredClone(state.job));
  assert.equal(state.stats().dbFinalizations, 1);
  assert.equal(state.sent.length, 0);
  const pending = setup({ state: 'submitted', chainStatus: { commitment: 'confirmed', error: null } });
  assert.equal((await pending.processMint(structuredClone(pending.job))).status, 202);
  assert.equal(pending.stats().dbFinalizations, 0);
});

test('expired ambiguous transactions, finalized failures and owner mismatches never mint again', async () => {
  for (const options of [
    { state: 'submitted', height: 101 },
    { state: 'submitted', chainStatus: { commitment: 'finalized', error: 'failed' } },
    { state: 'submitted', chainStatus: { commitment: 'finalized', error: null }, wrongOwner: true },
  ]) {
    const state = setup(options);
    await assert.rejects(state.processMint(structuredClone(state.job)), e => e.status === 409);
    assert.equal(state.sent.length, 0);
    assert.equal(state.stats().preparations, 0);
    assert.equal(state.stats().dbFinalizations, 0);
  }
});

test('a stale preparer cannot persist/send after another worker obtains the lease', async () => {
  let state;
  state = setup({ beforePrepared: async () => { state.job.lease_id = 'new-owner'; } });
  const r = await state.processMint(structuredClone(state.job));
  assert.equal(r.status, 202);
  assert.equal(state.sent.length, 0);
  assert.equal(state.job.state, 'preparing');
});


test('a failed mint can retry only after an independently verified finalized error', async () => {
  const state = setup({ state: 'failed', chainStatuses: [
    { commitment: 'finalized', error: 'on-chain failure' }, null,
  ] });
  const r = await state.processMint(structuredClone(state.job), true);
  assert.equal(r.status, 202);
  assert.equal(state.job.previous_signature, signature);
  assert.equal(state.stats().preparations, 1);
  const unknown = setup({ state: 'failed' });
  await assert.rejects(unknown.processMint(structuredClone(unknown.job), true), e => e.status === 409);
  assert.equal(unknown.stats().preparations, 0);
  assert.equal(unknown.sent.length, 0);
});


test('mint receipt rate limits never cause a replacement mint or premature success',async()=>{
  const state=setup({state:'submitted',receiptError:true});const sig=state.job.tx_signature;
  const r=await state.processMint(structuredClone(state.job));
  assert.equal(r.status,202);assert.equal(r.data.success,false);
  assert.equal(state.job.tx_signature,sig);assert.equal(state.sent.length,0);assert.equal(state.stats().preparations,0);
});
