import assert from 'node:assert/strict';
import test from 'node:test';
import { parseComputo } from '../src/parser.js';

function safetyEntry(summaryItems) {
  const item = (text, x, width = 20) => ({ text, x, width, height: 10 });
  return {
    page: 2, width: 793, height: 1122,
    rows: [
      { y: 970, items: [item('Oneri di Sicurezza (SpCat 8)', 170, 140)] },
      { y: 952, items: [item('1', 25), item('Presegnale di cantiere mobile', 87, 150)] },
      { y: 939, items: [item('CAM24_P01', 25, 56)] },
      { y: 926, items: [item('.060.040.A', 25, 50)] },
      { y: 850, items: summaryItems.map(([text, x, width]) => item(text, x, width)) },
    ],
  };
}

for (const [layout, summary] of [
  ['unit column', [['SOMMANO', 280, 48], ['cad/30gg', 360, 42], ['30,00', 610, 25], ['47,33', 660, 25], ["1’419,90", 728, 40]]],
  ['designation column', [['SOMMANO cad/30gg', 200, 100], ['30,00', 610, 25], ['47,33', 660, 25], ["1’419,90", 728, 40]]],
  ['screenshot positions', [['SOMMANO cad/30gg', 288, 96], ['30,00', 610, 25], ['47,33', 660, 25], ["1’419,90", 728, 40]]],
]) {
  test(`accepts cad/30gg with the unit in the ${layout}`, () => {
    const result = parseComputo([safetyEntry(summary)]);
    assert.equal(result.voci.length, 1);
    const entry = result.voci[0];
    assert.equal(entry.unitaMisura, 'cad/30gg');
    assert.equal(entry.quantita, 30);
    assert.equal(entry.prezzoUnitario, 47.33);
    assert.equal(entry.importo, 1419.9);
    assert.equal(entry.scostamento, 0);
    assert.equal(entry.controllo, 'OK');
    assert.equal(entry.tariffa, 'CAM24_P01 .060.040.A');
    assert.equal(entry.descrizione, 'Presegnale di cantiere mobile');
    assert.equal(entry.supercategoria, 'Oneri di Sicurezza');
    assert.equal(result.totaleEstratto, 1419.9);
    assert.deepEqual(result.warnings, []);
  });
}

test('accepts cad/30gg in text-only summaries without treating 30gg as quantity', () => {
  const result = parseComputo([{
    page: 2,
    lines: ['1 Presegnale di cantiere mobile', "SOMMANO cad/30gg 30,00 47,33 1’419,90"],
  }]);
  assert.equal(result.voci[0].unitaMisura, 'cad/30gg');
  assert.equal(result.voci[0].quantita, 30);
  assert.equal(result.voci[0].controllo, 'OK');
});

test('keeps cad/30gg entries incomplete when the quantity is missing', () => {
  const result = parseComputo([safetyEntry([
    ['SOMMANO cad/30gg', 288, 96], ['47,33', 660, 25], ["1’419,90", 728, 40],
  ])]);
  assert.equal(result.voci[0].quantita, null);
  assert.equal(result.voci[0].controllo, 'INCOMPLETO');
  assert.equal(result.warnings.length, 1);
});

test('still flags inconsistent amounts in cad/30gg summaries', () => {
  const result = parseComputo([safetyEntry([
    ['SOMMANO cad/30gg', 288, 96], ['30,00', 610, 25], ['47,33', 660, 25], ['1.420,00', 728, 40],
  ])]);
  assert.equal(result.voci[0].controllo, 'VERIFICARE');
  assert.equal(result.voci[0].scostamento, 0.1);
});

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
