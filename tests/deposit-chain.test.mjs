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
  const {prepareSolTransfer,decodeSignedPayment}=load();
  const payer=web3.Keypair.generate();const treasury=web3.Keypair.generate();
  const blockhash=web3.Keypair.generate().publicKey.toBase58();
  const {transaction,lastValidBlockHeight}=await prepareSolTransfer({getLatestBlockhash:async()=>({blockhash,lastValidBlockHeight:100})},
    payer.publicKey.toBase58(),treasury.publicKey.toBase58(),500000000,'CampusPass deposit:unique-id');
  const transfer=web3.SystemInstruction.decodeTransfer(transaction.instructions[0]);
  assert.equal(transfer.fromPubkey.toBase58(),payer.publicKey.toBase58());
  assert.equal(transfer.toPubkey.toBase58(),treasury.publicKey.toBase58());
  assert.equal(Number(transfer.lamports),500000000);
  assert.equal(transaction.instructions[1].data.toString(),'CampusPass deposit:unique-id');
  assert.equal(lastValidBlockHeight,100);
  transaction.sign(payer);
  const signed=transaction.serialize().toString('base64');
  const decoded=decodeSignedPayment(signed);
  assert.equal(decoded.message,transaction.serializeMessage().toString('base64'));
  assert.equal(decoded.signed,signed);
  transaction.instructions[0]=web3.SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:treasury.publicKey,lamports:1});
  const tampered=transaction.serialize({verifySignatures:false}).toString('base64');
  assert.throws(()=>decodeSignedPayment(tampered),e=>e.status===400);
  assert.throws(()=>decodeSignedPayment('not-a-transaction'),e=>e.status===400);
});
