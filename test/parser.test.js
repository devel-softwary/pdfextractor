import assert from 'node:assert/strict';
import test from 'node:test';
import { parseComputo } from '../src/parser.js';

test('parses a PriMus-style entry and verifies its amount', () => {
  const result = parseComputo([{
    page: 1,
    lines: [
      'Murature (Cat 1)',
      '1 Fornitura e posa di muratura in laterizio',
      'CAM01_01 01/01/2025',
      'SOMMANO... mq 10,00 5,00 50,00',
    ],
  }]);

  assert.equal(result.voci.length, 1);
  assert.deepEqual(result.voci[0], {
    numero: 1,
    tariffa: 'CAM01_01',
    dataTariffa: '01/01/2025',
    supercategoria: '',
    categoria: 'Murature',
    sottocategoria: '',
    descrizione: 'Fornitura e posa di muratura in laterizio',
    unitaMisura: 'mq',
    quantita: 10,
    prezzoUnitario: 5,
    importo: 50,
    paginaInizio: 1,
    paginaFine: 1,
    scostamento: 0,
    controllo: 'OK',
  });
  assert.equal(result.totaleEstratto, 50);
  assert.deepEqual(result.warnings, []);
});

test('accepts cadauno in SOMMANO rows instead of marking the entry incomplete', () => {
  const result = parseComputo([{
    page: 25,
    lines: [
      'Campo Calcetto (Cat 1)',
      'Recinzioni (SbCat 1)',
      '101 Fornitura e posa in opera di paline in ferro zincato',
      'N.P.06_Reci nzione.paline 22/10/2025',
      'SOMMANO... cadauno 46,00 176,93 8.138,78',
    ],
  }]);

  assert.equal(result.voci.length, 1);
  assert.deepEqual(result.voci[0], {
    numero: 101,
    tariffa: 'N.P.06_Reci nzione.paline',
    dataTariffa: '22/10/2025',
    supercategoria: '',
    categoria: 'Campo Calcetto',
    sottocategoria: 'Recinzioni',
    descrizione: 'Fornitura e posa in opera di paline in ferro zincato',
    unitaMisura: 'cadauno',
    quantita: 46,
    prezzoUnitario: 176.93,
    importo: 8138.78,
    paginaInizio: 25,
    paginaFine: 25,
    scostamento: 0,
    controllo: 'OK',
  });
  assert.equal(result.totaleEstratto, 8138.78);
  assert.deepEqual(result.warnings, []);
});

test('accepts mq/cm from a positioned PriMus SOMMANO row', () => {
  const item = (text, x) => ({ text, x, width: 20, height: 10 });
  const result = parseComputo([{
    page: 3,
    width: 1000,
    height: 1400,
    rows: [
      { y: 100, items: [item('80', 30), item('Conglomerato bituminoso', 150)] },
      { y: 120, items: [item('CAM26_U05.020.095.A', 30), item('24/10/2020', 80)] },
      {
        y: 140,
        items: [
          item('SOMMANO...', 380), item('mq/cm', 460), item('3.078,36', 780),
          item('2,60', 850), item('8.003,74', 930),
        ],
      },
    ],
  }]);

  assert.equal(result.voci.length, 1);
  assert.equal(result.voci[0].unitaMisura, 'mq/cm');
  assert.equal(result.voci[0].quantita, 3078.36);
  assert.equal(result.voci[0].prezzoUnitario, 2.6);
  assert.equal(result.voci[0].importo, 8003.74);
  assert.equal(result.voci[0].controllo, 'OK');
  assert.deepEqual(result.warnings, []);
});

test('accepts gg from a positioned PriMus SOMMANO row', () => {
  const item = (text, x) => ({ text, x, width: 20, height: 10 });
  const result = parseComputo([{
    page: 23,
    width: 1000,
    height: 1400,
    rows: [
      { y: 100, items: [item('96', 30), item('Livellazione sottofondi', 150)] },
      {
        y: 120,
        items: [
          item('SOMMANO...', 380), item('gg', 460), item('2,00', 780),
          item('2.649,98', 850), item('5.299,96', 930),
        ],
      },
    ],
  }]);

  assert.equal(result.voci[0].unitaMisura, 'gg');
  assert.equal(result.voci[0].quantita, 2);
  assert.equal(result.voci[0].prezzoUnitario, 2649.98);
  assert.equal(result.voci[0].importo, 5299.96);
  assert.equal(result.voci[0].controllo, 'OK');
});
