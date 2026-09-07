import { segmentRow, repairIdentifierDescription, cleanText, vectorBoundariesNear } from './table-engine.js';
const EURO_RE = /\beuro\s*\(([^)]*)\)/i;
const NR_RE = /\bNr\.\s*(\d+)\b/i;

function clean(s) { return cleanText(s); }
function num(s) {
  const v = Number(String(s ?? '').replace(/[.'´’\s]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}
function noise(s) {
  return /^(pag\.\s*\d+|COMMITTENTE:|PriMus by)/i.test(clean(s));
}

function text(items) {
  return clean(items.map(i => i.text).join(' '));
}

/*
 * PriMus "Elenco prezzi" is a real multi-column table:
 *   [Num.Ord./Tariffa] [Descrizione] [U.M.] [Prezzo unitario]
 *
 * The previous parser rebuilt each visual row as one flat string. That caused
 * a tariff such as "A.002.004.b" to be concatenated with the description text
 * sitting on the same Y coordinate. Here we keep the X coordinates and split
 * every row into its actual visual columns before parsing it.
 */
function getColumnBounds(page) {
  // PriMus Elenco Prezzi: tariffa | descrizione | U.M. | prezzo.
  // Real vector rules are preferred over hard-coded ratios.
  const expected = [0.105, 0.855, 0.925];
  const detected = vectorBoundariesNear(page, expected, { toleranceRatio:0.035 });
  const b = detected.boundaries;
  return {
    tariffEnd:b[0], unitStart:b[1], priceStart:b[2],
    geometryDetected:detected.detectedCount, geometrySource:detected.source,
  };
}

function acceptsPrezziFirstToken(token, index, tokens) {
  if (/^Nr\.?$/i.test(token)) return true;
  if (/^\d{1,4}$/.test(token)) return true;
  if (/^\(?CAM\)?$/i.test(token)) return true;
  if (/^(NP|N\.P\.?|PA)$/i.test(token)) return true;
  if (/[._\-/]/.test(token) || /\d/.test(token) || /^[A-Z]{2,8}$/.test(token)) return true;
  // Custom NP/PA tariff names may legitimately contain words in the tariff
  // column. Preserve them only when the whole first cell starts with NP/PA and
  // there is no description in this same visual row; otherwise plain words are
  // treated as spill-over from the description column.
  if (/^(NP|N\.P\.?|PA)$/i.test(tokens[0] || '')) return true;
  return false;
}

function prezziProfile(page, bounds) {
  return {
    names:['first','desc','unit','price'],
    boundaries:[bounds.tariffEnd,bounds.unitStart,bounds.priceStart],
    repairRow(row) {
      return repairIdentifierDescription(row, {
        first:'first', desc:'desc', acceptsIdentifierToken:acceptsPrezziFirstToken,
      });
    },
  };
}

function splitRow(page, row, bounds) {
  return segmentRow(row, prezziProfile(page, bounds));
}

function isHeaderRow(r) {
  const s = clean(`${r.first} ${r.desc} ${r.unit} ${r.price}`);
  return /Num\.Ord\.|DESCRIZIONE\s+DELL['’]?ARTICOLO|PREZZO\s+UNITARIO|TARIFFA/i.test(s);
}

export function parseElencoPrezzi(pages) {
  const records = [];
  const warnings = [];
  let current = null;

  function finalize() {
    if (!current) return;
    current.tariffa = clean(current.tariffLines.join(' '));
    current.descrizione = clean(current.descLines.join(' '));
    delete current.tariffLines;
    delete current.descLines;
    records.push(current);
    current = null;
  }

  for (const page of pages) {
    const bounds = getColumnBounds(page);

    for (const row of page.rows) {
      const r = splitRow(page, row, bounds);
      if (!r.all || noise(r.all) || isHeaderRow(r)) continue;

      const nr = r.first.match(NR_RE);
      if (nr) {
        finalize();
        current = {
          numero: Number(nr[1]),
          tariffa: '',
          descrizione: '',
          unitaMisura: '',
          prezzoUnitario: null,
          prezzoLettere: '',
          paginaInizio: page.page,
          paginaFine: page.page,
          tariffLines: [],
          descLines: [],
        };

        // Some PDFs put the tariff on the same row as "Nr. X".
        const afterNr = clean(r.first.replace(NR_RE, ''));
        if (afterNr) current.tariffLines.push(afterNr);
        if (r.desc) current.descLines.push(r.desc);
        continue;
      }

      if (!current) continue;

      // First column contains ONLY Num.Ord./Tariffa. Never copy first-column
      // text into description and never copy description-column text into tariff.
      if (r.first) current.tariffLines.push(r.first);

      // Price line: "euro (cinque/25)" is in the description column, while
      // U.M. and numeric price are in their own visual columns.
      const euro = r.desc.match(EURO_RE);
      if (euro) {
        current.prezzoLettere = clean(euro[1]);
        if (r.unit) current.unitaMisura = clean(r.unit);

        const m = r.price.match(/-?\d[\d.'´’]*,\d+/);
        if (m) current.prezzoUnitario = num(m[0]);

        current.paginaFine = page.page;
        continue;
      }

      if (r.desc) current.descLines.push(r.desc);

      // Defensive fallback for PDFs where U.M./price text is slightly shifted
      // but remains in the two right-most columns.
      if (!current.unitaMisura && r.unit && !/^unit[aà]/i.test(r.unit)) {
        current.unitaMisura = clean(r.unit);
      }
      if (current.prezzoUnitario == null && r.price) {
        const m = r.price.match(/-?\d[\d.'´’]*,\d+/);
        if (m && EURO_RE.test(r.desc)) current.prezzoUnitario = num(m[0]);
      }
      current.paginaFine = page.page;
    }
  }

  finalize();

  const incomplete = records.filter(r => r.prezzoUnitario == null || !r.unitaMisura).length;
  if (incomplete) warnings.push(`${incomplete} articoli senza unità di misura o prezzo riconosciuto.`);

  return {
    type: 'elenco_prezzi',
    label: 'Elenco prezzi',
    records,
    columns: [
      ['numero','Nr.'], ['tariffa','Tariffa'], ['descrizione','Descrizione articolo'],
      ['unitaMisura','U.M.'], ['prezzoUnitario','Prezzo unitario €'], ['prezzoLettere','Prezzo in lettere'],
      ['paginaInizio','Pag. inizio'], ['paginaFine','Pag. fine']
    ],
    warnings,
    totaleEstratto: null,
  };
}
