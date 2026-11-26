import { formatBrowserConsoleMessage } from '../../../shared/diagnostic-log.js';

const MAX_BATCH_SIZE = 20;
const MAX_QUEUE_SIZE = 100;
const FLUSH_DELAY_MS = 15_000;

export function installBrowserConsoleCapture(accountRef) {
  if (!/^[A-Za-z0-9_-]{20,30}$/.test(accountRef || '')) return () => {};

  const queue = [];
  const originals = new Map();
  let timer = null;
  let sending = false;

  function scheduleFlush() {
    if (timer || sending || !queue.length) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_DELAY_MS);
  }

  async function flush() {
    if (sending || !queue.length) return;
    sending = true;
    const batch = queue.splice(0, MAX_BATCH_SIZE);
    try {
      const response = await fetch('/api/diagnostics/client', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'X-PlayGo-Request': '1',
        },
        body: JSON.stringify({
          accountRef,
          entries: batch.map(({ level, message, path, clientTime }) => ({
            level,
            message,
            path,
            clientTime,
          })),
        }),
      });
      if (!response.ok) throw Error('BROWSER_DIAGNOSTICS_WRITE_FAILED');
    } catch {
      const retry = batch
        .filter((entry) => entry.attempts < 1)
        .map((entry) => ({ ...entry, attempts: entry.attempts + 1 }));
      queue.unshift(...retry);
      if (!retry.length)
        window.dispatchEvent(
          new CustomEvent('playgo:diagnostics-error', {
            detail: { code: 'BROWSER_DIAGNOSTICS_WRITE_FAILED' },
          })
        );
    } finally {
      sending = false;
      scheduleFlush();
    }
  }

  function record(level, args) {
    const message = formatBrowserConsoleMessage(args);
    if (!message) return;
    queue.push({
      level,
      message,
      path: window.location.pathname,
      clientTime: new Date().toISOString(),
      attempts: 0,
    });
    if (queue.length > MAX_QUEUE_SIZE) queue.shift();
    if (queue.length >= MAX_BATCH_SIZE) void flush();
    else scheduleFlush();
  }

  for (const level of ['warn', 'error']) {
    const original = console[level];
    originals.set(level, original);
    console[level] = function capturedConsoleMessage(...args) {
      original.apply(console, args);
      record(level, args);
    };
  }

  const onError = (event) => record('error', [event.message || 'Unhandled browser error']);
  const onRejection = (event) => record('error', [event.reason || 'Unhandled promise rejection']);
  const onPageHide = () => {
    void flush();
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('pagehide', onPageHide);
    for (const [level, original] of originals) {
      if (console[level]?.name === 'capturedConsoleMessage') console[level] = original;
    }
    void flush();
  };
}
