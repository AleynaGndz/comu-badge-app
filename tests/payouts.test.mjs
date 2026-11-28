import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadTs } from './helpers/load-ts.mjs';
class ApiError extends Error { constructor(message,status) { super(message);this.status=status; } }
function setup(options={}) {
  const signer=Keypair.generate();const receiver=Keypair.generate().publicKey.toBase58();
  const transaction=new Transaction({feePayer:signer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()})
    .add(SystemProgram.transfer({fromPubkey:signer.publicKey,toPubkey:receiver,lamports:500000000}));
  transaction.sign(signer);
  const signature=bs58.encode(transaction.signature);
  const job={id:'payout',event_id:'event',user_id:'user',wallet_address:receiver,treasury_address:signer.publicKey.toBase58(),
    rpc_url:'rpc',lamports:500000000,kind:'refund',state:options.state??'pending',lease_id:null,lease_expires_at:null,
    ...(options.state?{signed_transaction:transaction.serialize().toString('base64'),tx_signature:signature,last_valid_block_height:100}:{})};
  const sent=[];let prepared=0;
  const db={from(){const filters=[];let patch;const q={select(){return q;},single(){return q;},maybeSingle(){return q;},
    update(p){patch=p;return q;},eq(k,v){filters.push(()=>job[k]===v);return q;},neq(k,v){filters.push(()=>job[k]!==v);return q;},
    in(k,v){filters.push(()=>v.includes(job[k]));return q;},or(){filters.push(()=>!job.lease_expires_at||Date.parse(job.lease_expires_at)<Date.now());return q;},
    then(resolve){if(!filters.every(f=>f()))return Promise.resolve({data:null,error:null}).then(resolve);
      if(patch)Object.assign(job,structuredClone(patch));
      if(patch?.state==='prepared'&&options.lostSave)return Promise.resolve({error:{code:'network'}}).then(resolve);
      return Promise.resolve({data:structuredClone(job),error:null}).then(resolve);}};return q;}};
  const connection={
    getTransaction:async()=>{if(options.receiptError)throw Error('429');return options.chainStatus?{meta:{err:options.chainStatus.err}}:null;},getBlockHeight:async()=>options.height??10,
    getBalance:async()=>options.balance??2000000000,getFeeForMessage:async()=>({value:5000}),
    sendRawTransaction:async raw=>{sent.push(Buffer.from(raw).toString('base64'));if(options.sendError)throw new Error('timeout');return signature;},
  };
  const {processPayout}=loadTs('lib/deposits.ts',{'server-only':{},'@/lib/api':{ApiError},'@/lib/supabase':{supabase:db},
    '@/lib/deposit-chain':{depositSigner:()=>signer,devnetConnection:async()=>connection,
      prepareSolTransfer:async()=>{prepared++;return {transaction,lastValidBlockHeight:100};}}});
  return {job,sent,processPayout,prepared:()=>prepared};
}

test('concurrent refunds sign once and repeated submissions reuse identical transactions',async()=>{
  const s=setup();await Promise.all([s.processPayout(structuredClone(s.job)),s.processPayout(structuredClone(s.job))]);
  assert.equal(s.prepared(),1);assert.equal(s.sent.length,1);
  await s.processPayout(structuredClone(s.job));assert.equal(s.prepared(),1);assert.equal(s.sent[0],s.sent[1]);
});
test('network uncertainty and lost save responses cannot cause a second refund',async()=>{
  const network=setup({sendError:true});await network.processPayout(structuredClone(network.job));
  assert.equal(network.job.state,'prepared');await network.processPayout(structuredClone(network.job));assert.equal(network.prepared(),1);
  const lost=setup({lostSave:true});await assert.rejects(lost.processPayout(structuredClone(lost.job)));
  assert.equal(lost.job.state,'prepared');assert.equal(lost.sent.length,0);
});
test('finalized payout success is idempotent; expiry or failure never creates a replacement',async()=>{
  const ok=setup({state:'submitted',chainStatus:{confirmationStatus:'finalized',err:null}});
  assert.equal((await ok.processPayout(structuredClone(ok.job))).state,'confirmed');
  await ok.processPayout(structuredClone(ok.job));assert.equal(ok.sent.length,0);
  for(const options of [{state:'submitted',height:101},{state:'submitted',chainStatus:{confirmationStatus:'finalized',err:'failed'}}]){
    const s=setup(options);await assert.rejects(s.processPayout(structuredClone(s.job)),e=>e.status===409);assert.equal(s.sent.length,0);assert.equal(s.prepared(),0);
  }
});
test('insufficient custody balance keeps the refund pending without sending or reducing its principal',async()=>{
  const s=setup({balance:500000000});await assert.rejects(s.processPayout(structuredClone(s.job)),e=>e.status===503);
  assert.equal(s.sent.length,0);assert.equal(s.job.state,'pending');assert.equal(s.job.lamports,500000000);
});

test('receipt failures keep an outgoing payment intact without a replacement broadcast',async()=>{
  const s=setup({state:'submitted',receiptError:true});const before=s.job.tx_signature;
  const view=await s.processPayout(structuredClone(s.job));
  assert.equal(view.state,'submitted');assert.equal(s.job.tx_signature,before);
  assert.equal(s.sent.length,0);assert.equal(s.prepared(),0);
});
