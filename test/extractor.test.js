import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertPdfBuffer, ExtractionInputError, extractDocument } from '../src/extractor.js';
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


test('extracts computo2 rows and unmarked category headings', async () => {
  const result = await extractDocument({
    buffer: await readFile(new URL('../examples/computo2.pdf', import.meta.url)),
    filename: 'computo2.pdf',
    mode: 'computo',
  });
  assert.equal(result.records.length, 213);
  assert.deepEqual(result.warnings, []);
  for (const number of [8, 19, 50, 74]) {
    assert.equal(result.records.find(record => record.numero === number)?.controllo, 'OK');
  }
  assert.deepEqual(
    result.records.find(record => record.numero === 19) && {
      supercategoria: result.records.find(record => record.numero === 19).supercategoria,
      categoria: result.records.find(record => record.numero === 19).categoria,
    },
    { supercategoria: 'Manutenzione cancelli e infissi', categoria: 'Demolizioni e rimozioni' },
  );
});
