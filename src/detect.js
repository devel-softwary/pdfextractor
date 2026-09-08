import { parseComputo } from './parser.js';
import { parseElencoPrezzi } from './prezzi.js';
import { extractGenericTables } from './generic.js';

export function detectDocumentType(pages) {
  const text = pages.slice(0, 4).flatMap(p => p.lines).join(' ');
  if (/SOMMANO\.\.\.|D I M E N S I O N I|LAVORI A MISURA/i.test(text)) return 'computo';
  if (/ELENCO PREZZI|DESCRIZIONE DELL['’]ARTICOLO|PREZZO\s+UNITARIO/i.test(text)) return 'elenco_prezzi';
  return 'generic_table';
}

export function extractByMode(pages, mode='auto') {
  const actual = mode === 'auto' ? detectDocumentType(pages) : mode;
  let result;
  if (actual === 'computo') {
    const p = parseComputo(pages);
    result = {
      type:'computo', label:'Computo metrico', records:p.voci, voci:p.voci,
      columns:[['numero','#'],['tariffa','Tariffa'],['supercategoria','Supercategoria'],['categoria','Categoria'],['sottocategoria','Sottocategoria'],['descrizione','Descrizione'],['unitaMisura','U.M.'],['quantita','Quantità'],['prezzoUnitario','P.Unit. €'],['importo','Importo €'],['controllo','Check']],
      totaleEstratto:p.totaleEstratto, warnings:p.warnings,
    };
  } else if (actual === 'elenco_prezzi') {
    result = parseElencoPrezzi(pages);
  } else {
    result = extractGenericTables(pages);
  }

  result.geometryDiagnostics = pages.map(p => ({
    pagina:p.page,
    regoleVerticali:(p.verticalRules || []).length,
    xVerticali:(p.verticalRules || []).map(r=>Math.round(r.x*100)/100),
    regoleOrizzontali:(p.horizontalRules || []).length,
    erroreGeometria:p.warning || null,
  }));
  return result;
}
