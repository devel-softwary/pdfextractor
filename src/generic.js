import { cleanText, inferColumnAnchors, anchorsToBoundaries, segmentRow, vectorColumnRules } from './table-engine.js';

function clean(s) { return cleanText(s); }

function trimEmptyColumns(rows) {
  if (!rows.length) return rows;
  const cols = Math.max(...rows.map(r => r.length));
  const keep = [];
  for (let c=0;c<cols;c++) if (rows.some(r => clean(r[c]))) keep.push(c);
  return rows.map(r => keep.map(c => r[c] ?? ''));
}

export function extractGenericTables(pages) {
  const tables = [];
  for (const page of pages) {
    // First choice: actual vertical vector rules drawn in the PDF. If no usable
    // rules exist, preserve the previous text-anchor inference as fallback.
    let boundaries = vectorColumnRules(page);
    let source = 'vector_rules';
    if (boundaries.length < 1) {
      const anchors = inferColumnAnchors(page);
      if (anchors.length < 2) continue;
      boundaries = anchorsToBoundaries(anchors, page.width);
      source = 'text_anchors';
    }
    const names = Array.from({length:boundaries.length+1}, (_,i)=>`c${i}`);
    const profile = { names, boundaries };

    let rows = page.rows.map(r => {
      const segmented = segmentRow(r, profile);
      return names.map(name => segmented[name] || '');
    });
    rows = trimEmptyColumns(rows).filter(r => r.filter(Boolean).length >= 2);
    if (rows.length < 3) continue;
    tables.push({ page: page.page, rows, columns: rows[0].map((_,i)=>`Colonna ${i+1}`), geometrySource:source, boundaries });
  }
  return {
    type: 'generic_table', label: 'Tabelle generiche', tables,
    records: tables.flatMap((t, ti) => t.rows.map((cells, ri) => ({ tabella: ti+1, pagina: t.page, riga: ri+1, cells }))),
    warnings: tables.length ? [] : ['Nessuna tabella con linee vettoriali o colonne ricorrenti rilevata automaticamente.'],
    totaleEstratto: null,
  };
}
