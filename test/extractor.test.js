import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPdfBuffer, ExtractionInputError } from '../src/extractor.js';
import { extractByMode } from '../src/detect.js';

test('rejects buffers that do not contain a PDF signature', () => {
  assert.throws(
    () => assertPdfBuffer(Buffer.from('not a PDF')),
    error => error instanceof ExtractionInputError && error.message === "Il file caricato non e' un PDF valido.",
  );
});

test('exposes supercategories in computo tables and exports', () => {
  const result = extractByMode([{
    page: 2,
    lines: [
      'Oneri di Sicurezza (SpCat 8)',
      '1 Presegnale di cantiere mobile',
      'SOMMANO cad/30gg 30,00 47,33 1.419,90',
    ],
  }], 'computo');

  assert.deepEqual(result.columns.slice(0, 5), [
    ['numero', '#'],
    ['tariffa', 'Tariffa'],
    ['supercategoria', 'Supercategoria'],
    ['categoria', 'Categoria'],
    ['sottocategoria', 'Sottocategoria'],
  ]);
  assert.equal(result.records[0].supercategoria, 'Oneri di Sicurezza');
});
