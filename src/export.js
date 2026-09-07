import ExcelJS from 'exceljs';

function q(v) {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join(' | ') : String(v);
  return /[";,\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}

export function toCsv(data) {
  if (data.type === 'generic_table') {
    const maxCols = Math.max(0, ...data.records.map(r => r.cells?.length || 0));
    const cols = ['tabella','pagina','riga', ...Array.from({length:maxCols},(_,i)=>`colonna_${i+1}`)];
    const lines = data.records.map(r => [r.tabella,r.pagina,r.riga,...Array.from({length:maxCols},(_,i)=>r.cells?.[i]??'')].map(q).join(';'));
    return [cols.join(';'), ...lines].join('\n');
  }
  const defs = data.columns || [];
  const keys = defs.map(c => c[0]);
  return [defs.map(c=>q(c[1])).join(';'), ...(data.records||[]).map(r => keys.map(k=>q(r[k])).join(';'))].join('\n');
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
}

export async function toXlsx(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PDF Table Extractor';

  if (data.type === 'generic_table') {
    for (const [idx, table] of (data.tables || []).entries()) {
      const ws = wb.addWorksheet(`Tabella_${idx+1}_pag_${table.page}`.slice(0,31), {views:[{state:'frozen', ySplit:1}]});
      const maxCols = Math.max(1, ...table.rows.map(r=>r.length));
      ws.columns = Array.from({length:maxCols},(_,i)=>({header:`Colonna ${i+1}`, key:`c${i}`, width:24}));
      styleHeader(ws.getRow(1));
      for (const r of table.rows) ws.addRow(Object.fromEntries(Array.from({length:maxCols},(_,i)=>[`c${i}`,r[i]??''])));
      ws.eachRow(row => row.alignment = {vertical:'top', wrapText:true});
    }
  } else {
    const ws = wb.addWorksheet(data.type === 'elenco_prezzi' ? 'Elenco prezzi' : 'Voci', { views: [{ state: 'frozen', ySplit: 1 }] });
    const defs = data.columns || [];
    ws.columns = defs.map(([key,label]) => ({ header:label, key, width: key==='descrizione'?70 : key==='tariffa'?26 : 16 }));
    for (const row of data.records || []) ws.addRow(row);
    styleHeader(ws.getRow(1));
    ws.eachRow((row, rn) => { if (rn>1) row.alignment = {vertical:'top', wrapText:true}; });
    for (const key of ['quantita','prezzoUnitario','importo','scostamento']) {
      const col = ws.getColumn(key); if (col?.number) col.numFmt = '#,##0.00';
    }
    if (defs.length) ws.autoFilter = { from:'A1', to: ws.getRow(1).getCell(defs.length).address };
  }

  const rs = wb.addWorksheet('Riepilogo');
  rs.addRows([
    ['RIEPILOGO ESTRAZIONE',''],
    ['Tipo documento', data.label || data.type],
    ['Record estratti', (data.records || []).length],
    ['Tabelle rilevate', (data.tables || []).length || ''],
    ['Totale estratto €', data.totaleEstratto ?? ''],
    ['Avvisi', (data.warnings || []).join(' | ')],
  ]);
  styleHeader(rs.getRow(1));
  rs.getColumn(1).width=28; rs.getColumn(2).width=80;
  return wb.xlsx.writeBuffer();
}
