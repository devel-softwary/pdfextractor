import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCsv, toXlsx } from './export.js';
import { extractDocument, ExtractionInputError } from './extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ config, extractor = extractDocument } = {}) {
  if (!config) {
    throw new Error('createApp richiede una configurazione runtime valida.');
  }

  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes },
    fileFilter: (_req, file, cb) => {
      const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
      cb(null, isPdf);
    },
  });

  app.disable('x-powered-by');
  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'pdf-table-extractor',
      environment: config.environment,
      version: config.version,
      date: new Date().toISOString(),
    });
  });

  app.get('/readyz', (_req, res) => {
    res.json({
      status: 'ready',
      maxUploadMb: config.maxUploadMb,
      version: config.version,
      date: new Date().toISOString(),
    });
  });

  app.post('/api/extract', upload.single('pdf'), async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ExtractionInputError('Carica un PDF.');
      }

      const result = await extractor({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        mode: req.body?.mode,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/export/csv', (req, res, next) => {
    try {
      const csv = toCsv(req.body);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="estrazione.csv"');
      res.send(`\uFEFF${csv}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/export/xlsx', async (req, res, next) => {
    try {
      const buffer = await toXlsx(req.body);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="estrazione.xlsx"');
      res.send(Buffer.from(buffer));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `Il PDF supera il limite di ${config.maxUploadMb} MB.`,
          code: 'file_too_large',
        });
      }
      return res.status(400).json({ error: error.message, code: error.code });
    }

    if (error instanceof ExtractionInputError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }

    console.error(error);
    return res.status(500).json({
      error: error?.message || "Errore durante l'estrazione.",
      code: 'internal_error',
    });
  });

  return app;
}
