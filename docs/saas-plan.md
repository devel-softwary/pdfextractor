# Piano SaaS Computo Extractor

## Obiettivo

Trasformare l'attuale estrattore di computi metrici PriMus in un servizio online
affidabile e vendibile. L'utente carica un PDF, riceve lo stato della
lavorazione in coda e scarica il risultato estratto in CSV/XLSX.

L'estrattore esistente resta il motore applicativo: l'attuale endpoint
`POST /api/extract` diventa il worker che elabora i job asincroni.

## MVP

Funzionalita' necessarie per il primo rilascio:

- Landing page con proposta di valore, esempi di output e prezzi.
- Registrazione e accesso via email.
- Caricamento di PDF PriMus con validazione di formato e dimensione.
- Creazione di un job e indicazione dello stato: `queued`, `processing`,
  `done` o `failed`.
- Aggiornamento automatico dello stato nella dashboard.
- Anteprima del computo estratto e download CSV/XLSX.
- Piano gratuito: una estrazione completata ogni sette giorni per utente.
- Acquisto di una singola estrazione a EUR 2,00 tramite Stripe.
- Storico delle elaborazioni e messaggi di errore comprensibili.

Escluso dall'MVP: collaborazione tra team, API pubblica, OCR per PDF
scansionati, abbonamenti ricorrenti e gestione amministrativa avanzata.

## Architettura proposta

```text
Browser
  -> Frontend web (Next.js)
       -> Supabase Auth / Postgres / Storage
       -> API applicativa
            -> coda job
                 -> servizio estrattore (container Coolify su VPS)
                      -> parser PDF esistente
            -> salvataggio risultato e aggiornamento stato
```

Componenti:

- **Frontend e API**: Next.js, deployato come container Docker con Coolify su
  VPS. Gestisce landing page, dashboard, autorizzazione e creazione dei job.
- **Autenticazione, database e storage**: Supabase. Il bucket privato conserva
  i PDF originali e gli export generati; Postgres conserva utenti, job e
  utilizzo.
- **Worker di estrazione**: il codice Node.js gia' presente, reso stateless e
  containerizzato e deployato con Coolify sulla stessa VPS o su una VPS worker
  separata. Viene invocato solo dal backend/worker, non dal browser.
- **Coda**: per l'MVP e' sufficiente una tabella `jobs` in Postgres con
  locking atomico. Se il volume cresce, usare Redis con BullMQ, deployato via
  Coolify, senza cambiare il contratto dei job.
- **Pagamenti**: Stripe Checkout per vendere crediti e webhook Stripe per
  accreditarli solo dopo il pagamento confermato.

