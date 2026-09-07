import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPdfBuffer, ExtractionInputError } from '../src/extractor.js';

test('rejects buffers that do not contain a PDF signature', () => {
  assert.throws(
    () => assertPdfBuffer(Buffer.from('not a PDF')),
    error => error instanceof ExtractionInputError && error.message === "Il file caricato non e' un PDF valido.",
  );
});
