import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketApiBase } from './routing.js';

test('only demo accounts receive an order API route', () => {
  assert.equal(ticketApiBase('demo'), '/api/demo');
  assert.equal(ticketApiBase('real'), null);
  assert.equal(ticketApiBase(undefined), null);
});
