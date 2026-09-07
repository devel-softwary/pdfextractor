# PDF Table Extractor v2.5

## Novità: motore unico di segmentazione

Computo metrico, Elenco prezzi e Tabelle generiche usano ora lo stesso motore `src/table-engine.js`. Il motore lavora sempre sulle coordinate X/Y di `pdf.js`, segmenta le righe in celle, spezza gli elementi testuali che attraversano più colonne e applica una riparazione condivisa degli sconfinamenti tra colonna identificativo/tariffa e descrizione.

I parser `parser.js` e `prezzi.js` non implementano più ciascuno una propria logica di separazione: definiscono soltanto il profilo delle colonne e le regole semantiche del formato. Anche `generic.js` usa lo stesso motore per la segmentazione delle celle.

Tool web locale per estrarre dati strutturati da **PDF nativi contenenti tabelle**.

## Profili inclusi

1. **Computo metrico PriMus / simili**: numero, tariffa, categorie, descrizione, quantità, prezzo unitario, importo e controllo matematico.
2. **Elenco prezzi PriMus**: numero articolo, tariffa, descrizione, unità di misura, prezzo unitario e prezzo in lettere.
3. **Tabella generica**: ricostruisce righe e colonne dalle coordinate X/Y del testo, senza richiedere un formato noto.
4. **Auto**: riconosce il profilo più probabile.

La modalità generica è pensata per PDF con testo nativo e tabelle visuali. Non usa semplicemente l'ordine del testo: conserva le coordinate degli elementi PDF e cerca allineamenti verticali ricorrenti.

## Avvio

Richiede Node.js 22+.

```bash
npm install
npm start
```

Apri `http://localhost:3000`.

Variabili runtime supportate:

- `PORT`: porta HTTP del servizio. Default `3000`.
- `MAX_UPLOAD_MB`: limite upload PDF in MB. Default `50`.
- `JSON_BODY_LIMIT_MB`: limite payload JSON per gli export. Default `30`.
- `APP_VERSION`: versione applicativa esposta da log e health endpoint.

Health endpoint per deploy e monitoraggio:

- `GET /healthz`
- `GET /readyz`

## Docker

```bash
docker build -t pdf-table-extractor .
docker run --rm -p 3000:3000 pdf-table-extractor
```

L'immagine Docker include un `HEALTHCHECK` che interroga `healthz` e `readyz`.

## Test

```bash
npm test
npm run smoke
```

Lo smoke test verifica gli endpoint `healthz` e `readyz`; se la porta `3000` è già occupata, usare ad esempio `TARGET_URL=http://127.0.0.1:3210 npm run smoke`.

## API

```bash
curl -F "pdf=@documento.pdf" -F "mode=auto" http://localhost:3000/api/extract > result.json
```

`mode`: `auto`, `computo`, `elenco_prezzi`, `generic_table`.

Export XLSX:

```bash
curl -H 'Content-Type: application/json' --data-binary @result.json http://localhost:3000/api/export/xlsx -o estrazione.xlsx
```

## Limiti

- La versione attuale lavora su **PDF nativi**. Un PDF costituito solo da scansioni richiede OCR.
- La tabella generica è euristica: tabelle senza allineamenti costanti, celle unite, testi ruotati o layout grafici molto complessi possono richiedere una correzione manuale o un profilo specifico.
- Per i documenti ricorrenti conviene creare un profilo dedicato: è molto più affidabile del parser generico.

## v2.2 - fix Computo Metrico a colonne
Il parser `computo` ora separa le celle usando le coordinate X del PDF. La colonna `Num.Ord./TARIFFA` è trattata come fonte esclusiva per numero, tariffa e data; il testo della colonna `DESIGNAZIONE DEI LAVORI` non può più essere concatenato alla tariffa. Anche U.M., quantità, prezzo unitario e totale vengono letti dalle rispettive colonne visive.


## v2.3 - fix elementi PDF che attraversano due colonne
Alcuni PDF PriMus espongono tramite `pdf.js` un singolo text item che contiene contemporaneamente la fine della tariffa e l'inizio della descrizione (es. `CAM26_E01 Rinterro`). Il parser ora:

- usa la posizione reale della prima regola verticale (~10,35% della pagina) invece di dedurla dal titolo centrato `DESIGNAZIONE`;
- rileva gli elementi testuali che attraversano un confine di colonna;
- li suddivide in token e assegna ogni token alla colonna in base alla sua posizione X stimata.

Questo evita casi come `CAM26_E01 Rinterro .040.010.A`: la tariffa corretta diventa `CAM26_E01 .040.010.A` e `Rinterro` resta nella descrizione.


## v2.5
- Applicata anche al parser **Elenco prezzi** la suddivisione degli elementi pdf.js che attraversano più colonne.
- Corretto il caso in cui codici tariffa come `CAM24_E01` venivano persi o assegnati alla descrizione.
- La prima colonna `Num.Ord./TARIFFA` resta autoritativa per numero e tariffa; la descrizione non può contaminare il codice.
## v2.6 - rilevamento automatico delle linee della tabella

Il motore non dipende più soltanto da proporzioni predefinite o dagli allineamenti del testo. `src/pdf.js` analizza anche l'operator list vettoriale di ogni pagina PDF e ricostruisce segmenti verticali/orizzontali disegnati nel documento.

Flusso:

1. estrazione testo con coordinate X/Y;
2. estrazione dei tracciati vettoriali (`constructPath`) e delle trasformazioni grafiche;
3. clustering delle linee verticali ricorrenti;
4. selezione delle linee reali più vicine ai separatori semantici attesi nei profili PriMus;
5. fallback automatico alle proporzioni note se una linea non è disponibile;
6. per tabelle generiche, priorità alle linee vettoriali reali e fallback agli anchor del testo.

La risposta API contiene inoltre `geometryDiagnostics`, con il numero e le coordinate X delle regole verticali individuate per pagina. È utile per diagnosticare PDF nuovi senza modificare il parser.

Questa logica è **best effort**: alcuni PDF convertono le tabelle in immagini o usano costruzioni grafiche non esposte come normali path. In tali casi resta attivo il fallback coordinate/testo già presente.
