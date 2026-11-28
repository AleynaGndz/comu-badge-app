import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as web3 from '@solana/web3.js';
import { loadTs } from './helpers/load-ts.mjs';
class ApiError extends Error { constructor(message,status) { super(message); this.status=status; } }
const genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
function load(env = {}, chain = genesis) {
  return loadTs('lib/deposit-chain.ts', { 'server-only': {}, '@/lib/api': { ApiError },
    '@solana/web3.js': { ...web3, Connection: class { async getGenesisHash() { return chain; } } },
  }, { process: { env: { SOLANA_RPC_URL:'https://rpc.invalid', ...env } } });
}

test('custody rejects mainnet/testnet and requires a separate valid key', async () => {
  const key = JSON.stringify(Array.from(web3.Keypair.generate().secretKey));
  const current = load({ DEPOSIT_SECRET_KEY:key });
  assert.equal(current.depositSigner().secretKey.length,64);
  await assert.rejects(load({},'mainnet-genesis').devnetConnection(),e=>e.status===503);
  assert.throws(()=>load({DEPOSIT_SECRET_KEY:'{'}).depositSigner(),e=>e.status===503);
  assert.throws(()=>load({DEPOSIT_SECRET_KEY:'[1,2]'}).depositSigner(),e=>e.status===503);
  assert.throws(()=>load({DEPOSIT_SECRET_KEY:key,MINT_SECRET_KEY:key}).depositSigner(),e=>e.status===503);
});

test('unsigned proposal encodes exact payer, recipient, 0.5 SOL and unique deposit reference', async () => {
  const {prepareSolTransfer,decodeSignedPayment,proposalHasExplicitFees}=load();
  const payer=web3.Keypair.generate();const treasury=web3.Keypair.generate();
  const blockhash=web3.Keypair.generate().publicKey.toBase58();
  const {transaction,lastValidBlockHeight}=await prepareSolTransfer({getLatestBlockhash:async()=>({blockhash,lastValidBlockHeight:100})},
    payer.publicKey.toBase58(),treasury.publicKey.toBase58(),500000000,'CampusPass deposit:unique-id');
  const transfer=web3.SystemInstruction.decodeTransfer(transaction.instructions[2]);
  assert.equal(transfer.fromPubkey.toBase58(),payer.publicKey.toBase58());
  assert.equal(transfer.toPubkey.toBase58(),treasury.publicKey.toBase58());
  assert.equal(Number(transfer.lamports),500000000);
  assert.equal(transaction.instructions[3].data.toString(),'CampusPass deposit:unique-id');
  assert.equal(lastValidBlockHeight,100);
  assert.equal(proposalHasExplicitFees(transaction.serialize({requireAllSignatures:false}).toString('base64')),true);
  assert.equal(web3.ComputeBudgetInstruction.decodeSetComputeUnitLimit(transaction.instructions[0]).units,100000);
  assert.equal(web3.ComputeBudgetInstruction.decodeSetComputeUnitPrice(transaction.instructions[1]).microLamports,1000n);
  const legacy=web3.Transaction.from(transaction.serialize({requireAllSignatures:false}));
  legacy.instructions=legacy.instructions.slice(2);
  assert.equal(proposalHasExplicitFees(legacy.serialize({requireAllSignatures:false}).toString('base64')),false);
  transaction.sign(payer);
  const signed=transaction.serialize().toString('base64');
  const decoded=decodeSignedPayment(signed);
  assert.equal(decoded.message,transaction.serializeMessage().toString('base64'));
  assert.equal(decoded.signed,signed);
  transaction.instructions[2]=web3.SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:treasury.publicKey,lamports:1});
  const tampered=transaction.serialize({verifySignatures:false}).toString('base64');
  assert.throws(()=>decodeSignedPayment(tampered),e=>e.status===400);
  assert.throws(()=>decodeSignedPayment('not-a-transaction'),e=>e.status===400);
});

test('custody sponsors the exact deposit while student authorizes only the principal', async () => {
  const chain=load();const student=web3.Keypair.generate();const custody=web3.Keypair.generate();
  const {transaction}=await chain.prepareSolTransfer({getLatestBlockhash:async()=>({blockhash:web3.Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100})},
    student.publicKey.toBase58(),custody.publicKey.toBase58(),500000000,'CampusPass deposit:test',custody.publicKey.toBase58());
  const expected=transaction.serializeMessage().toString('base64');
  assert.equal(transaction.feePayer.toBase58(),custody.publicKey.toBase58());
  assert.equal(transaction.compileMessage().header.numRequiredSignatures,2);
  transaction.partialSign(student);
  assert.equal(transaction.signature,null); // Sponsor has not signed yet.
  const partial=chain.decodeSignedPayment(transaction.serialize({requireAllSignatures:false}).toString('base64'),student.publicKey.toBase58());
  const signed=chain.sponsorDepositPayment(partial,expected,student.publicKey.toBase58(),custody);
  const complete=web3.Transaction.from(Buffer.from(signed.signed,'base64'));
  assert.equal(complete.verifySignatures(),true);
  assert.equal(complete.serializeMessage().toString('base64'),expected);
  assert.equal(web3.SystemInstruction.decodeTransfer(complete.instructions[2]).lamports,500000000n);
  assert.equal(chain.sponsorDepositPayment(partial,expected,student.publicKey.toBase58(),custody).signature,signed.signature);
});

