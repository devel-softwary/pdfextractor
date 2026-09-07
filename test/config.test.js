import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('loads deployment settings from environment variables', () => {
  const config = loadConfig({ PORT: '8080', MAX_UPLOAD_MB: '10', JSON_BODY_LIMIT_MB: '5', APP_VERSION: 'abc123' });

  assert.deepEqual(config, {
    environment: 'development',
    port: 8080,
    maxUploadBytes: 10 * 1024 * 1024,
    maxUploadMb: 10,
    jsonBodyLimit: '5mb',
    version: 'abc123',
  });
});

test('rejects invalid numeric settings', () => {
  assert.throws(() => loadConfig({ MAX_UPLOAD_MB: 'zero' }), /MAX_UPLOAD_MB/);
});
