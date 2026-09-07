import assert from 'node:assert/strict';
import test from 'node:test';
import { parseComputo } from '../src/parser.js';

function lumpSumEntry(label = 'a corpo', summary = ['1,00', "374’180,42", "374’180,42"]) {
  const item = (text, x, width) => ({ text, x, width, height: 10 });
  return {
    page: 15, width: 793, height: 1122,
    rows: [
      { y: 950, items: [item('98', 17, 12), item('Opere di sostegno e ponticelli', 79, 150)] },
      { y: 936, items: [item('PA.05', 17, 28)] },
      { y: 922, items: [item(label, 79, 160), item('1,00', 607, 20)] },
      { y: 896, items: [item('SOMMANO', 320, 56), ...summary.map((text, i) => item(text, [607, 634, 711][i], i === 0 ? 20 : 48))] },
      { y: 845, items: [item('Parziale LAVORI A MISURA euro', 215, 161), item("6’996’439,06", 701, 58)] },
      { y: 805, items: [item('T O T A L E euro', 290, 86), item("6’996’439,06", 701, 58)] },
    ],
  };
}

test('uses the preceding a corpo label for a unitless positioned summary', () => {
  const result = parseComputo([lumpSumEntry()]);
  const entry = result.voci[0];
  assert.equal(result.voci.length, 1);
  assert.equal(entry.numero, 98);
  assert.equal(entry.tariffa, 'PA.05');
  assert.equal(entry.descrizione, 'Opere di sostegno e ponticelli a corpo');
  assert.equal(entry.unitaMisura, 'a corpo');
  assert.equal(entry.quantita, 1);
  assert.equal(entry.prezzoUnitario, 374180.42);
  assert.equal(entry.importo, 374180.42);
  assert.equal(entry.scostamento, 0);
  assert.equal(entry.controllo, 'OK');
  assert.equal(result.totaleEstratto, 374180.42);
  assert.deepEqual(result.warnings, []);
});

for (const positioned of [true, false]) {
  const page = (number, lines) => ({
    page: number, width: 793, height: 1122,
    ...(positioned ? { rows: lines.map((text, index) => {
      const numbered = text.match(/^(\d+) (.*)$/);
      return { y: 1000 - index * 20, items: numbered
        ? [{ text: numbered[1], x: 17, width: 20, height: 10 }, { text: numbered[2], x: 80, width: 220, height: 10 }]
        : [{ text, x: 80, width: 320, height: 10 }] };
    }) } : { lines }),
  });

  test(`separates category headings, totals and multipage recaps (${positioned ? 'positioned' : 'text'})`, () => {
    const result = parseComputo([
      page(20, [
        'Opere di Sostegno e Ponticelli (SpCat 5)',
        '98 Opere di sostegno e ponticelli', 'a corpo',
        "SOMMANO 1,00 374’180,42 374’180,42",
        '------------------', "Parziale LAVORI A MISURA euro 6’996’439,06",
        "T O T A L E euro 6’996’439,06",
      ]),
      page(21, ['Riepilogo SUPER CATEGORIE', "001 Rinaturalizzazione 455’273,35 6,507"]),
      page(22, ["005 Opere di sostegno e ponticelli 374’180,42 5,348", "Totale SUPER CATEGORIE euro 6’996’439,06 100,000"]),
    ]);
    assert.equal(result.voci.length, 1);
    assert.equal(result.voci[0].descrizione, 'Opere di sostegno e ponticelli a corpo');
    assert.equal(result.voci[0].supercategoria, 'Opere di Sostegno e Ponticelli');
    assert.equal(result.voci[0].paginaFine, 20);
    assert.equal(result.voci[0].controllo, 'OK');
    assert.equal(result.totaleEstratto, 374180.42);
    assert.deepEqual(result.warnings, []);
  });

  test(`resumes work entries after subtotals and recaps (${positioned ? 'positioned' : 'text'})`, () => {
    const result = parseComputo([page(1, [
      'Categoria prima (SpCat 1)', '1 Prima voce', 'SOMMANO mq 1,00 5,00 5,00',
      'Parziale LAVORI A MISURA euro 5,00',
      'Categoria seconda (SpCat 2)', '2 Seconda voce', 'SOMMANO mq 2,00 5,00 10,00',
      'Riepilogo SUPER CATEGORIE', '001 Categoria prima 5,00',
      'LAVORI A CORPO', 'Categoria terza (SpCat 3)', '3 Terza voce',
      'a corpo', 'SOMMANO 1,00 20,00 20,00',
    ])]);
    assert.deepEqual(result.voci.map(e => e.numero), [1, 2, 3]);
    assert.deepEqual(result.voci.map(e => e.descrizione), ['Prima voce', 'Seconda voce', 'Terza voce a corpo']);
    assert.deepEqual(result.voci.map(e => e.supercategoria), ['Categoria prima', 'Categoria seconda', 'Categoria terza']);
    assert.equal(result.totaleEstratto, 35);
    assert.deepEqual(result.warnings, []);
  });

  test(`retains incomplete entries without absorbing section text (${positioned ? 'positioned' : 'text'})`, () => {
    const result = parseComputo([page(1, [
      '98 Voce senza riepilogo', 'Parziale LAVORI A MISURA euro 10,00',
      'Riepilogo SUPER CATEGORIE', '001 Categoria 10,00',
    ])]);
    assert.equal(result.voci.length, 1);
    assert.equal(result.voci[0].descrizione, 'Voce senza riepilogo');
    assert.equal(result.voci[0].controllo, 'INCOMPLETO');
  });

  test(`preserves entries continuing across a page break (${positioned ? 'positioned' : 'text'})`, () => {
    const result = parseComputo([
      page(1, ['1 Prima parte', 'A R I P O R T A R E 10,00']),
      page(2, ['R I P O R T O 10,00', 'Seconda parte', 'SOMMANO mq 2,00 5,00 10,00']),
    ]);
    assert.equal(result.voci[0].descrizione, 'Prima parte Seconda parte');
    assert.equal(result.voci[0].paginaFine, 2);
    assert.equal(result.voci[0].controllo, 'OK');
  });
}

