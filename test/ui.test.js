import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function setup() {
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
    textContent: '', innerHTML: '', checked: false, disabled: false,
  }]));
  const context = createContext({ document: { getElementById: id => elements[id] } });
  runInContext(script, context);
  return {
    elements,
    render(result) {
      context.result = result;
      runInContext('data=result;render()', context);
    },
    filter(checked) {
      elements.onlyIncomplete.checked = checked;
      elements.onlyIncomplete.onchange();
    },
  };
}

function extraction(records = []) {
  return { type: 'computo', label: 'Computo', pages: 1,
    columns: [['descrizione', 'Descrizione'], ['controllo', 'Check']], records };
}

test('counts and filters only INCOMPLETO, preserving source data and escaping cells', () => {
  const ui = setup();
  const result = extraction([
    { descrizione: '<img src=x onerror=alert(1)>', controllo: 'INCOMPLETO' },
    { descrizione: 'Complete row', controllo: 'OK' },
    { descrizione: 'Review row', controllo: 'VERIFICARE' },
    { descrizione: 'Missing check' },
    { descrizione: 'Second incomplete', controllo: 'INCOMPLETO' },
  ]);
  const original = structuredClone(result);
  ui.render(result);
  assert.equal(ui.elements.sIncomplete.textContent, 2);
  assert.equal(ui.elements.onlyIncomplete.disabled, false);
  ui.filter(true);
  assert.match(ui.elements.table.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(ui.elements.table.innerHTML, /Second incomplete/);
  assert.doesNotMatch(ui.elements.table.innerHTML, /Complete row|Review row|Missing check/);
  assert.equal(ui.elements.sIncomplete.textContent, 2);
  assert.equal(ui.elements.sRows.textContent, 5);
  assert.deepEqual(result, original);
  ui.filter(false);
  assert.match(ui.elements.table.innerHTML, /Complete row/);
  assert.match(ui.elements.table.innerHTML, /Review row/);
  assert.match(ui.elements.table.innerHTML, /Missing check/);
});

test('shows an empty state and resets the filter on a new extraction', () => {
  const ui = setup();
  ui.render(extraction([{ descrizione: 'Complete row', controllo: 'OK' }]));
  assert.equal(ui.elements.sIncomplete.textContent, 0);
  ui.filter(true);
  assert.match(ui.elements.table.innerHTML, /Nessuna riga con controllo INCOMPLETO/);
  ui.render(extraction([{ descrizione: 'New row', controllo: 'OK' }]));
  assert.equal(ui.elements.onlyIncomplete.checked, false);
  assert.match(ui.elements.table.innerHTML, /New row/);
  ui.render(extraction());
  assert.equal(ui.elements.sIncomplete.textContent, 0);
  assert.match(ui.elements.table.innerHTML, /Nessun record/);
});

test('disables filtering for generic tables and records without a check column', () => {
  const ui = setup();
  ui.render(extraction());
  ui.filter(true);
  ui.render({ type: 'generic_table', tables: [{ page: 1, rows: [['Generic cell']] }] });
  assert.equal(ui.elements.onlyIncomplete.checked, false);
  assert.equal(ui.elements.onlyIncomplete.disabled, true);
  assert.equal(ui.elements.sIncomplete.textContent, '—');
  assert.match(ui.elements.table.innerHTML, /Generic cell/);
  ui.render({ type: 'elenco_prezzi', columns: [['descrizione', 'Descrizione']], records: [] });
  assert.equal(ui.elements.onlyIncomplete.disabled, true);
});
