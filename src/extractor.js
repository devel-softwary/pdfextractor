import { extractByMode } from './detect.js';
import { extractPdfPages } from './pdf.js';

const VALID_MODES = new Set(['auto', 'computo', 'elenco_prezzi', 'generic_table']);

export class ExtractionInputError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ExtractionInputError';
    this.statusCode = options.statusCode ?? 400;
    this.code = options.code ?? 'invalid_input';
  }
}

export function assertPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 4).toString('utf8') !== '%PDF') {
    throw new ExtractionInputError("Il file caricato non e' un PDF valido.");
  }
}

export function normalizeMode(mode) {
  return VALID_MODES.has(mode) ? mode : 'auto';
}

export async function extractDocument({ buffer, filename, mode = 'auto' }) {
  assertPdfBuffer(buffer);

  const normalizedMode = normalizeMode(mode);
  const pages = await extractPdfPages(buffer);
  if (!pages.some(page => page.items.length)) {
    throw new ExtractionInputError(
      "Il PDF non contiene testo nativo. Per PDF scansionati serve il modulo OCR.",
      { statusCode: 422, code: 'no_native_text' },
    );
  }

  return {
    filename,
    pages: pages.length,
    modeRequested: normalizedMode,
    ...extractByMode(pages, normalizedMode),
  };
}