Coolify gestisce build, deploy, dominio e certificati HTTPS dei container sulla
VPS. La VPS richiede monitoraggio, aggiornamenti di sicurezza e backup gestiti
dal progetto. Supabase resta il servizio gestito per autenticazione, database e
storage: [Supabase pricing](https://supabase.com/pricing).

## Flusso di una estrazione

1. L'utente autenticato carica un PDF nel bucket privato tramite URL firmato.
2. Il backend verifica il diritto gratuito settimanale o scala un credito
   acquistato, quindi crea il job con stato `queued`.
3. Un worker prende il job in modo atomico, lo marca `processing` e scarica il
   PDF dal bucket.
4. Il worker usa `extractPdfPages` e `parseComputo`, salva JSON e file export,
   poi aggiorna il job a `done`. In caso di errore lo marca `failed` senza
   consumare credito, salvo errori di file non valido esplicitamente gestiti.
5. La dashboard osserva gli aggiornamenti e mostra avanzamento, esito e link
   di download firmati a scadenza.

## Modello dati minimo

| Tabella | Scopo |
| --- | --- |
| `profiles` | profilo applicativo collegato all'utente Supabase Auth |
| `jobs` | file, stato, timestamp, errore, risultato e consumo associato |
| `usage_events` | audit di estrazioni gratuite, crediti consumati e rimborsi |
| `credit_purchases` | checkout Stripe, pagamento e crediti assegnati |
| `webhook_events` | idempotenza e audit dei webhook Stripe |

Campi chiave di `jobs`: `id`, `user_id`, `input_path`, `status`,
`result_json_path`, `csv_path`, `xlsx_path`, `error_code`, `error_message`,
`created_at`, `started_at`, `completed_at`.

La regola free non va calcolata solo nella UI: il backend deve controllare che
non esista un evento `free_extraction` completato per lo stesso utente negli
ultimi sette giorni.

## Prezzi e crediti

Il piano gratuito offre una estrazione completata ogni sette giorni. Il piano
pagamento iniziale e' una carta di credito di una estrazione a EUR 2,00.

Stripe indica per le carte standard EEA una commissione pubblicata di 1,5% +
EUR 0,25; su EUR 2,00 restano circa EUR 1,72 prima di IVA, infrastruttura e
supporto. Per questa ragione il checkout deve essere progettato a crediti:
consente in seguito pacchetti da 5 o 20 estrazioni, riducendo l'incidenza delle
commissioni senza migrare il modello dati.

Riferimento: [Stripe Italia pricing](https://stripe.com/it/pricing).

## Sicurezza e operativita'

- Bucket non pubblico; accesso ai file soltanto tramite URL firmati brevi.
- Row Level Security in Supabase: ciascun utente vede esclusivamente i propri
  job e risultati.
- Limiti su tipo, dimensione e numero di upload; rate limiting sugli endpoint.
- Secret Stripe e credenziali Supabase disponibili solo lato server.
- Webhook Stripe verificati tramite firma e gestiti in modo idempotente.
- Log strutturati, tracciamento errori e allarme sui job bloccati.
- Policy di retention: eliminare PDF originali e risultati dopo un periodo
  esplicito, ad esempio 30 giorni per il free tier.
- Backup automatici della VPS e verifica periodica del ripristino; aggiornamenti
  regolari di sistema, Coolify e immagini Docker.

## Roadmap di implementazione

### Fase 1 - Servizio deployabile

1. Separare il motore di estrazione dall'HTTP server in un modulo riusabile.
2. Aggiungere health check, configurazione tramite environment variables,
   limiti upload e gestione errori coerente.
3. Configurare Coolify sulla VPS, repository, variabili d'ambiente, dominio,
   HTTPS e deploy dell'immagine Docker.
4. Aggiungere test di parsing con PDF campione e smoke test HTTP.

### Fase 2 - Backend SaaS

1. Creare il progetto Supabase, schema SQL, bucket privati e policy RLS.
2. Implementare API per upload firmato, creazione job e lettura stato.
3. Implementare il worker con claim atomico dei job, retry controllati e
   cleanup dei file temporanei.
4. Applicare la regola gratuita settimanale e il ledger dei crediti.

### Fase 3 - Esperienza utente

1. Costruire landing page, auth e dashboard responsive.
2. Mostrare coda, stato in tempo reale, errori e risultati scaricabili.
3. Aggiungere anteprima tabellare e storico estrazioni.

### Fase 4 - Monetizzazione e lancio

1. Configurare Stripe Checkout, webhook e pagina acquisti.
2. Aggiungere Termini, Privacy Policy, consenso e contatto supporto.
3. Configurare dominio, analytics essenziali, monitoraggio e backup.
4. Eseguire beta privata con PDF reali e correggere i casi di parsing emersi.

## Criteri di accettazione MVP

- Un utente registrato puo' caricare un PDF valido e ricevere il risultato
  senza attendere una richiesta HTTP aperta.
- Lo stato del job passa correttamente da `queued` a `processing` e poi a
  `done` o `failed`.
- Gli utenti non possono accedere a file, job o risultati di altri utenti.
- Un utente free non puo' avviare piu' di una estrazione completata in sette
  giorni.
- Un pagamento Stripe confermato accredita un credito una sola volta, anche
  se il webhook viene ritentato.
- CSV e XLSX scaricati corrispondono al risultato del parser attuale.
