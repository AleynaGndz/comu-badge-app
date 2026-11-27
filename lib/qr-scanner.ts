import { Html5QrcodeScannerState } from "html5-qrcode";

type Scanner = {
  getState(): Html5QrcodeScannerState;
  stop(): Promise<void>;
  clear(): void;
};

// Strict Mode can mount another effect while the previous camera is still
// starting/stopping. Keep ownership until that session has released the element ID, even if React replaced the DOM node.
const owners = new Map<string, Promise<void>>();

export function startScannerSession<T extends Scanner>(
  element: HTMLElement,
  create: () => T,
  start: (scanner: T) => Promise<unknown>,
) {
  const key = element.id;
  const previous = owners.get(key) ?? Promise.resolve();
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  owners.set(key, released);
  let cancelled = false;
  let scanner: T | undefined;
  let stopping: Promise<void> | undefined;

  const ready = previous.then(async () => {
    if (cancelled) return;
    scanner = create();
    await start(scanner);
  });

  function stop(): Promise<void> {
    cancelled = true;
    // QR callbacks, effect cleanup and startup cancellation share one operation.
    stopping ??= (async () => {
      try {
        try { await ready; } catch { /* A denied camera never started. */ }
        if (scanner) {
          try {
            const state = scanner.getState();
            if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
              await scanner.stop(); // Also catches synchronous library throws.
            }
          } catch { /* Another shutdown may already have stopped the device. */ }
          try {
            if (scanner.getState() === Html5QrcodeScannerState.NOT_STARTED) scanner.clear();
          } catch { /* The page may already have removed the scanner element. */ }
        }
      } finally {
        release();
        if (owners.get(key) === released) owners.delete(key);
      }
    })();
    return stopping;
  }
  // Failed startup must release ownership even if the UI never unmounts.
  void ready.catch(() => stop());
  return { ready, stop };
}
