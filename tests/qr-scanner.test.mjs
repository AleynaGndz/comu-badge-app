import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
const State = { NOT_STARTED: 1, SCANNING: 2, PAUSED: 3 };
function load() {
  return loadTs('lib/qr-scanner.ts', { 'html5-qrcode': { Html5QrcodeScannerState: State } });
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function scanner(log = []) {
  let state = State.NOT_STARTED;
  return {
    getState: () => state,
    async start() { log.push('start'); state = State.SCANNING; },
    async stop() { log.push('stop'); state = State.NOT_STARTED; },
    clear() { log.push('clear'); },
  };
}

test('QR success and effect cleanup share one stop and clear operation', async () => {
  const { startScannerSession } = load();
  const log = [];
  const device = scanner(log);
  const session = startScannerSession({ id: "qr" }, () => device, s => s.start());
  await session.ready;
  const first = session.stop();
  const second = session.stop();
  assert.equal(first, second);
  await Promise.all([first, second]);
  await session.stop();
  assert.deepEqual(log, ['start', 'stop', 'clear']);
});

test('stopped cameras are not stopped again; synchronous library throws are contained', async () => {
  const { startScannerSession } = load();
  for (const running of [false, true]) {
    let state = running ? State.SCANNING : State.NOT_STARTED;
    let calls = 0;
    const device = { getState: () => state, clear() {}, stop() {
      calls++; state = State.NOT_STARTED;
      throw new Error('Cannot stop, scanner is not running or paused.');
    } };
    const session = startScannerSession({ id: "qr" }, () => device, async () => {});
    await session.ready;
    await session.stop();
    assert.equal(calls, running ? 1 : 0);
  }
});

test('unmount before startup skips camera creation', async () => {
  const { startScannerSession } = load();
  const session = startScannerSession({ id: "qr" }, () => assert.fail('camera should not be created'), async () => {});
  await session.stop();
  await session.ready;
});

test('Strict Mode replacement waits for pending startup and old shutdown', async () => {
  const { startScannerSession } = load();
  const element = { id: "qr" };
  const started = deferred();
  const stopped = deferred();
  const log = [];
  const firstDevice = scanner(log);
  firstDevice.start = async () => { await started.promise; log.push('first-start'); };
  firstDevice.getState = () => State.SCANNING;
  firstDevice.stop = async () => { log.push('first-stop'); await stopped.promise; };
  const first = startScannerSession(element, () => firstDevice, s => s.start());
  await Promise.resolve();
  const closing = first.stop();
  const second = startScannerSession({ id: element.id }, () => { log.push('second-created'); return scanner(); }, s => s.start());
  await Promise.resolve();
  assert.equal(log.includes('second-created'), false);
  started.resolve();
  await first.ready;
  assert.equal(log.includes('second-created'), false);
  stopped.resolve();
  await closing;
  await second.ready;
  assert.ok(log.indexOf('first-stop') < log.indexOf('second-created'));
  await second.stop();
});

test('camera permission failure releases the element for a new session', async () => {
  const { startScannerSession } = load();
  const element = { id: "qr" };
  const first = startScannerSession(element, () => scanner(), async () => { throw new Error('permission denied'); });
  await assert.rejects(first.ready, /permission denied/);
  const second = startScannerSession(element, () => scanner(), s => s.start());
  await second.ready;
  await second.stop();
});
