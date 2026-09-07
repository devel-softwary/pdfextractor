import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';

test('creates the HTTP application with the supplied runtime configuration', () => {
  const app = createApp({
    config: { environment: 'test', version: 'test', maxUploadMb: 1, maxUploadBytes: 1024 * 1024, jsonBodyLimit: '1mb' },
  });

  assert.equal(typeof app, 'function');
  assert.equal(app.disabled('x-powered-by'), true);
});