test('uses a standalone a corpo label in text-only entries without leaking to the next entry', () => {
  const result = parseComputo([{
    page: 15,
    lines: [
      '98 Opere di sostegno e ponticelli', 'a corpo', "SOMMANO 1,00 374’180,42 374’180,42",
      '99 Altre opere', 'SOMMANO 1,00 10,00 10,00',
    ],
  }]);
  assert.equal(result.voci[0].unitaMisura, 'a corpo');
  assert.equal(result.voci[0].importo, 374180.42);
  assert.equal(result.voci[0].controllo, 'OK');
  assert.equal(result.voci[1].controllo, 'INCOMPLETO');
});

for (const label of ['Lavori contabilizzati a corpo', 'Altre opere']) {
  test(`does not infer an omitted unit from prose: ${label}`, () => {
    assert.equal(parseComputo([lumpSumEntry(label)]).voci[0].controllo, 'INCOMPLETO');
  });
}

test('requires all three amounts even with a preceding a corpo label', () => {
  const result = parseComputo([lumpSumEntry('a corpo', ["374’180,42", "374’180,42"])]);
  assert.equal(result.voci[0].controllo, 'INCOMPLETO');
});

test('retains amount verification for a unitless lump-sum summary', () => {
  const result = parseComputo([lumpSumEntry('a corpo', ['1,00', "374’180,42", "374’181,42"])]);
  assert.equal(result.voci[0].controllo, 'VERIFICARE');
  assert.equal(result.voci[0].scostamento, 1);
});

test('prefers an explicit summary unit over the preceding label', () => {
  const result = parseComputo([{
    page: 15, lines: ['98 Opere', 'a corpo', 'SOMMANO mq 2,00 5,00 10,00'],
  }]);
  assert.equal(result.voci[0].unitaMisura, 'mq');
  assert.equal(result.voci[0].controllo, 'OK');
});

function transportEntry(unit, amounts = ["1’184,00", '5,63', "6’665,92"]) {
  const item = (text, x, width = 24) => ({ text, x, width, height: 10 });
  return {
    page: 8, width: 793, height: 1122,
    rows: [
      { y: 950, items: [item('44', 23), item('Trasporto di materiale proveniente da lavori di movimento terra', 84, 295)] },
      { y: 936, items: [item('CAM24_T01', 23, 57)] },
      { y: 923, items: [item('.010.010.B', 23, 50)] },
      { y: 870, items: [item('Vedi voce n° 43 [mc 592.00]', 84, 140), item('2,00', 409), item("1’184,00", 592, 40)] },
      { y: 845, items: [item(`SOMMANO ${unit}`, 286, 96), ...amounts.map((value, index) => item(value, [592, 664, 727][index], index === 1 ? 24 : 40))] },
    ],
  };
}

for (const unit of ['mc/ 5km', 'mc/5km', 'mc / 5 km', 'mc/10km']) {
  test(`accepts transport summaries measured in ${unit}`, () => {
    const result = parseComputo([transportEntry(unit)]);
    assert.equal(result.voci.length, 1);
    const entry = result.voci[0];
    assert.equal(entry.numero, 44);
    assert.equal(entry.tariffa, 'CAM24_T01 .010.010.B');
    assert.equal(entry.unitaMisura, unit);
    assert.equal(entry.quantita, 1184);
    assert.equal(entry.prezzoUnitario, 5.63);
    assert.equal(entry.importo, 6665.92);
    assert.equal(entry.scostamento, 0);
    assert.equal(entry.controllo, 'OK');
    assert.equal(result.totaleEstratto, 6665.92);
    assert.deepEqual(result.warnings, []);
  });
}

test('does not use the distance or measurement row to complete missing summary amounts', () => {
  const result = parseComputo([transportEntry('mc/ 5km', ['5,63', "6’665,92"])]);
  assert.equal(result.voci[0].quantita, null);
  assert.equal(result.voci[0].controllo, 'INCOMPLETO');
  assert.equal(result.warnings.length, 1);
});

test('parses mc/ 5km in text-only summaries', () => {
  const result = parseComputo([{
    page: 8,
    lines: ['44 Trasporto di materiale', "SOMMANO mc/ 5km 1’184,00 5,63 6’665,92"],
  }]);
  assert.equal(result.voci[0].unitaMisura, 'mc/ 5km');
  assert.equal(result.voci[0].quantita, 1184);
  assert.equal(result.voci[0].prezzoUnitario, 5.63);
  assert.equal(result.voci[0].importo, 6665.92);
  assert.equal(result.voci[0].controllo, 'OK');
});

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
