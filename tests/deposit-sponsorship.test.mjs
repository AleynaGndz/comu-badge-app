import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction,SystemInstruction} from '@solana/web3.js';
import {loadTs} from './helpers/load-ts.mjs';
class ApiError extends Error { constructor(message,status){super(message);this.status=status;} }
async function setup(options={}) {
  const student=Keypair.generate();const custody=Keypair.generate();const sent=[];const operations=[];
  const chain=loadTs('lib/deposit-chain.ts',{'server-only':{},'@/lib/api':{ApiError}});
  const connection={getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100}),
    getBlockHeight:async()=>10,getFeeForMessage:async()=>({value:10100}),
    getBalance:async pub=>pub.equals(student.publicKey)?500000000:20000000,
    getSignatureStatuses:async()=>({value:[null]}),
    sendRawTransaction:async raw=>{operations.push('broadcast');sent.push(raw);const tx=Transaction.from(raw);return chain.decodeSignedPayment(tx.serialize().toString('base64')).signature;}};
  const row={id:'deposit',event_id:'event',user_id:'student',wallet_address:student.publicKey.toBase58(),treasury_address:custody.publicKey.toBase58(),
    lamports:500000000,rpc_url:'devnet',state:'pending',payment_signature:null};
  let proposal;let sponsorCalls=0;
  const db={from(table){const filters=[];let insert;let latest=false;const q={
    select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(){latest=true;return q;},limit(){return q;},maybeSingle(){return q;},
    upsert(value){insert=value;return q;},then(resolve){
      if(insert){proposal=insert;operations.push('proposal-saved');return Promise.resolve({error:null}).then(resolve);}
      if(table==='event_deposits')return Promise.resolve({data:options.missingOwner?null:structuredClone(row),error:null}).then(resolve);
      const found=proposal&&!options.missingProposal&&filters.every(([k,v])=>proposal[k]===v);
      return Promise.resolve({data:found||latest&&proposal?structuredClone(proposal):null,error:null}).then(resolve);
    }};return q;},async rpc(name,args){operations.push(name);
      if(name==='create_deposit_intent')return {data:structuredClone(row),error:null};
      assert.equal(name,'bind_deposit_payment');
      Object.assign(row,{state:'submitted',payment_signature:args.p_signature,signed_transaction:args.p_signed,payment_message:args.p_message,last_valid_block_height:100});
      if(options.lostBind)return {error:{code:'network'}};
      return {data:structuredClone(row),error:null};}};
  const api=loadTs('lib/deposits.ts',{'server-only':{},'@/lib/api':{ApiError},'@/lib/supabase':{supabase:db},
    '@/lib/deposit-chain':{...chain,depositSigner:()=>custody,devnetConnection:async()=>connection,
      sponsorDepositPayment(...args){sponsorCalls++;return chain.sponsorDepositPayment(...args);}}});
  const prepared=await api.prepareDeposit('student','event');
  const tx=Transaction.from(Buffer.from(prepared.transaction,'base64'));tx.partialSign(student);
  const partial=tx.serialize({requireAllSignatures:false}).toString('base64');
  return {...api,row,custody,student,prepared,partial,operations,sent,sponsorCalls:()=>sponsorCalls};
}

test('a student with exactly 0.5 SOL can prepare a sponsored deposit without a fee balance',async()=>{
  const s=await setup();const tx=Transaction.from(Buffer.from(s.prepared.transaction,'base64'));
  assert.equal(tx.feePayer.toBase58(),s.custody.publicKey.toBase58());
  const transfer=SystemInstruction.decodeTransfer(tx.instructions[2]);
  assert.equal(transfer.fromPubkey.toBase58(),s.student.publicKey.toBase58());assert.equal(transfer.lamports,500000000n);
});
test('co-signed payment is persisted before send and retries reuse its exact bytes',async()=>{
  const s=await setup();assert.equal((await s.submitDeposit('student','deposit',s.partial)).status,202);
  assert.equal(s.sponsorCalls(),1);assert.equal(s.sent.length,1);
  assert.ok(s.operations.indexOf('bind_deposit_payment')<s.operations.indexOf('broadcast'));
  assert.equal(Transaction.from(s.sent[0]).verifySignatures(),true);
  await s.submitDeposit('student','deposit',s.partial);assert.equal(s.sponsorCalls(),1);
  assert.equal(Buffer.compare(s.sent[0],s.sent[1]),0);
});
test('unknown owner/proposal never receives a sponsor signature and lost bind never broadcasts',async()=>{
  for(const options of [{missingOwner:true},{missingProposal:true},{lostBind:true}]){
    const s=await setup(options);await assert.rejects(s.submitDeposit('student','deposit',s.partial));
    assert.equal(s.sent.length,0);assert.equal(s.sponsorCalls(),options.lostBind?1:0);
    if(options.lostBind){await s.submitDeposit('student','deposit',s.partial);assert.equal(s.sponsorCalls(),1);assert.equal(s.sent.length,1);}
  }
});
