import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { toCsv, toXlsx } from '../src/export.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const example = id => html.match(new RegExp(`<code id="${id}">([\\s\\S]*?)</code>`))[1]
  .replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
const result = JSON.parse(example('api-response-example'));

test('documented JSON example can be exported as CSV and Excel', async () => {
  assert.equal(toCsv(result), 'Descrizione;Check\nVoce senza importo;INCOMPLETO');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await toXlsx(result));
  assert.equal(workbook.getWorksheet('Voci').getCell('B2').value, 'INCOMPLETO');
});

test('documented JavaScript uploads the selected PDF and filters incomplete records', async () => {
  const file = new Blob(['%PDF example'], { type: 'application/pdf' });
  let logged;
  await runInNewContext(`(async () => { ${example('api-js-example')} })()`, {
    FormData,
    document: { getElementById: id => { assert.equal(id, 'file'); return { files: [file] }; } },
    fetch: async (url, options) => {
      assert.equal(url, '/api/extract');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers, undefined);
      assert.equal(options.body.get('mode'), 'auto');
      assert.equal(await options.body.get('pdf').text(), '%PDF example');
      return { ok: true, json: async () => ({ ...result, records: [...result.records, { controllo: 'OK' }] }) };
    },
    console: { log: (...args) => { logged = args; }, error: assert.fail },
  });
  assert.equal(logged[0].records.length, 2);
  assert.deepEqual(logged[1], result.records);
});

test('documented JavaScript reports API errors', async () => {
  let message;
  await runInNewContext(`(async () => { ${example('api-js-example')} })()`, {
    FormData,
    document: { getElementById: () => ({ files: [new Blob(['invalid'])] }) },
    fetch: async () => ({ ok: false, json: async () => ({ error: 'PDF non valido' }) }),
    console: { log: assert.fail, error: error => { message = error; } },
  });
  assert.equal(message, 'PDF non valido');
});
