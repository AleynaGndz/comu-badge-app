import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');

function load(file, fetch, timers = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, require, fetch, process, URL, Uint8Array, TextDecoder,
    AbortController, setTimeout, clearTimeout, ...timers,
  });
  return exports;
}
const base = 'https://sapphire-known-weasel-75.mypinata.cloud/ipfs/bafkreitest';
const request = uri => new NextRequest('http://localhost/api/badge-image' +
  (uri === undefined ? '' : '?uri=' + encodeURIComponent(uri)));

test('blocks unsafe URLs before fetch, including gateway lookalikes', async () => {
  const { GET } = load('app/api/badge-image/route.ts', () => assert.fail('unexpected fetch'));
  for (const uri of ['http://127.0.0.1', 'https://169.254.169.254',
    'https://sapphire-known-weasel-75.mypinata.cloud.evil.com/ipfs/abc',
    base.replace('https:', 'http:'), base.replace('/ipfs/', ':444/ipfs/'),
    base.replace('https://', 'https://user:pass@'), base + '?url=http://localhost',
    base.replace('/ipfs/', '/other/'), 'data:image/png,abc']) {
    assert.equal((await GET(request(uri))).status, 400, uri);
  }
  assert.equal((await GET(request())).status, 400);
});

test('serves direct images and safe metadata/IPFS images without redirects', async () => {
  let calls = 0;
  const { GET } = load('app/api/badge-image/route.ts', async (url, options) => {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal);
    calls++;
    return calls === 1
      ? Response.json({ image: 'ipfs://bafkreiimage' })
      : new Response('image bytes', { headers: { 'content-type': 'image/png' } });
  });
  const response = await GET(request(base));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'image bytes');
  assert.equal(calls, 2);
  assert.equal(response.headers.get('content-type'), 'image/png');
});

test('rejects malicious metadata and upstream redirects', async () => {
  for (const upstream of [Response.json({ image: 'http://localhost/private' }),
    new Response(null, { status: 302, headers: { location: 'http://localhost' } })]) {
    let calls = 0;
    const { GET } = load('app/api/badge-image/route.ts', async () => { calls++; return upstream; });
    assert.ok((await GET(request(base))).status >= 400);
    assert.equal(calls, 1);
  }
});

test('limits declared and streamed body size', async () => {
  for (const upstream of [new Response('a', { headers: { 'content-length': '5242881' } }),
    new Response(new Uint8Array(5242881))]) {
    const { GET } = load('app/api/badge-image/route.ts', async () => upstream);
    assert.equal((await GET(request(base))).status, 413);
  }
});

test('deadline aborts upstream request', async () => {
  const { GET } = load('app/api/badge-image/route.ts', (url, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
    { setTimeout: fn => setTimeout(fn, 5) });
  assert.equal((await GET(request(base))).status, 504);
});

test('logout clears the exact session cookie and is repeatable', async () => {
  const { POST } = load('app/api/auth/logout/route.ts');
  for (let i = 0; i < 2; i++) {
    const response = await POST();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    const cookie = response.headers.get('set-cookie');
    for (const expected of ['campuspass_session=;', 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=strict']) {
      assert.ok(cookie.includes(expected), cookie);
    }
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