test('sponsor refuses missing student signature, modified messages and a different fee payer', async () => {
  const chain=load();const student=web3.Keypair.generate();const custody=web3.Keypair.generate();
  const {transaction}=await chain.prepareSolTransfer({getLatestBlockhash:async()=>({blockhash:web3.Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100})},
    student.publicKey.toBase58(),custody.publicKey.toBase58(),500000000,'CampusPass deposit:test',custody.publicKey.toBase58());
  const expected=transaction.serializeMessage().toString('base64');
  assert.throws(()=>chain.decodeSignedPayment(transaction.serialize({requireAllSignatures:false}).toString('base64'),student.publicKey.toBase58()),e=>e.status===400);
  transaction.partialSign(student);
  const partial=chain.decodeSignedPayment(transaction.serialize({requireAllSignatures:false}).toString('base64'),student.publicKey.toBase58());
  assert.throws(()=>chain.sponsorDepositPayment(partial,'arbitrary-message',student.publicKey.toBase58(),custody),e=>e.status===400);
  assert.throws(()=>chain.sponsorDepositPayment(partial,expected,student.publicKey.toBase58(),web3.Keypair.generate()),e=>e.status===400);
  transaction.instructions[2]=web3.SystemProgram.transfer({fromPubkey:student.publicKey,toPubkey:custody.publicKey,lamports:1});
  assert.throws(()=>chain.decodeSignedPayment(transaction.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'),student.publicKey.toBase58()),e=>e.status===400);
  transaction.partialSign(student);
  const changed=chain.decodeSignedPayment(transaction.serialize({requireAllSignatures:false}).toString('base64'),student.publicKey.toBase58());
  assert.throws(()=>chain.sponsorDepositPayment(changed,expected,student.publicKey.toBase58(),custody),e=>e.status===400);
});


test('RPC clients and genesis checks are shared per endpoint, including concurrent requests',async()=>{
  let connections=0,checks=0;const configs=[];
  class Connection {constructor(_url,config){connections++;configs.push(config);}async getGenesisHash(){checks++;await Promise.resolve();return genesis;}}
  const chain=loadTs('lib/deposit-chain.ts',{'server-only':{},'@/lib/api':{ApiError},'@solana/web3.js':{...web3,Connection}});
  const clients=await Promise.all(Array.from({length:8},()=>chain.devnetConnection('https://first.invalid')));
  assert.equal(connections,1);assert.equal(checks,1);assert.ok(clients.every(c=>c===clients[0]));
  assert.equal(await chain.devnetConnection('https://first.invalid'),clients[0]);assert.equal(checks,1);
  await chain.devnetConnection('https://second.invalid');assert.equal(connections,2);assert.equal(checks,2);
  assert.ok(configs.every(c=>c.disableRetryOnRateLimit===true));
});
test('RPC 429 errors are sanitized and back off without repeated network calls',async()=>{
  let calls=0,clock=100000;
  class Connection {async getGenesisHash(){return genesis;}async getBalance(){calls++;throw Error('429 connection rate limits: https://rpc.invalid?api-key=private-secret');}}
  const chain=loadTs('lib/deposit-chain.ts',{'server-only':{},'@/lib/api':{ApiError},'@solana/web3.js':{...web3,Connection}},{Date:{now:()=>clock}});
  const c=await chain.devnetConnection('https://first.invalid');
  for(let n=0;n<3;n++)await assert.rejects(c.getBalance(),e=>e.status===503&&!e.message.includes('private-secret'));
  assert.equal(calls,1);clock+=6000;
  await assert.rejects(c.getBalance(),e=>e.status===503);assert.equal(calls,2);
});
test('failed genesis validation is never cached as a verified Devnet connection',async()=>{
  let checks=0;
  class Connection {async getGenesisHash(){checks++;if(checks===1)throw Error('network offline');return genesis;}}
  const chain=loadTs('lib/deposit-chain.ts',{'server-only':{},'@/lib/api':{ApiError},'@solana/web3.js':{...web3,Connection}});
  await assert.rejects(chain.devnetConnection('https://first.invalid'),e=>e.status===503);
  await chain.devnetConnection('https://first.invalid');assert.equal(checks,2);
});
