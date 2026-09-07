import { segmentRow, repairIdentifierDescription, cleanText, vectorBoundariesNear } from './table-engine.js';
const DATE_RE = /\b(\d{2}\/\d{2}\/\d{4})\b/;
const NUM_RE = /-?\d[\d.'´’]*,\d+|-?\d[\d.'´’]*/g;
const UM_RE = /^(coppie|cad|cadauno|cad\.|mq|mq\/cm|m2|m²|mc|m3|m³|kg|t|q|h|ora|gg|ml|m|cm|mm|ha|a corpo|corpo|%|l|lt|kW|W|V|A|nr|n\.|pz)$/i;

function n(s) {
  if (s == null || s === '') return null;
  const normalized = String(s).replace(/[.'´’\s]/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
function clean(s) { return cleanText(s); }

function isPageNoise(line) {
  return /^(pag\.\s*\d+|COMMITTENTE:|A R I P O R T A R E|R I P O R T O|Num\.Ord\.|TARIFFA DESIGNAZIONE|misura par\.ug\.|unità D I M E N S I O N I)/i.test(line);
}
function detectCategory(line) {
  let m = line.match(/^(.+?)\s*\(SpCat\s+\d+\)$/i);
  if (m) return { type: 'spcat', value: clean(m[1]) };
  m = line.match(/^(.+?)\s*\(Cat\s+\d+\)$/i);
  if (m) return { type: 'cat', value: clean(m[1]) };
  m = line.match(/^(.+?)\s*\(SbCat\s+\d+\)$/i);
  if (m) return { type: 'sbcat', value: clean(m[1]) };
  return null;
}

/*
 * PriMus Computo Metrico is a multi-column table. The critical rule is:
 * NEVER reconstruct tariff and description from a flattened Y row.
 * The first visual column contains Num.Ord./Tariffa/date; the second contains
 * only the work description. Remaining columns contain U.M., dimensions,
 * quantity and amounts.
 */
function getColumnBounds(page) {
  // Semantic PriMus separators, but prefer actual vector rules detected in the PDF.
  const expected = [0.1035, 0.445, 0.495, 0.555, 0.615, 0.675, 0.755, 0.825, 0.905];
  const detected = vectorBoundariesNear(page, expected, { toleranceRatio:0.028 });
  const b = detected.boundaries;
  return {
    firstEnd:b[0], descEnd:b[1], unitEnd:b[2], parEnd:b[3], lengthEnd:b[4],
    widthEnd:b[5], hpesoEnd:b[6], qtyEnd:b[7], unitPriceEnd:b[8],
    geometryDetected:detected.detectedCount, geometrySource:detected.source,
  };
}

function acceptsComputoFirstToken(token) {
  // Num.Ord., date and tariff fragments. Plain Italian words are deliberately
  // rejected here so accidental spill-over (e.g. "Rinterro") moves to desc.
  return /^\d{1,4}$/.test(token)
    || /^\d{2}\/\d{2}\/\d{4}$/.test(token)
    || /^\(?CAM\)?$/i.test(token)
    || /[._\-/]/.test(token)
    || /\d/.test(token)
    || /^[A-Z]{2,8}$/.test(token);
}

function computoProfile(page, b) {
  return {
    names:['first','desc','unit','par','length','width','hpeso','qty','unitPrice','total'],
    boundaries:[b.firstEnd,b.descEnd,b.unitEnd,b.parEnd,b.lengthEnd,b.widthEnd,b.hpesoEnd,b.qtyEnd,b.unitPriceEnd],
    repairRow(row) {
      return repairIdentifierDescription(row, {
        first:'first', desc:'desc', acceptsIdentifierToken:acceptsComputoFirstToken,
      });
    },
  };
}

function splitRow(page, row, b) {
  return segmentRow(row, computoProfile(page, b));
}

function isHeaderRow(r) {
  return /Num\.Ord\.|DESIGNAZIONE DEI LAVORI|D I M E N S I O N I|I M P O R T I|TARIFFA/i.test(r.all);
}
function parseNumCell(s) {
  const m = clean(s).match(/-?\d[\d.'´’]*,\d+|-?\d[\d.'´’]*/);
  return m ? n(m[0]) : null;
}
function parseSommanoCells(r) {
  if (!/^SOMMANO/i.test(r.desc)) return null;
  let um = clean(r.unit);
  // "a corpo" may visually span description/unit depending on font metrics.
  if (!um && /a corpo\s*$/i.test(r.desc)) um = 'a corpo';
  const q = parseNumCell(r.qty);
  const pu = parseNumCell(r.unitPrice);
  const tot = parseNumCell(r.total);
  if (!UM_RE.test(um) || q == null || pu == null || tot == null) return null;
  return { unitaMisura: um, quantita:q, prezzoUnitario:pu, importo:tot };
}
function startsEntry(r) {
  const m = clean(r.first).match(/^(\d{1,4})(?:\s+|$)(.*)$/);
  if (!m) return null;
  return { numero:Number(m[1]), restFirst:clean(m[2]), desc:clean(r.desc) };
}

export function parseComputo(pages) {
  if (pages.every(page => !page.rows?.length && Array.isArray(page.lines))) {
    return parseComputoFromLines(pages);
  }

  const result = [];
  const warnings = [];
  let context = { spcat:'', cat:'', sbcat:'' };
  let current = null;

  function finalize(entry) {
    if (!entry) return;
    entry.descrizione = clean(entry.descriptionLines.join(' '));
    entry.tariffa = clean(entry.tariffLines.join(' '));
    delete entry.descriptionLines;
    delete entry.tariffLines;
    if (entry.quantita != null && entry.prezzoUnitario != null && entry.importo != null) {
      const calc = Math.round(entry.quantita * entry.prezzoUnitario * 100) / 100;
      entry.scostamento = Math.round((entry.importo - calc) * 100) / 100;
      entry.controllo = Math.abs(entry.scostamento) <= 0.02 ? 'OK' : 'VERIFICARE';
    } else {
      entry.scostamento = null;
      entry.controllo = 'INCOMPLETO';
    }
    result.push(entry);
  }

  for (const page of pages) {
    const bounds = getColumnBounds(page);
    for (const row of page.rows) {
      const r = splitRow(page, row, bounds);
      if (!r.all || isPageNoise(r.all) || isHeaderRow(r)) continue;

      // Category headings live in the description column, not in tariff.
      const categoryText = clean(r.desc || r.all);
      const cat = detectCategory(categoryText);
      if (cat) { context[cat.type] = cat.value; continue; }

      const ne = startsEntry(r);
      if (ne) {
        const plausible = !current || ne.numero === current.numero + 1 || ne.numero > current.numero;
        if (plausible) {
          finalize(current);
          current = {
            numero:ne.numero, tariffa:'', dataTariffa:'', supercategoria:context.spcat,
            categoria:context.cat, sottocategoria:context.sbcat, descrizione:'',
            unitaMisura:'', quantita:null, prezzoUnitario:null, importo:null,
            paginaInizio:page.page, paginaFine:page.page, descriptionLines:[], tariffLines:[]
          };
          if (ne.restFirst) current.tariffLines.push(ne.restFirst);
          if (ne.desc) current.descriptionLines.push(ne.desc);
          continue;
        }
      }
      if (!current) continue;

      const sommano = parseSommanoCells(r);
      if (sommano) {
        Object.assign(current, sommano);
        current.paginaFine = page.page;
        continue;
      }

      // The first column is authoritative for tariff/date. Description text is
      // never allowed to enter tariff, even when it shares the same Y coordinate.
      if (r.first) {
        const dm = r.first.match(DATE_RE);
        if (dm) {
          if (!current.dataTariffa) current.dataTariffa = dm[1];
          const leftover = clean(r.first.replace(dm[0], ''));
          if (leftover) current.tariffLines.push(leftover);
        } else {
          current.tariffLines.push(r.first);
        }
      }

      // Description and measurement annotations occupy only the designation column.
      if (r.desc && !/^SOMMANO/i.test(r.desc)) current.descriptionLines.push(r.desc);
      current.paginaFine = page.page;
    }
  }
  finalize(current);

  const seen = new Set();
  const cleaned = result.filter(e => {
    const key = `${e.numero}-${e.paginaInizio}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const total = Math.round(cleaned.reduce((s,e)=>s+(e.importo??0),0)*100)/100;
  const incomplete = cleaned.filter(e => e.controllo === 'INCOMPLETO').length;
  if (incomplete) warnings.push(`${incomplete} voci senza quantità/prezzo/importo completi.`);
  return { voci:cleaned, totaleEstratto:total, warnings };
}

function parseComputoFromLines(pages) {
  const result = [];
  const warnings = [];
  let context = { spcat: '', cat: '', sbcat: '' };
  let current = null;

  function finalize() {
    if (!current) return;
    current.descrizione = clean(current.descriptionLines.join(' '));
    current.tariffa = clean(current.tariffLines.join(' '));
    delete current.descriptionLines;
    delete current.tariffLines;
    if (current.quantita != null && current.prezzoUnitario != null && current.importo != null) {
      const calc = Math.round(current.quantita * current.prezzoUnitario * 100) / 100;
      current.scostamento = Math.round((current.importo - calc) * 100) / 100;
      current.controllo = Math.abs(current.scostamento) <= 0.02 ? 'OK' : 'VERIFICARE';
    } else {
      current.scostamento = null;
      current.controllo = 'INCOMPLETO';
    }
    result.push(current);
    current = null;
  }

  for (const page of pages) {
    for (const rawLine of page.lines || []) {
      const line = clean(rawLine);
      if (!line || isPageNoise(line)) continue;

      const cat = detectCategory(line);
      if (cat) {
        context[cat.type] = cat.value;
        continue;
      }

      const entry = line.match(/^(\d{1,4})\s+(.+)$/);
      if (entry) {
        finalize();
        current = {
          numero: Number(entry[1]),
          tariffa: '',
          dataTariffa: '',
          supercategoria: context.spcat,
          categoria: context.cat,
          sottocategoria: context.sbcat,
          descrizione: '',
          unitaMisura: '',
          quantita: null,
          prezzoUnitario: null,
          importo: null,
          paginaInizio: page.page,
          paginaFine: page.page,
          descriptionLines: [entry[2]],
          tariffLines: [],
        };
        continue;
      }

      if (!current) continue;

      if (/^SOMMANO/i.test(line)) {
        const sommanoMatch = line.match(
          /^SOMMANO.*?\s+(.+?)\s+(-?\d[\d.'´’]*,\d+|-?\d[\d.'´’]*)\s+(-?\d[\d.'´’]*,\d+|-?\d[\d.'´’]*)\s+(-?\d[\d.'´’]*,\d+|-?\d[\d.'´’]*)$/i,
        );
        if (sommanoMatch) {
          current.unitaMisura = clean(sommanoMatch[1]);
          current.quantita = n(sommanoMatch[2]);
          current.prezzoUnitario = n(sommanoMatch[3]);
          current.importo = n(sommanoMatch[4]);
          current.paginaFine = page.page;
        }
        continue;
      }

      const dateMatch = line.match(DATE_RE);
      if (dateMatch && !current.dataTariffa) {
        current.dataTariffa = dateMatch[1];
        const leftover = clean(line.replace(dateMatch[0], ''));
        if (leftover) current.tariffLines.push(leftover);
        current.paginaFine = page.page;
        continue;
      }

      current.descriptionLines.push(line);
      current.paginaFine = page.page;
    }
  }

  finalize();

  const total = Math.round(result.reduce((sum, entry) => sum + (entry.importo ?? 0), 0) * 100) / 100;
  const incomplete = result.filter(entry => entry.controllo === 'INCOMPLETO').length;
  if (incomplete) warnings.push(`${incomplete} voci senza quantità/prezzo/importo completi.`);
  return { voci: result, totaleEstratto: total, warnings };
}
