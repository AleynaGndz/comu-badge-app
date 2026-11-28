import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
const address = '3ik8GruqgaJ2gmDqMkjVaNhZFJNLFMAGQnw3FZiB1wRz';
function setup({ fail = false, allowed = true } = {}) {
  let calls = 0;
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const route = loadTs('app/api/wallet/balance/route.ts', {
    '@/lib/api': { ApiError, requireUser: async () => ({ wallet_address: allowed ? address : 'other' }),
      wallet: value => value, json: value => Response.json(value),
      apiError: error => Response.json({ success: false, message: error.message }, { status: error.status || 503 }) },
    '@/lib/deposit-chain': { devnetConnection: async () => ({ getBalance: async () => {
      calls++; if (fail) throw new Error('Bakiye alınamadı'); return 5_000_000_000;
    } }) },
  });
  return { route, calls: () => calls };
}
const request = () => new Request(`http://localhost/api/wallet/balance?wallet=${address}`);
test('balance coalesces concurrent requests and caches successful reads', async () => {
  const h = setup();
  const responses = await Promise.all([h.route.GET(request()), h.route.GET(request())]);
  assert.equal(h.calls(), 1);
  assert.equal((await responses[0].json()).lamports, 5_000_000_000);
  await h.route.GET(request()); assert.equal(h.calls(), 1);
});
test('balance provider failures never become a successful zero balance', async () => {
  const h = setup({ fail: true });
  const response = await h.route.GET(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).lamports, undefined);
  await h.route.GET(request()); assert.equal(h.calls(), 2);
});
test('balance rejects a wallet that differs from the signed-in wallet', async () => {
  const h = setup({ allowed: false });
  assert.equal((await h.route.GET(request())).status, 403);
  assert.equal(h.calls(), 0);
});
