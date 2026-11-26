import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBrowserConsoleMessage, redactDiagnosticText } from './diagnostic-log.js';

test('redacts credentials while retaining useful diagnostic error codes', () => {
  assert.equal(
    redactDiagnosticText('code=E_NETWORK authorization=Bearer abc.def token=raw-token'),
    'code=E_NETWORK authorization=[REDACTED] token=[REDACTED]'
  );
  assert.equal(
    formatBrowserConsoleMessage(['request failed', { code: 'E_TIMEOUT', token: 'private' }]),
    'request failed {"code":"E_TIMEOUT"}'
  );
});
